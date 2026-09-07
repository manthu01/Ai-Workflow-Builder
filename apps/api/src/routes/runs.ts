import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { WorkflowExecuteWorkflowType, type RunResult, validateGraph } from "@awb/core";
import { db, schema } from "../db/client.js";
import { newId } from "../id.js";
import { env } from "../env.js";
import { getTemporalClient, type ExecuteWorkflowInput } from "../temporal/client.js";

export const runRoutes = new Hono();

const StartBody = z.object({ mode: z.enum(["dry", "live"]).default("dry") });

/** Start a run of a workflow and wait for the engine to finish. */
runRoutes.post("/workflows/:id/runs", async (c) => {
  const workflowId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = StartBody.safeParse(body);
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

  const runId = newId("run");
  const temporalWorkflowId = `awb-${runId}`;

  await db.insert(schema.runs).values({
    id: runId,
    workflowId,
    mode: parsed.data.mode,
    status: "running",
    temporalWorkflowId,
  });

  const input: ExecuteWorkflowInput = {
    runId,
    workflowId,
    mode: parsed.data.mode,
    graph: wf.graph,
    dryRunLlm: env.DRY_RUN_LLM,
  };

  let result: RunResult;
  try {
    const client = await getTemporalClient();
    const handle = await client.workflow.start(WorkflowExecuteWorkflowType, {
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      workflowId: temporalWorkflowId,
      args: [input],
    });
    result = await handle.result();
  } catch (err) {
    await db
      .update(schema.runs)
      .set({ status: "failed", error: (err as Error).message, finishedAt: new Date() })
      .where(eq(schema.runs.id, runId));
    console.error("run failed", err);
    return c.json({ error: `engine error: ${(err as Error).message}`, runId }, 502);
  }

  await db
    .update(schema.runs)
    .set({
      status: result.status,
      finishedAt: result.finishedAt ? new Date(result.finishedAt) : new Date(),
    })
    .where(eq(schema.runs.id, runId));

  if (result.nodes.length > 0) {
    await db.insert(schema.nodeRuns).values(
      result.nodes.map((n) => ({
        id: newId("nr"),
        runId,
        nodeId: n.nodeId,
        status: n.status,
        input: n.input ?? null,
        output: n.output ?? null,
        error: n.error ?? null,
        logs: n.logs ?? [],
        attempts: n.attempts ?? 1,
        startedAt: n.startedAt ? new Date(n.startedAt) : null,
        finishedAt: n.finishedAt ? new Date(n.finishedAt) : null,
      })),
    );
  }

  return c.json({ run: { id: runId, status: result.status, mode: result.mode }, result });
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
