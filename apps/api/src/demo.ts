/**
 * Public demo mode (DEMO_MODE=true). The app has no user accounts, so a public
 * deployment needs guard rails:
 *
 * - Per-visitor isolation: an anonymous httpOnly `awb_sid` cookie, stored as
 *   workflows.owner_sid; every workflow, run, version and analytics query is
 *   scoped to it. Seeded templates and the sample knowledge base are shared and
 *   read-only.
 * - Dangerous features are off (403 here, hidden in the UI): code and local
 *   nodes, connections, deployments/webhooks, schedules, OpenAPI ingestion,
 *   knowledge base uploads, template publishing, live runs.
 * - The compiler is rate limited per visitor and per IP, with a global daily
 *   cap after which it falls back to the offline stub.
 * - Visitor-owned workflows are deleted after DEMO_RETENTION_HOURS.
 *
 * Counters live in this process's memory: the demo runs one API instance, and
 * a restart resetting them is acceptable.
 */
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { getConnInfo } from "@hono/node-server/conninfo";
import { and, eq, isNotNull, lt, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { WorkflowGraph } from "@awb/core";
import { db, schema } from "./db/client.js";
import { env } from "./env.js";

declare module "hono" {
  interface ContextVariableMap {
    /** The demo visitor's id; null when DEMO_MODE is off (no scoping). */
    sid: string | null;
  }
}

export const SID_COOKIE = "awb_sid";
const SID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const HOUR = 60 * 60 * 1000;

/** Node kinds a demo visitor may not save or run: both execute arbitrary code. */
export const DEMO_BLOCKED_KINDS = ["code", "local"] as const;

/** Features switched off in demo mode, as shown to visitors. */
export const DEMO_DISABLED_FEATURES = [
  "Code and local-execution nodes",
  "Connections (credential vault)",
  "Deployments and webhooks",
  "Schedules",
  "OpenAPI blueprint ingestion",
  "Knowledge base uploads (the sample knowledge base is available)",
  "Publishing templates",
  "Live runs (dry runs only)",
];

/** Sets c.var.sid, issuing an awb_sid cookie to first-time visitors. */
export const demoSession: MiddlewareHandler = async (c, next) => {
  if (!env.DEMO_MODE) {
    c.set("sid", null);
    return next();
  }
  let sid = getCookie(c, SID_COOKIE);
  if (!sid || !SID_PATTERN.test(sid)) {
    sid = nanoid(24);
    const options = {
      httpOnly: true,
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    };
    if (env.DEMO_COOKIE_CROSS_SITE) {
      setCookie(c, SID_COOKIE, sid, { ...options, sameSite: "None", secure: true, partitioned: true });
    } else {
      setCookie(c, SID_COOKIE, sid, { ...options, sameSite: "Lax", secure: env.PUBLIC_URL.startsWith("https://") });
    }
  }
  c.set("sid", sid);
  return next();
};

interface BlockRule {
  methods?: string[];
  path: RegExp;
  feature: string;
}

const WRITE = ["POST", "PUT", "PATCH", "DELETE"];

/**
 * Routes refused in demo mode. Worker-facing /internal/ routes stay open where
 * a demo feature still needs them (sample KB ingestion, retrieve searches).
 */
const BLOCKED_ROUTES: BlockRule[] = [
  { path: /^\/api\/connections(\/|$)/, feature: "Connections" },
  { path: /^\/api\/hooks\//, feature: "Webhook deployments" },
  { path: /^\/api\/(workflows\/[^/]+\/(deploy|deployments)|deployments\/)/, feature: "Deployments" },
  { path: /^\/api\/(workflows\/[^/]+\/schedules?|schedules\/)/, feature: "Schedules" },
  { methods: WRITE, path: /^\/api\/blueprints(\/[^/]+)?$/, feature: "OpenAPI blueprint ingestion" },
  { path: /^\/api\/local-tasks(\/|$)/, feature: "Local execution" },
  { methods: ["POST"], path: /^\/api\/kbs\/?$/, feature: "Creating knowledge bases" },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/kbs\/(?!internal\/)[^/]+$/, feature: "Editing knowledge bases" },
  { methods: WRITE, path: /^\/api\/kbs\/(?!internal\/)[^/]+\/documents(\/|$)/, feature: "Knowledge base uploads" },
  { methods: ["POST"], path: /^\/api\/templates\/?$/, feature: "Publishing templates" },
  { methods: ["DELETE"], path: /^\/api\/templates\/[^/]+$/, feature: "Deleting templates" },
];

export function demoForbidden(c: Context, feature: string) {
  return c.json({ error: `${feature} is disabled in the public demo`, demo: true }, 403);
}

/** Refuses the routes in BLOCKED_ROUTES with a 403 when DEMO_MODE is on. */
export const demoGuard: MiddlewareHandler = async (c, next) => {
  if (!env.DEMO_MODE) return next();
  const rule = BLOCKED_ROUTES.find(
    (r) => r.path.test(c.req.path) && (!r.methods || r.methods.includes(c.req.method)),
  );
  if (rule) return demoForbidden(c, rule.feature);
  return next();
};

/** The node kinds in a graph that demo mode refuses, or [] (always [] outside demo mode). */
export function demoBlockedKinds(graph: WorkflowGraph): string[] {
  if (!env.DEMO_MODE) return [];
  const blocked = new Set<string>(DEMO_BLOCKED_KINDS);
  return [...new Set(graph.nodes.map((n) => n.kind).filter((k) => blocked.has(k)))];
}

/** A 403 for a graph containing demo-blocked node kinds, or null if it's allowed. */
export function demoGraphGuard(c: Context, graph: WorkflowGraph) {
  const kinds = demoBlockedKinds(graph);
  return kinds.length ? demoForbidden(c, `The ${kinds.join(" and ")} node`) : null;
}

/** Where-clause scoping workflows to the current visitor (undefined = no scoping). */
export function ownerFilter(c: Context): SQL | undefined {
  const sid = c.get("sid");
  return sid ? eq(schema.workflows.ownerSid, sid) : undefined;
}

/** A workflow by id, only if the current visitor owns it (any workflow outside demo mode). */
export async function findWorkflow(c: Context, id: string) {
  const [row] = await db
    .select()
    .from(schema.workflows)
    .where(and(eq(schema.workflows.id, id), ownerFilter(c)));
  return row;
}

/** A run by id, only if it belongs to one of the current visitor's workflows. */
export async function findRun(c: Context, runId: string) {
  const [row] = await db
    .select({ run: schema.runs })
    .from(schema.runs)
    .innerJoin(schema.workflows, eq(schema.workflows.id, schema.runs.workflowId))
    .where(and(eq(schema.runs.id, runId), ownerFilter(c)));
  return row?.run;
}

/** Best-effort client IP. Behind the demo's reverse proxy the first X-Forwarded-For entry is the client. */
export function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const real = c.req.header("x-real-ip");
  if (real) return real;
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Counts events per key in a rolling window. */
export class RollingLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly windowMs: number,
    private readonly limit: number,
  ) {}

  private recent(key: string, now: number): number[] {
    const kept = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (kept.length) this.hits.set(key, kept);
    else this.hits.delete(key);
    return kept;
  }

  remaining(key: string, now = Date.now()): number {
    return Math.max(0, this.limit - this.recent(key, now).length);
  }

  /** Seconds until the oldest hit leaves the window (0 if there is room now). */
  retryAfter(key: string, now = Date.now()): number {
    const hits = this.recent(key, now);
    if (hits.length < this.limit) return 0;
    return Math.ceil((hits[0]! + this.windowMs - now) / 1000);
  }

  record(key: string, now = Date.now()) {
    this.hits.set(key, [...this.recent(key, now), now]);
  }

  /** Drops keys with no hits left in the window, so memory doesn't grow with visitors. */
  prune(now = Date.now()) {
    for (const key of [...this.hits.keys()]) this.recent(key, now);
  }
}

