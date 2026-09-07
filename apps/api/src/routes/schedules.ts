import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { validateGraph } from "@awb/core";
import { db, schema } from "../db/client.js";
import { newId } from "../id.js";
import { assertValidCron, nextFire } from "../scheduler.js";

export const scheduleRoutes = new Hono();

const CreateBody = z.object({
  cron: z.string().min(1).max(120),
  timezone: z.string().default("UTC"),
});

const view = (s: typeof schema.schedules.$inferSelect) => ({
  id: s.id,
  workflowId: s.workflowId,
  cron: s.cron,
  timezone: s.timezone,
  status: s.status,
  nextRunAt: s.nextRunAt,
  lastRunAt: s.lastRunAt,
  runCount: s.runCount,
  createdAt: s.createdAt,
});

scheduleRoutes.post("/workflows/:id/schedule", async (c) => {
  const workflowId = c.req.param("id");
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "cron is required" }, 400);

  const [wf] = await db
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.id, workflowId));
  if (!wf) return c.json({ error: "workflow not found" }, 404);

  const blocking = validateGraph(wf.graph).filter((i) => i.level === "error");
  if (blocking.length > 0) {
    return c.json({ error: "fix validation errors before scheduling", issues: blocking }, 422);
  }

  let next: Date;
  try {
    assertValidCron(parsed.data.cron, parsed.data.timezone);
    next = nextFire(parsed.data.cron, parsed.data.timezone);
  } catch (err) {
    return c.json({ error: `invalid cron/timezone: ${(err as Error).message}` }, 400);
  }

  const [row] = await db
    .insert(schema.schedules)
    .values({
      id: newId("sch"),
      workflowId,
      cron: parsed.data.cron,
      timezone: parsed.data.timezone,
      status: "active",
      graphSnapshot: wf.graph,
      nextRunAt: next,
    })
    .returning();

  return c.json({ schedule: view(row!) });
});

scheduleRoutes.get("/workflows/:id/schedules", async (c) => {
  const rows = await db
    .select()
    .from(schema.schedules)
    .where(eq(schema.schedules.workflowId, c.req.param("id")))
    .orderBy(desc(schema.schedules.createdAt));
  return c.json({ schedules: rows.map(view) });
});

scheduleRoutes.post("/schedules/:id/:action{pause|resume}", async (c) => {
  const id = c.req.param("id");
  const resume = c.req.param("action") === "resume";
  const [existing] = await db
    .select()
    .from(schema.schedules)
    .where(eq(schema.schedules.id, id));
  if (!existing) return c.json({ error: "not found" }, 404);

  const [row] = await db
    .update(schema.schedules)
    .set({
      status: resume ? "active" : "paused",
      nextRunAt: resume
        ? nextFire(existing.cron, existing.timezone)
        : existing.nextRunAt,
    })
    .where(eq(schema.schedules.id, id))
    .returning();
  return c.json({ schedule: view(row!) });
});

scheduleRoutes.delete("/schedules/:id", async (c) => {
  await db.delete(schema.schedules).where(eq(schema.schedules.id, c.req.param("id")));
  return c.body(null, 204);
});
