/**
 * Demo-mode tests. The 403 and limiter tests need nothing running; the
 * isolation, rate-limit and cleanup tests need Postgres with the schema pushed
 * (npm run infra:up && npm run db:push) and are skipped without it.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { inArray, like, sql } from "drizzle-orm";

// env.ts reads process.env once at import, so configure demo mode first.
Object.assign(process.env, {
  DEMO_MODE: "true",
  COMPILER_MODE: "stub",
  DEMO_COMPILES_PER_HOUR: "2",
  DEMO_COMPILES_PER_DAY: "2",
  DEMO_PROMPT_MAX_CHARS: "200",
});
const { app } = await import("./app.js");
const { db, schema } = await import("./db/client.js");
const { RollingLimiter, deleteExpiredDemoRows } = await import("./demo.js");

/** Test visitors: a fixed awb_sid each, and a distinct IP so per-IP limits don't collide. */
const visitor = (name: string, ip: string) => ({
  sid: `testvisitor_${name}_0000000000`,
  headers: (extra: Record<string, string> = {}) => ({
    cookie: `awb_sid=testvisitor_${name}_0000000000`,
    "x-forwarded-for": ip,
    "content-type": "application/json",
    ...extra,
  }),
});
const alice = visitor("alice", "203.0.113.1");
const bob = visitor("bob", "203.0.113.2");
const carol = visitor("carol", "203.0.113.3");

const call = (v: ReturnType<typeof visitor>, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: v.headers(), body: body === undefined ? undefined : JSON.stringify(body) });

test("dangerous routes return 403 in demo mode", async () => {
  const blocked: [string, string][] = [
    ["GET", "/api/connections"],
    ["POST", "/api/connections"],
    ["POST", "/api/hooks/sometoken"],
    ["POST", "/api/workflows/wf_x/deploy"],
    ["GET", "/api/workflows/wf_x/deployments"],
    ["POST", "/api/deployments/d_x/pause"],
    ["POST", "/api/workflows/wf_x/schedule"],
    ["DELETE", "/api/schedules/s_x"],
    ["POST", "/api/blueprints"],
    ["DELETE", "/api/blueprints/bp_x"],
    ["GET", "/api/local-tasks/pending"],
    ["POST", "/api/kbs"],
    ["PATCH", "/api/kbs/kb_x"],
    ["DELETE", "/api/kbs/kb_x"],
    ["POST", "/api/kbs/kb_x/documents"],
    ["POST", "/api/kbs/kb_x/documents/doc_x/reindex"],
    ["POST", "/api/templates"],
    ["DELETE", "/api/templates/tpl_x"],
  ];
  for (const [method, path] of blocked) {
    const res = await call(alice, method, path, method === "GET" || method === "DELETE" ? undefined : {});
    assert.equal(res.status, 403, `${method} ${path}`);
    const body = (await res.json()) as { demo?: boolean; error: string };
    assert.equal(body.demo, true);
    assert.match(body.error, /disabled in the public demo/);
  }
});

test("a first-time visitor gets an httpOnly awb_sid cookie and the demo status", async () => {
  const res = await app.request("/api/demo");
  const cookie = res.headers.get("set-cookie") ?? "";
  assert.match(cookie, /awb_sid=[A-Za-z0-9_-]{24}/);
  assert.match(cookie, /HttpOnly/i);
  const status = (await res.json()) as { demo: boolean; compiler: string; blockedKinds: string[] };
  assert.equal(status.demo, true);
  assert.equal(status.compiler, "stub");
  assert.deepEqual(status.blockedKinds, ["code", "local"]);
});

test("RollingLimiter allows `limit` hits per window, then reports the wait", () => {
  const limiter = new RollingLimiter(1000, 2);
  limiter.record("k", 0);
  limiter.record("k", 100);
  assert.equal(limiter.remaining("k", 200), 0);
  assert.equal(limiter.retryAfter("k", 200), 1); // the first hit leaves the window at t=1000
  assert.equal(limiter.remaining("k", 1001), 1);
  assert.equal(limiter.remaining("other", 200), 2);
});

const dbUp = await db
  .execute(sql`select owner_sid from workflows limit 1`)
  .then(() => true)
  .catch(() => false);