const compileLimiter = new RollingLimiter(HOUR, env.DEMO_COMPILES_PER_HOUR);
const liveLlmLimiter = new RollingLimiter(HOUR, 1);
let daily = { day: "", count: 0 };

const today = () => new Date().toISOString().slice(0, 10);
function dailyCount(): number {
  if (daily.day !== today()) daily = { day: today(), count: 0 };
  return daily.count;
}

export type CompileBudget =
  | { ok: true; useStub: boolean }
  | { ok: false; error: string; retryAfter: number };

/**
 * Takes one unit of compile budget for the current visitor. Compiles and
 * self-heal attempts share it. Past the global daily cap the request still goes
 * through, on the offline stub compiler.
 */
export function takeCompileBudget(c: Context): CompileBudget {
  if (!env.DEMO_MODE) return { ok: true, useStub: false };
  const keys = [`sid:${c.get("sid")}`, `ip:${clientIp(c)}`];
  const wait = Math.max(...keys.map((k) => compileLimiter.retryAfter(k)));
  if (wait > 0) {
    return {
      ok: false,
      error: `Demo limit: ${env.DEMO_COMPILES_PER_HOUR} compiles per hour. Try again in ${Math.ceil(wait / 60)} min.`,
      retryAfter: wait,
    };
  }
  for (const k of keys) compileLimiter.record(k);
  const useStub = dailyCount() >= env.DEMO_COMPILES_PER_DAY;
  daily.count++;
  return { ok: true, useStub };
}

