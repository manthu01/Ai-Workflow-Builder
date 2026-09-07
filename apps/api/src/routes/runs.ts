import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { validateGraph, RunProgressQueryName, type RunResult } from "@awb/core";
import { db, schema } from "../db/client.js";
import { startRun, finalizeRun } from "../engine.js";
import { getTemporalClient } from "../temporal/client.js";

export const runRoutes = new Hono();

const StartBody = z.object({ mode: z.enum(["dry", "live"]).default("dry") });

/** Start a run and return immediately; stream progress from /runs/:id/stream. */
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
    const { runId, done } = await startRun({
      workflowId,
      graph: wf.graph,
      mode: parsed.data.mode,
      trigger: "manual",
    });
    void done.catch(() => {}); // background-finalized; no one awaits here
    return c.json({ runId, mode: parsed.data.mode }, 202);
  } catch (err) {
    console.error("run start failed", err);
    return c.json({ error: `engine error: ${(err as Error).message}` }, 502);
  }
});

/** Server-Sent Events: live per-node progress until the engine finishes. */
runRoutes.get("/runs/:id/stream", (c) => {
  return streamSSE(c, async (stream) => {
    const [run] = await db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.id, c.req.param("id")));
    if (!run) {
      await stream.writeSSE({ event: "error", data: "run not found" });
      return;
    }

    // Already finished: replay the persisted result and close.
    if (run.status !== "running") {
      const nodes = await db
        .select()
        .from(schema.nodeRuns)
        .where(eq(schema.nodeRuns.runId, run.id));
      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({
          runId: run.id,
          workflowId: run.workflowId,
          mode: run.mode,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          nodes: nodes.map((n) => ({
            nodeId: n.nodeId,
            status: n.status,
            input: n.input,
            output: n.output,
            error: n.error ?? undefined,
            logs: n.logs,
            attempts: n.attempts,
          })),
        }),
      });
      return;
    }

    const client = await getTemporalClient();
    const handle = client.workflow.getHandle(run.temporalWorkflowId);

    let final: RunResult | null = null;
    let failure: unknown = null;
    void handle
      .result()
      .then((r) => finalizeRun(run.id, r).then(() => (final = r)))
      .catch((e) => (failure = e));

    while (!final && !failure && !stream.aborted) {
      try {
        const progress = await handle.query(RunProgressQueryName);
        await stream.writeSSE({ event: "progress", data: JSON.stringify(progress) });
      } catch {
        /* query not ready yet or workflow just completed */
      }
      await stream.sleep(400);
    }

    if (stream.aborted) return;
    await stream.writeSSE({
      event: "done",
      data: JSON.stringify(
        final ?? { runId: run.id, status: "failed", nodes: [], error: String(failure) },
      ),
    });
  });
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
