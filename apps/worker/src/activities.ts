import { Context } from "@temporalio/activity";
import type { ModelTier, WorkflowNode } from "@awb/core";
import { NODE_EXECUTORS, type NodeExecCtx } from "./nodes/index.js";
import { env } from "./env.js";

export { healNode } from "./heal.js";
export type { HealNodeParams, HealNodeOutput } from "./heal.js";
export { enqueueLocalTask } from "./local.js";
export type { EnqueueLocalTaskParams } from "./local.js";
export {
  markDocumentStatus,
  parseDocument,
  chunkPages,
  findReusableVectors,
  embedChunkBatch,
  storeChunks,
} from "./ingest/activities.js";

export interface ExecuteNodeParams {
  node: WorkflowNode;
  mode: "dry" | "live";
  dryRunLlm: "mock" | "live";
  llmTier?: ModelTier;
  /** All upstream node outputs produced so far, keyed by node id. */
  outputs: Record<string, unknown>;
  triggerPayload?: unknown;
}

export interface ExecuteNodeOutput {
  output: unknown;
  logs: string[];
  attempts: number;
  startedAt: string;
  finishedAt: string;
}

/**
 * Runs one node. Any throw here is retried by Temporal per the workflow's retry
 * policy; an exhausted retry surfaces to the workflow as an ActivityFailure.
 */
export async function executeNode(params: ExecuteNodeParams): Promise<ExecuteNodeOutput> {
  const executor = NODE_EXECUTORS[params.node.kind];
  if (!executor) throw new Error(`no executor registered for node kind "${params.node.kind}"`);
  // The API already refuses these in demo mode; this is the worker's own backstop.
  if (env.DEMO_MODE && params.mode === "live") throw new Error("live runs are disabled in the public demo");
  if (env.DEMO_MODE && params.node.kind === "code") throw new Error("code nodes are disabled in the public demo");

  const ctx: NodeExecCtx = {
    mode: params.mode,
    dryRunLlm: params.dryRunLlm,
    llmTier: params.llmTier,
    outputs: params.outputs,
    triggerPayload: params.triggerPayload,
  };

  const startedAt = new Date().toISOString();
  const { output, logs } = await executor(params.node, ctx);
  return {
    output,
    logs,
    attempts: Context.current().info.attempt,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
