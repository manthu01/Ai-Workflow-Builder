import type { GraphIssue, RunResult, WorkflowGraph, WorkflowRecord } from "./types";

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

  run: (id: string, mode: "dry" | "live") =>
    request<{ run: { id: string; status: string; mode: string }; result: RunResult }>(
      `/api/workflows/${id}/runs`,
      { method: "POST", body: JSON.stringify({ mode }) },
    ),
};
