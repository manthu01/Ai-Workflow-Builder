import { Hono } from "hono";
import { eq, desc, inArray } from "drizzle-orm";
import { db, schema } from "../db/client.js";

export const analyticsRoutes = new Hono();

const ms = (a: Date | null, b: Date | null) =>
  a && b ? Math.max(0, b.getTime() - a.getTime()) : null;

const pct = (sorted: number[], p: number) => {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i]!;
};

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

analyticsRoutes.get("/analytics", async (c) => {
  const wf = c.req.query("workflowId");

  const runs = await db
    .select({
      id: schema.runs.id,
      workflowId: schema.runs.workflowId,
      workflowName: schema.workflows.name,
      mode: schema.runs.mode,
      trigger: schema.runs.trigger,
      status: schema.runs.status,
      startedAt: schema.runs.startedAt,
      finishedAt: schema.runs.finishedAt,
    })
    .from(schema.runs)
    .leftJoin(schema.workflows, eq(schema.workflows.id, schema.runs.workflowId))
    .where(wf ? eq(schema.runs.workflowId, wf) : undefined)
    .orderBy(desc(schema.runs.startedAt))
    .limit(2000);

  const nodeRows = runs.length
    ? await db
        .select()
        .from(schema.nodeRuns)
        .where(inArray(schema.nodeRuns.runId, runs.map((r) => r.id)))
    : [];

  // --- totals ---
  const done = runs.filter((r) => r.status !== "running");
  const succeeded = runs.filter((r) => r.status === "succeeded").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const durations = done
    .map((r) => ms(r.startedAt, r.finishedAt))
    .filter((n): n is number => n !== null);

  const byTrigger: Record<string, number> = { manual: 0, webhook: 0, schedule: 0 };
  for (const r of runs) byTrigger[r.trigger] = (byTrigger[r.trigger] ?? 0) + 1;

  // --- runs per day (last 14) ---
  const days: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    days.push(dayKey(d));
  }
  const perDay = new Map(days.map((d) => [d, { day: d, succeeded: 0, failed: 0, other: 0 }]));
  for (const r of runs) {
    const bucket = perDay.get(dayKey(r.startedAt));
    if (!bucket) continue;
    if (r.status === "succeeded") bucket.succeeded++;
    else if (r.status === "failed") bucket.failed++;
    else bucket.other++;
  }

  // --- per node kind ---
  const byKind = new Map<
    string,
    { kind: string; count: number; succeeded: number; failed: number; skipped: number; durs: number[] }
  >();
  for (const n of nodeRows) {
    if (!n.kind) continue;
    let k = byKind.get(n.kind);
    if (!k) {
      k = { kind: n.kind, count: 0, succeeded: 0, failed: 0, skipped: 0, durs: [] };
      byKind.set(n.kind, k);
    }
    k.count++;
    if (n.status === "succeeded") k.succeeded++;
    else if (n.status === "failed") k.failed++;
    else if (n.status === "skipped") k.skipped++;
    const d = ms(n.startedAt, n.finishedAt);
    if (d !== null) k.durs.push(d);
  }
  const nodePerf = [...byKind.values()]
    .map((k) => {
      const sorted = [...k.durs].sort((a, b) => a - b);
      return {
        kind: k.kind,
        count: k.count,
        succeeded: k.succeeded,
        failed: k.failed,
        skipped: k.skipped,
        successRate: k.count ? k.succeeded / (k.succeeded + k.failed || 1) : 0,
        p50Ms: Math.round(pct(sorted, 50)),
        p95Ms: Math.round(pct(sorted, 95)),
      };
    })
    .sort((a, b) => b.count - a.count);

  const failuresByKind = nodePerf
    .filter((k) => k.failed > 0)
    .map((k) => ({ kind: k.kind, failed: k.failed }))
    .sort((a, b) => b.failed - a.failed);

  return c.json({
    totals: {
      runs: runs.length,
      succeeded,
      failed,
      running: runs.length - done.length,
      successRate: succeeded + failed ? succeeded / (succeeded + failed) : 0,
      dryRuns: runs.filter((r) => r.mode === "dry").length,
      liveRuns: runs.filter((r) => r.mode === "live").length,
      avgRunMs: durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0,
      nodeRuns: nodeRows.length,
    },
    byTrigger,
    perDay: [...perDay.values()],
    nodePerf,
    failuresByKind,
    recentRuns: runs.slice(0, 12).map((r) => ({
      id: r.id,
      workflowName: r.workflowName ?? "(deleted)",
      mode: r.mode,
      trigger: r.trigger,
      status: r.status,
      startedAt: r.startedAt,
      durationMs: ms(r.startedAt, r.finishedAt),
    })),
  });
});
