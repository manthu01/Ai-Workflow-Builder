import { eq } from "drizzle-orm";
import {
  WorkflowExecuteWorkflowType,
  type RunResult,
  type WorkflowGraph,
} from "@awb/core";
import { db, schema } from "./db/client.js";
import { newId } from "./id.js";
import { env } from "./env.js";
import { getTemporalClient, type ExecuteWorkflowInput } from "./temporal/client.js";

export interface StartRunOptions {
  workflowId: string;
  graph: WorkflowGraph;
  mode: "dry" | "live";
  trigger?: "manual" | "webhook";
  deploymentId?: string;
  triggerPayload?: unknown;
}

export interface StartedRun {
  runId: string;
  result: RunResult;
}

/**
 * Starts one Temporal execution of a graph, waits for it, and persists the run
 * plus its per-node rows. Shared by manual runs and webhook-triggered runs.
 */
export async function startRun(opts: StartRunOptions): Promise<StartedRun> {
  const runId = newId("run");
  const temporalWorkflowId = `awb-${runId}`;

  await db.insert(schema.runs).values({
    id: runId,
    workflowId: opts.workflowId,
    mode: opts.mode,
    trigger: opts.trigger ?? "manual",
    deploymentId: opts.deploymentId ?? null,
    status: "running",
    temporalWorkflowId,
  });

  const input: ExecuteWorkflowInput = {
    runId,
    workflowId: opts.workflowId,
    mode: opts.mode,
    graph: opts.graph,
    dryRunLlm: env.DRY_RUN_LLM,
    triggerPayload: opts.triggerPayload,
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
    throw err;
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

  return { runId, result };
}
