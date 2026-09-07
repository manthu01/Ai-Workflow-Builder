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
  trigger?: "manual" | "webhook" | "schedule";
  deploymentId?: string;
  scheduleId?: string;
  triggerPayload?: unknown;
}

export interface StartedRun {
  runId: string;
  temporalWorkflowId: string;
  /** Resolves when the engine finishes; the run + node rows are persisted by then. */
  done: Promise<RunResult>;
}

/**
 * Starts one Temporal execution of a graph. Returns immediately with a handle to
 * the run; the final run + per-node rows are persisted in the background when
 * the engine finishes (whether or not anyone awaits `done`).
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
    scheduleId: opts.scheduleId ?? null,
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

  const client = await getTemporalClient();
  const handle = await client.workflow.start(WorkflowExecuteWorkflowType, {
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowId: temporalWorkflowId,
    args: [input],
  });

  const done = handle
    .result()
    .then(async (result) => {
      await finalizeRun(runId, result);
      return result;
    })
    .catch(async (err) => {
      await db
        .update(schema.runs)
        .set({ status: "failed", error: (err as Error).message, finishedAt: new Date() })
        .where(eq(schema.runs.id, runId));
      throw err;
    });

  return { runId, temporalWorkflowId, done };
}

let finalizing = new Set<string>();

/** Persist the final run status + per-node rows exactly once. */
export async function finalizeRun(runId: string, result: RunResult): Promise<void> {
  if (finalizing.has(runId)) return;
  finalizing.add(runId);
  try {
    const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, runId));
    if (!run || run.status !== "running") return; // already finalized

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
  } finally {
    finalizing.delete(runId);
  }
}
