import type { ModelTier, WorkflowNode } from "@awb/core";

export interface NodeExecCtx {
  mode: "dry" | "live";
  dryRunLlm: "mock" | "live";
  /** Overrides each llm node's tier and model (demo live-LLM runs use "fast"). */
  llmTier?: ModelTier;
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
