import { z } from "zod";
import type { WorkflowGraph } from "./graph.js";

export const RunMode = z.enum(["dry", "live"]);
export type RunMode = z.infer<typeof RunMode>;

/** Temporal workflow type name shared by the API (starter) and worker. */
export const WorkflowExecuteWorkflowType = "executeWorkflow";

/** The single argument the engine workflow receives. */
export interface WorkflowExecutionInput {
  runId: string;
  workflowId: string;
  mode: "dry" | "live";
  graph: WorkflowGraph;
  dryRunLlm: "mock" | "live";
  /**
   * For deployment/webhook runs: the real event body, used as the trigger
   * node's output instead of its configured sample payload.
   */
  triggerPayload?: unknown;
}

export const NodeRunStatus = z.enum([
  "pending",
  "running",
  "awaiting",
  "succeeded",
  "failed",
  "skipped",
]);
export type NodeRunStatus = z.infer<typeof NodeRunStatus>;

/** Temporal signal name for a human approval decision on an approval node. */
export const ApprovalSignalName = "approvalDecision";

export interface ApprovalDecision {
  nodeId: string;
  decision: "approved" | "rejected";
  note?: string;
  by?: string;
}

export const NodeRunResultSchema = z.object({
  nodeId: z.string(),
  status: NodeRunStatus,
  /** Merged upstream outputs the node received. */
  input: z.unknown().optional(),
  /** What the node produced (available to downstream nodes as ctx[nodeId]). */
  output: z.unknown().optional(),
  error: z.string().optional(),
  /** Notes surfaced in the debugger, e.g. "dry run: Slack post not sent". */
  logs: z.array(z.string()).default([]),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  attempts: z.number().default(1),
});
export type NodeRunResult = z.infer<typeof NodeRunResultSchema>;

export const RunStatus = z.enum(["running", "succeeded", "failed"]);
export type RunStatus = z.infer<typeof RunStatus>;

/** Temporal query name the engine workflow answers with a live progress snapshot. */
export const RunProgressQueryName = "getRunProgress";

export interface RunProgress {
  status: RunStatus;
  nodes: NodeRunResult[];
  startedAt: string;
}

export const RunResultSchema = z.object({
  runId: z.string(),
  workflowId: z.string(),
  mode: RunMode,
  status: RunStatus,
  nodes: z.array(NodeRunResultSchema),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
});
export type RunResult = z.infer<typeof RunResultSchema>;
