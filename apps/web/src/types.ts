export type NodeKind =
  | "trigger"
  | "llm"
  | "http_request"
  | "transform"
  | "slack_post";

export interface WorkflowNode {
  id: string;
  kind: NodeKind;
  label: string;
  config: Record<string, string>;
  position: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowGraph {
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowRecord {
  id: string;
  name: string;
  description: string | null;
  graph: WorkflowGraph;
  sourcePrompt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GraphIssue {
  level: "error" | "warning";
  nodeId?: string;
  message: string;
}

export interface NodeFieldSpec {
  key: string;
  label: string;
  widget: "text" | "textarea" | "select" | "json";
  options?: string[];
  placeholder?: string;
  help?: string;
  default: string;
}

export interface NodeCatalogEntry {
  kind: NodeKind;
  title: string;
  description: string;
  isTrigger: boolean;
  hasSideEffects: boolean;
  configFields: string;
  fields: NodeFieldSpec[];
}

export type NodeRunStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export interface NodeRunResult {
  nodeId: string;
  status: NodeRunStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  logs: string[];
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
}

export interface RunResult {
  runId: string;
  workflowId: string;
  mode: "dry" | "live";
  status: "running" | "succeeded" | "failed";
  nodes: NodeRunResult[];
  startedAt: string;
  finishedAt?: string;
}
