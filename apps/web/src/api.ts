import type {
  Analytics,
  Connection,
  ConnectionKind,
  Deployment,
  GraphIssue,
  NodeCatalogEntry,
  RunResult,
  Schedule,
  Template,
  WorkflowGraph,
  WorkflowRecord,
  WorkflowVersion,
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
  routing: { tier: string; model: string; reasons: string[] };
}

export const api = {
  nodeCatalog: () => request<{ nodes: NodeCatalogEntry[] }>("/api/node-catalog"),

  analytics: (workflowId?: string) =>
    request<Analytics>(
      `/api/analytics${workflowId ? `?workflowId=${workflowId}` : ""}`,
    ),

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

  setSelfHeal: (id: string, selfHeal: boolean) =>
    request<{ workflow: WorkflowRecord }>(`/api/workflows/${id}`, {
      method: "PUT",
      body: JSON.stringify({ selfHeal }),
    }),

  relayout: (id: string, graph: WorkflowGraph) =>
    request<{ workflow: WorkflowRecord; issues: GraphIssue[] }>(
      `/api/workflows/${id}/relayout`,
      { method: "POST", body: JSON.stringify({ graph }) },
    ),

  run: (id: string, mode: "dry" | "live") =>
    request<{ runId: string; mode: "dry" | "live" }>(`/api/workflows/${id}/runs`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    }),

  /**
   * Streams live progress for a run. Calls `onProgress` for each snapshot and
   * `onDone` with the final result, then closes. Returns a cancel function.
   */
  streamRun: (
    runId: string,
    handlers: {
      onProgress: (p: { status: string; nodes: RunResult["nodes"] }) => void;
      onDone: (r: RunResult) => void;
      onError: (msg: string) => void;
    },
  ): (() => void) => {
    const es = new EventSource(`/api/runs/${runId}/stream`);
    let closed = false;
    const close = () => {
      if (!closed) {
        closed = true;
        es.close();
      }
    };
    es.addEventListener("progress", (e) => {
      try {
        handlers.onProgress(JSON.parse((e as MessageEvent).data));
      } catch {
        /* ignore malformed frame */
      }
    });
    es.addEventListener("done", (e) => {
      try {
        handlers.onDone(JSON.parse((e as MessageEvent).data));
      } catch {
        /* ignore */
      }
      close();
    });
    es.addEventListener("error", () => {
      if (!closed) {
        handlers.onError("lost connection to the run stream");
        close();
      }
    });
    return close;
  },

  approve: (
    runId: string,
    nodeId: string,
    decision: "approve" | "reject",
    note?: string,
  ) =>
    request<{ ok: boolean }>(`/api/runs/${runId}/approve`, {
      method: "POST",
      body: JSON.stringify({ nodeId, decision, note }),
    }),

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
    request<{ runId: string }>(url.replace(/^https?:\/\/[^/]+/, ""), {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  listSchedules: (workflowId: string) =>
    request<{ schedules: Schedule[] }>(`/api/workflows/${workflowId}/schedules`),

  createSchedule: (workflowId: string, cron: string, timezone: string) =>
    request<{ schedule: Schedule }>(`/api/workflows/${workflowId}/schedule`, {
      method: "POST",
      body: JSON.stringify({ cron, timezone }),
    }),

  setScheduleStatus: (id: string, action: "pause" | "resume") =>
    request<{ schedule: Schedule }>(`/api/schedules/${id}/${action}`, { method: "POST" }),

  deleteSchedule: (id: string) =>
    request<unknown>(`/api/schedules/${id}`, { method: "DELETE" }),

  listTemplates: () => request<{ templates: Template[] }>("/api/templates"),

  publishTemplate: (
    workflowId: string,
    body: { name?: string; description: string; category: string },
  ) =>
    request<{ template: Template }>("/api/templates", {
      method: "POST",
      body: JSON.stringify({ workflowId, ...body }),
    }),

  cloneTemplate: (id: string) =>
    request<{ workflow: WorkflowRecord }>(`/api/templates/${id}/clone`, {
      method: "POST",
    }),

  deleteTemplate: (id: string) =>
    request<unknown>(`/api/templates/${id}`, { method: "DELETE" }),

  listVersions: (workflowId: string) =>
    request<{ versions: WorkflowVersion[] }>(`/api/workflows/${workflowId}/versions`),

  saveVersion: (workflowId: string, label?: string) =>
    request<{ version: WorkflowVersion }>(`/api/workflows/${workflowId}/versions`, {
      method: "POST",
      body: JSON.stringify({ label }),
    }),

  rollback: (workflowId: string, versionId: string) =>
    request<{ workflow: WorkflowRecord; issues: GraphIssue[] }>(
      `/api/workflows/${workflowId}/rollback`,
      { method: "POST", body: JSON.stringify({ versionId }) },
    ),
};
