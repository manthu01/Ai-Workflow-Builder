import type { WorkflowNode } from "@awb/core";

export interface NodeExecCtx {
  mode: "dry" | "live";
  dryRunLlm: "mock" | "live";
  /** All node outputs produced so far, keyed by node id (for templating). */
  outputs: Record<string, unknown>;
  /** Real event body for webhook-triggered runs; used by the trigger node. */
  triggerPayload?: unknown;
}

export interface NodeExecResult {
  output: unknown;
  logs: string[];
}

export type NodeExecutor = (
  node: WorkflowNode,
  ctx: NodeExecCtx,
) => Promise<NodeExecResult>;
