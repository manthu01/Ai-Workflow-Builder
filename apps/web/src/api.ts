import type {
  Connection,
  ConnectionKind,
  Deployment,
  GraphIssue,
  NodeCatalogEntry,
  RunResult,
  WorkflowGraph,
  WorkflowRecord,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error ?? `${res.status} ${res.statusText}`) as Error & {
      issues?: GraphIssue[];
      status?: number;
    };
    err.issues = body.issues;
    err.status = res.status;
    throw err;
  }
  return body as T;
}

export interface CompileResponse {
  workflow: WorkflowRecord;
  provider: string;
  attempts: number;
  warnings: GraphIssue[];
}

export const api = {
  nodeCatalog: () => request<{ nodes: NodeCatalogEntry[] }>("/api/node-catalog"),

  compile: (prompt: string) =>
    request<CompileResponse>("/api/workflows/compile", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),

  listWorkflows: () =>
    request<{ workflows: WorkflowRecord[] }>("/api/workflows"),

  getWorkflow: (id: string) =>
    request<{ workflow: WorkflowRecord; issues: GraphIssue[] }>(`/api/workflows/${id}`),

  updateGraph: (id: string, graph: WorkflowGraph) =>
    request<{ workflow: WorkflowRecord; issues: GraphIssue[] }>(`/api/workflows/${id}`, {
      method: "PUT",
      body: JSON.stringify({ graph }),
    }),

  relayout: (id: string, graph: WorkflowGraph) =>
    request<{ workflow: WorkflowRecord; issues: GraphIssue[] }>(
      `/api/workflows/${id}/relayout`,
      { method: "POST", body: JSON.stringify({ graph }) },
    ),

  run: (id: string, mode: "dry" | "live") =>
    request<{ run: { id: string; status: string; mode: string }; result: RunResult }>(
      `/api/workflows/${id}/runs`,
      { method: "POST", body: JSON.stringify({ mode }) },
    ),

  listConnections: () => request<{ connections: Connection[] }>("/api/connections"),

  createConnection: (body: {
    name: string;
    kind: ConnectionKind;
    secret: Record<string, string>;
  }) =>
    request<{ connection: Connection }>("/api/connections", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deleteConnection: (id: string) =>
    request<unknown>(`/api/connections/${id}`, { method: "DELETE" }),

  deploy: (workflowId: string) =>
    request<{ deployment: Deployment }>(`/api/workflows/${workflowId}/deploy`, {
      method: "POST",
    }),

  listDeployments: (workflowId: string) =>
    request<{ deployments: Deployment[] }>(`/api/workflows/${workflowId}/deployments`),

  setDeploymentStatus: (id: string, action: "pause" | "resume") =>
    request<{ deployment: Deployment }>(`/api/deployments/${id}/${action}`, {
      method: "POST",
    }),

  deleteDeployment: (id: string) =>
    request<unknown>(`/api/deployments/${id}`, { method: "DELETE" }),

  fireHook: (url: string, payload: unknown) =>
    // Use the dev proxy path rather than the absolute PUBLIC_URL.
    request<{ runId: string; status: string; result: RunResult }>(
      url.replace(/^https?:\/\/[^/]+/, ""),
      { method: "POST", body: JSON.stringify(payload) },
    ),
};
