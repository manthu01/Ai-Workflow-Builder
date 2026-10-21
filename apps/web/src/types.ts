export type NodeKind =
  | "trigger"
  | "llm"
  | "http_request"
  | "transform"
  | "branch"
  | "loop"
  | "code"
  | "asset"
  | "api_call"
  | "retrieve"
  | "local"
  | "approval"
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
  sourceHandle?: string;
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
  selfHeal: boolean;
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
  widget: "text" | "textarea" | "select" | "json" | "connection" | "blueprint" | "knowledge_base";
  options?: string[];
  connectionKind?: "slack" | "http_header";
  placeholder?: string;
  help?: string;
  default: string;
  optional?: boolean;
}

export type ConnectionKind = "slack" | "http_header";

export interface Connection {
  id: string;
  name: string;
  kind: ConnectionKind;
  createdAt: string;
}

export interface Deployment {
  id: string;
  workflowId: string;
  status: "active" | "paused";
  url: string;
  fireCount: number;
  lastFiredAt: string | null;
  createdAt: string;
}

export interface Schedule {
  id: string;
  workflowId: string;
  cron: string;
  timezone: string;
  status: "active" | "paused";
  nextRunAt: string | null;
  lastRunAt: string | null;
  runCount: number;
  createdAt: string;
}

export interface Analytics {
  totals: {
    runs: number;
    succeeded: number;
    failed: number;
    running: number;
    successRate: number;
    dryRuns: number;
    liveRuns: number;
    avgRunMs: number;
    nodeRuns: number;
  };
  byTrigger: Record<string, number>;
  perDay: { day: string; succeeded: number; failed: number; other: number }[];
  nodePerf: {
    kind: string;
    count: number;
    succeeded: number;
    failed: number;
    skipped: number;
    successRate: number;
    p50Ms: number;
    p95Ms: number;
  }[];
  failuresByKind: { kind: string; failed: number }[];
  recentRuns: {
    id: string;
    workflowName: string;
    mode: string;
    trigger: string;
    status: string;
    startedAt: string;
    durationMs: number | null;
  }[];
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  embeddingModel: string;
  dimensions: number;
  documentCount: number;
  chunkCount: number;
  /** http_header connection used to fetch this KB's URL documents. */
  connectionId: string | null;
  createdAt: string;
}

export interface KbDocument {
  id: string;
  kbId: string;
  filename: string;
  mimeType: string;
  sourceUrl: string | null;
  status: "pending" | "indexing" | "ready" | "failed";
  error: string | null;
  chunkCount: number;
  reusedChunkCount: number;
  createdAt: string;
}

export type RetrievalMode = "vector" | "keyword" | "hybrid";

/** Mirrors RetrievedChunk in packages/core/src/rag.ts. */
export interface RetrievedChunk {
  id: string;
  content: string;
  score: number;
  documentId: string;
  document: string;
  page?: number;
  heading?: string;
  ranks?: { vector: number | null; keyword: number | null };
  retrievalScore?: number;
}

export interface ApiBlueprint {
  id: string;
  name: string;
  baseUrl: string;
  operationCount: number;
  operations: {
    operationId: string;
    method: string;
    path: string;
    summary: string;
    params: { name: string; in: string; required: boolean }[];
  }[];
  createdAt: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  author: string;
  builtIn: boolean;
  cloneCount: number;
  nodeCount: number;
  edgeCount: number;
  kinds: string[];
  createdAt: string;
}

export interface WorkflowVersion {
  id: string;
  version: number;
  label: string | null;
  source: "compile" | "edit" | "deploy" | "run" | "rollback";
  nodeCount: number;
  edgeCount: number;
  createdAt: string;
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
  | "awaiting"
  | "succeeded"
  | "failed"
  | "skipped";

export interface NodeRunResult {
  nodeId: string;
  kind?: string;
  status: NodeRunStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  logs: string[];
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  healed?: {
    explanation: string;
    from: Record<string, unknown>;
    to: Record<string, unknown>;
    succeeded: boolean;
  };
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

/** GET /api/demo: whether this is the public demo, and what it allows. */
export type DemoStatus =
  | { demo: false }
  | {
      demo: true;
      repoUrl: string;
      /** "stub" = the offline rule-based compiler, not an AI model. */
      compiler: "claude" | "stub";
      compilesLeftThisHour: number;
      compilesPerHour: number;
      promptMaxChars: number;
      selfHealAvailable: boolean;
      liveLlmAvailable: boolean;
      retentionHours: number;
      blockedKinds: string[];
      disabled: string[];
    };
