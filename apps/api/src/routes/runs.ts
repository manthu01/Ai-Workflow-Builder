import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { validateGraph } from "@awb/core";
import { db, schema } from "../db/client.js";
import { startRun } from "../engine.js";

export const runRoutes = new Hono();

const StartBody = z.object({ mode: z.enum(["dry", "live"]).default("dry") });

/** Start a run of a workflow and wait for the engine to finish. */
runRoutes.post("/workflows/:id/runs", async (c) => {
  const workflowId = c.req.param("id");
  const parsed = StartBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);

  const [wf] = await db
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.id, workflowId));
  if (!wf) return c.json({ error: "workflow not found" }, 404);

  const blocking = validateGraph(wf.graph).filter((i) => i.level === "error");
  if (blocking.length > 0) {
    return c.json({ error: "workflow has validation errors", issues: blocking }, 422);
  }

  try {
    const { runId, result } = await startRun({
      workflowId,
      graph: wf.graph,
      mode: parsed.data.mode,
      trigger: "manual",
    });
    return c.json({ run: { id: runId, status: result.status, mode: result.mode }, result });
  } catch (err) {
    console.error("run failed", err);
    return c.json({ error: `engine error: ${(err as Error).message}` }, 502);
  }
});

runRoutes.get("/workflows/:id/runs", async (c) => {
  const rows = await db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.workflowId, c.req.param("id")))
    .orderBy(desc(schema.runs.startedAt));
  return c.json({ runs: rows });
});

runRoutes.get("/runs/:id", async (c) => {
  const [run] = await db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.id, c.req.param("id")));
  if (!run) return c.json({ error: "not found" }, 404);
  const nodes = await db
    .select()
    .from(schema.nodeRuns)
    .where(eq(schema.nodeRuns.runId, run.id));
  return c.json({ run, nodes });
});