describe("with Postgres", { skip: dbUp ? false : "Postgres not reachable or schema not pushed" }, () => {
  const cleanup = () =>
    db.delete(schema.workflows).where(like(schema.workflows.ownerSid, "testvisitor_%"));
  before(cleanup);
  after(async () => {
    await cleanup();
    await db.$client.end();
  });

  let aliceWf = "";

  test("compiled workflows belong to the visitor who compiled them", async () => {
    const res = await call(alice, "POST", "/api/workflows/compile", {
      prompt: "When a webhook arrives, summarize it and post to #updates in Slack",
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { workflow: { id: string; ownerSid: string }; offlineFallback: boolean };
    aliceWf = body.workflow.id;
    assert.equal(body.workflow.ownerSid, alice.sid);
    assert.equal(body.offlineFallback, false);
  });

  test("another visitor can't list, read, edit, run or delete it", async () => {
    const list = (await (await call(bob, "GET", "/api/workflows")).json()) as { workflows: { id: string }[] };
    assert.ok(!list.workflows.some((w) => w.id === aliceWf));
    assert.equal((await call(bob, "GET", `/api/workflows/${aliceWf}`)).status, 404);
    assert.equal((await call(bob, "PUT", `/api/workflows/${aliceWf}`, { name: "mine now" })).status, 404);
    assert.equal((await call(bob, "POST", `/api/workflows/${aliceWf}/runs`, { mode: "dry" })).status, 404);
    assert.equal((await call(bob, "GET", `/api/workflows/${aliceWf}/versions`)).status, 404);
    await call(bob, "DELETE", `/api/workflows/${aliceWf}`);
    assert.equal((await call(alice, "GET", `/api/workflows/${aliceWf}`)).status, 200, "still there for its owner");
  });

  test("code nodes, live runs and self-heal without a model are refused", async () => {
    const { workflow } = (await (await call(alice, "GET", `/api/workflows/${aliceWf}`)).json()) as {
      workflow: { graph: { nodes: { id: string; kind: string }[]; edges: unknown[] } };
    };
    const withCode = {
      ...workflow.graph,
      nodes: [...workflow.graph.nodes, { id: "evil", kind: "code", label: "x", config: { source: "1" }, position: { x: 0, y: 0 } }],
    };
    const put = await call(alice, "PUT", `/api/workflows/${aliceWf}`, { graph: withCode });
    assert.equal(put.status, 403);
    assert.match(((await put.json()) as { error: string }).error, /code node/);
    assert.equal((await call(alice, "POST", `/api/workflows/${aliceWf}/runs`, { mode: "live" })).status, 403);
    assert.equal((await call(alice, "PUT", `/api/workflows/${aliceWf}`, { selfHeal: true })).status, 403);
  });

  test("compiles are limited per hour, and fall back to the stub past the daily cap", async () => {
    const compile = (prompt: string) => call(carol, "POST", "/api/workflows/compile", { prompt });
    assert.equal((await compile("x".repeat(201))).status, 400, "over the prompt length cap");

    // Alice used 1 of the 2 daily compiles; Carol's first uses the 2nd, so her second is past the cap.
    const first = await compile("Every hour, post a quote to #random");
    assert.equal(((await first.json()) as { offlineFallback: boolean }).offlineFallback, false);
    const second = await compile("Every hour, post a quote to #random");
    assert.equal(second.status, 200);
    assert.equal(((await second.json()) as { offlineFallback: boolean }).offlineFallback, true);

    const third = await compile("Every hour, post a quote to #random");
    assert.equal(third.status, 429, "2 per hour for this visitor");
    assert.ok(Number(third.headers.get("retry-after")) > 0);
  });

  test("the cleanup job deletes expired visitor workflows only", async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const graph = { name: "old", nodes: [], edges: [] };
    await db.insert(schema.workflows).values([
      { id: "wf_testexpired", name: "old", graph, ownerSid: "testvisitor_old_0000000000", createdAt: old },
      { id: "wf_testfresh", name: "new", graph, ownerSid: "testvisitor_new_0000000000" },
    ]);
    await deleteExpiredDemoRows();
    const left = await db
      .select({ id: schema.workflows.id })
      .from(schema.workflows)
      .where(inArray(schema.workflows.id, ["wf_testexpired", "wf_testfresh"]));
    assert.deepEqual(left.map((r) => r.id), ["wf_testfresh"]);
  });
});
