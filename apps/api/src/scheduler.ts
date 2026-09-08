import { CronExpressionParser } from "cron-parser";
import { and, eq, lte, isNull, or } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { startRun } from "./engine.js";

const TICK_MS = 20_000;

/** Next fire time for a cron expression in a timezone, after `from`. */
export function nextFire(cron: string, timezone: string, from = new Date()): Date {
  const it = CronExpressionParser.parse(cron, { currentDate: from, tz: timezone });
  return it.next().toDate();
}

/** Throws if the cron expression is invalid. */
export function assertValidCron(cron: string, timezone: string): void {
  CronExpressionParser.parse(cron, { tz: timezone });
}

let timer: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  const now = new Date();
  const due = await db
    .select()
    .from(schema.schedules)
    .where(
      and(
        eq(schema.schedules.status, "active"),
        or(isNull(schema.schedules.nextRunAt), lte(schema.schedules.nextRunAt, now)),
      ),
    );

  for (const sched of due) {
    // Advance nextRunAt first so a slow run can't double-fire.
    let next: Date;
    try {
      next = nextFire(sched.cron, sched.timezone, now);
    } catch {
      await db
        .update(schema.schedules)
        .set({ status: "paused" })
        .where(eq(schema.schedules.id, sched.id));
      continue;
    }
    await db
      .update(schema.schedules)
      .set({ nextRunAt: next })
      .where(eq(schema.schedules.id, sched.id));

    // Skip the very first tick after creation (nextRunAt was null): just schedule.
    if (sched.nextRunAt === null) continue;

    try {
      const [wf] = await db
        .select({ selfHeal: schema.workflows.selfHeal })
        .from(schema.workflows)
        .where(eq(schema.workflows.id, sched.workflowId));
      const { done } = await startRun({
        workflowId: sched.workflowId,
        graph: sched.graphSnapshot,
        mode: "live",
        trigger: "schedule",
        scheduleId: sched.id,
        triggerPayload: { scheduledFor: now.toISOString(), cron: sched.cron },
        selfHeal: wf?.selfHeal ?? false,
      });
      void done.catch(() => {});
      await db
        .update(schema.schedules)
        .set({ lastRunAt: now, runCount: sched.runCount + 1 })
        .where(eq(schema.schedules.id, sched.id));
    } catch (err) {
      console.error(`[scheduler] schedule ${sched.id} failed to start`, err);
    }
  }
}

export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick().catch((e) => console.error("[scheduler] tick error", e));
  }, TICK_MS);
  console.log(`[scheduler] running (every ${TICK_MS / 1000}s)`);
}