/** Whether demo visitors can get a real model at all (compiles, self-heal, the live LLM run). */
export const demoHasModel = () => env.COMPILER_MODE === "claude" && Boolean(env.ANTHROPIC_API_KEY);

/** One dry run per visitor per hour may call the real model for its llm nodes (fast tier). */
export function takeLiveLlm(c: Context): boolean {
  if (!env.DEMO_MODE || !demoHasModel()) return false;
  const keys = [`sid:${c.get("sid")}`, `ip:${clientIp(c)}`];
  if (keys.some((k) => liveLlmLimiter.remaining(k) === 0)) return false;
  for (const k of keys) liveLlmLimiter.record(k);
  return true;
}

/** What the UI needs to render demo mode (banner, disabled controls, remaining budget). */
export function demoStatus(c: Context) {
  if (!env.DEMO_MODE) return { demo: false as const };
  const keys = [`sid:${c.get("sid")}`, `ip:${clientIp(c)}`];
  const offline = !demoHasModel() || dailyCount() >= env.DEMO_COMPILES_PER_DAY;
  return {
    demo: true as const,
    repoUrl: env.DEMO_REPO_URL,
    compiler: offline ? ("stub" as const) : ("claude" as const),
    compilesLeftThisHour: Math.min(...keys.map((k) => compileLimiter.remaining(k))),
    compilesPerHour: env.DEMO_COMPILES_PER_HOUR,
    promptMaxChars: env.DEMO_PROMPT_MAX_CHARS,
    selfHealAvailable: demoHasModel(),
    liveLlmAvailable: demoHasModel() && keys.every((k) => liveLlmLimiter.remaining(k) > 0),
    retentionHours: env.DEMO_RETENTION_HOURS,
    blockedKinds: DEMO_BLOCKED_KINDS,
    disabled: DEMO_DISABLED_FEATURES,
  };
}

/** Deletes visitor-owned workflows (and, by cascade, their runs and versions) past retention. */
export async function deleteExpiredDemoRows(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - env.DEMO_RETENTION_HOURS * HOUR);
  const deleted = await db
    .delete(schema.workflows)
    .where(and(isNotNull(schema.workflows.ownerSid), lt(schema.workflows.createdAt, cutoff)))
    .returning({ id: schema.workflows.id });
  return deleted.length;
}

/** Hourly cleanup in demo mode: expired visitor rows and idle rate-limit keys. */
export function startDemoCleanup() {
  if (!env.DEMO_MODE) return;
  const sweep = async () => {
    try {
      const n = await deleteExpiredDemoRows();
      if (n) console.log(`[demo] deleted ${n} expired visitor workflow(s)`);
    } catch (err) {
      console.error("[demo] cleanup failed", err);
    }
    compileLimiter.prune();
    liveLlmLimiter.prune();
  };
  void sweep();
  setInterval(() => void sweep(), HOUR).unref();
}
