import { create } from "zustand";
import { api } from "./api";
import type {
  Connection,
  ConnectionKind,
  Deployment,
  GraphIssue,
  NodeCatalogEntry,
  NodeKind,
  RunResult,
  Schedule,
  WorkflowGraph,
  WorkflowNode,
  WorkflowRecord,
} from "./types";

export interface ChatEntry {
  role: "user" | "system";
  text: string;
}

interface AppState {
  chat: ChatEntry[];
  workflow: WorkflowRecord | null;
  catalog: NodeCatalogEntry[];
  issues: GraphIssue[];
  run: RunResult | null;
  selectedNodeId: string | null;
  connections: Connection[];
  deployments: Deployment[];
  schedules: Schedule[];
  connectionsOpen: boolean;
  setConnectionsOpen: (open: boolean) => void;
  compiling: boolean;
  running: boolean;
  saving: boolean;
  error: string | null;

  loadCatalog: () => Promise<void>;
  compile: (prompt: string) => Promise<void>;
  doRun: (mode: "dry" | "live") => Promise<void>;
  selectNode: (id: string | null) => void;

  loadConnections: () => Promise<void>;
  createConnection: (body: {
    name: string;
    kind: ConnectionKind;
    secret: Record<string, string>;
  }) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;

  loadDeployments: () => Promise<void>;
  deploy: () => Promise<void>;
  setDeploymentStatus: (id: string, action: "pause" | "resume") => Promise<void>;
  removeDeployment: (id: string) => Promise<void>;
  fireHook: (url: string, payload: unknown) => Promise<void>;

  loadSchedules: () => Promise<void>;
  createSchedule: (cron: string, timezone: string) => Promise<void>;
  setScheduleStatus: (id: string, action: "pause" | "resume") => Promise<void>;
  removeSchedule: (id: string) => Promise<void>;

  setGraph: (graph: WorkflowGraph) => void;
  updateNode: (id: string, patch: Partial<Pick<WorkflowNode, "label" | "config">>) => void;
  addNode: (kind: NodeKind) => void;
  deleteNode: (id: string) => void;
  connect: (source: string, target: string, sourceHandle?: string) => void;
  deleteEdge: (id: string) => void;
  relayout: () => Promise<void>;
  persistNow: () => Promise<void>;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let activeStream: (() => void) | null = null;

const rand = () => Math.random().toString(36).slice(2, 7);

export const useApp = create<AppState>((set, get) => {
  /** Apply a graph mutation locally and schedule a debounced save. */
  /** Open an SSE stream for a run and pipe progress into `run` state. */
  const streamInto = (
    runId: string,
    meta: { workflowId: string; mode: "dry" | "live" },
    label: string,
  ) => {
    activeStream?.();
    set({ running: true, run: null, error: null });
    activeStream = api.streamRun(runId, {
      onProgress: (p) => {
        set({
          run: {
            runId,
            workflowId: meta.workflowId,
            mode: meta.mode,
            status: p.status as RunResult["status"],
            nodes: p.nodes,
            startedAt: new Date().toISOString(),
          },
        });
      },
      onDone: (result) => {
        const ok = result.nodes.filter((n) => n.status === "succeeded").length;
        set((s) => ({
          run: { ...result, runId, workflowId: meta.workflowId, mode: meta.mode },
          running: false,
          chat: [
            ...s.chat,
            {
              role: "system",
              text: `${label} ${result.status} - ${ok}/${result.nodes.length} nodes ok.`,
            },
          ],
        }));
        activeStream = null;
        void get().loadDeployments();
      },
      onError: (msg) => set({ running: false, error: msg }),
    });
  };

  const mutate = (fn: (g: WorkflowGraph) => WorkflowGraph) => {
    const wf = get().workflow;
    if (!wf) return;
    const graph = fn(structuredClone(wf.graph));
    set({ workflow: { ...wf, graph } });
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => void get().persistNow(), 600);
  };

  return {
    chat: [],
    workflow: null,
    catalog: [],
    issues: [],
    run: null,
    selectedNodeId: null,
    connections: [],
    deployments: [],
    schedules: [],
    connectionsOpen: false,
    setConnectionsOpen: (open) => set({ connectionsOpen: open }),
    compiling: false,
    running: false,
    saving: false,
    error: null,

    loadCatalog: async () => {
      try {
        const res = await api.nodeCatalog();
        set({ catalog: res.nodes });
      } catch {
        /* non-fatal */
      }
    },

    compile: async (prompt) => {
      activeStream?.();
      activeStream = null;
      set((s) => ({
        compiling: true,
        error: null,
        run: null,
        running: false,
        selectedNodeId: null,
        chat: [...s.chat, { role: "user", text: prompt }],
      }));
      try {
        const res = await api.compile(prompt);
        const warn = res.warnings.length
          ? ` (${res.warnings.length} warning${res.warnings.length > 1 ? "s" : ""})`
          : "";
        const routed =
          res.provider === "anthropic"
            ? ` Routed to ${res.routing.tier} tier (${res.routing.model}) - ${res.routing.reasons.join(", ")}.`
            : "";
        set((s) => ({
          workflow: res.workflow,
          issues: res.warnings,
          compiling: false,
          chat: [
            ...s.chat,
            {
              role: "system",
              text: `Compiled "${res.workflow.name}" - ${res.workflow.graph.nodes.length} nodes via ${res.provider}${warn}.${routed}`,
            },
          ],
        }));
      } catch (err) {
        const e = err as Error & { issues?: GraphIssue[] };
        set((s) => ({
          compiling: false,
          error: e.message,
          issues: e.issues ?? [],
          chat: [...s.chat, { role: "system", text: `Compile failed: ${e.message}` }],
        }));
      }
    },

    doRun: async (mode) => {
      const wf = get().workflow;
      if (!wf) return;
      if (persistTimer) {
        clearTimeout(persistTimer);
        await get().persistNow();
      }
      set({ running: true, error: null, run: null });
      try {
        const { runId } = await api.run(wf.id, mode);
        streamInto(runId, { workflowId: wf.id, mode }, mode === "dry" ? "Dry run" : "Live run");
      } catch (err) {
        const e = err as Error;
        set((s) => ({
          running: false,
          error: e.message,
          chat: [...s.chat, { role: "system", text: `Run failed: ${e.message}` }],
        }));
      }
    },

    selectNode: (id) => set({ selectedNodeId: id }),

    setGraph: (graph) =>
      set((s) => (s.workflow ? { workflow: { ...s.workflow, graph } } : {})),

    updateNode: (id, patch) =>
      mutate((g) => ({
        ...g,
        nodes: g.nodes.map((n) =>
          n.id === id
            ? {
                ...n,
                label: patch.label ?? n.label,
                config: patch.config ? { ...n.config, ...patch.config } : n.config,
              }
            : n,
        ),
      })),

    addNode: (kind) => {
      const wf = get().workflow;
      if (!wf) return;
      const entry = get().catalog.find((c) => c.kind === kind);
      const config: Record<string, string> = {};
      for (const f of entry?.fields ?? []) config[f.key] = f.default;
      const n = wf.graph.nodes.length;
      const id = `${kind}_${rand()}`;
      const node: WorkflowNode = {
        id,
        kind,
        label: entry?.title ?? kind,
        config,
        position: { x: 80 + (n % 4) * 60, y: 80 + n * 40 },
      };
      mutate((g) => ({ ...g, nodes: [...g.nodes, node] }));
      set({ selectedNodeId: id });
    },

    deleteNode: (id) => {
      mutate((g) => ({
        ...g,
        nodes: g.nodes.filter((n) => n.id !== id),
        edges: g.edges.filter((e) => e.source !== id && e.target !== id),
      }));
      set((s) => ({ selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId }));
    },

    connect: (source, target, sourceHandle = "") => {
      if (source === target) return;
      mutate((g) => {
        if (
          g.edges.some(
            (e) =>
              e.source === source &&
              e.target === target &&
              (e.sourceHandle ?? "") === sourceHandle,
          )
        )
          return g;
        return {
          ...g,
          edges: [
            ...g.edges,
            { id: `e_${source}_${target}_${rand()}`, source, target, sourceHandle },
          ],
        };
      });
    },

    deleteEdge: (id) =>
      mutate((g) => ({ ...g, edges: g.edges.filter((e) => e.id !== id) })),

    relayout: async () => {
      const wf = get().workflow;
      if (!wf) return;
      try {
        const res = await api.relayout(wf.id, wf.graph);
        set({ workflow: res.workflow, issues: res.issues });
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    loadConnections: async () => {
      try {
        const res = await api.listConnections();
        set({ connections: res.connections });
      } catch {
        /* non-fatal */
      }
    },

    createConnection: async (body) => {
      try {
        await api.createConnection(body);
        await get().loadConnections();
      } catch (err) {
        set({ error: (err as Error).message });
        throw err;
      }
    },

    removeConnection: async (id) => {
      try {
        await api.deleteConnection(id);
        set((s) => ({ connections: s.connections.filter((c) => c.id !== id) }));
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    loadDeployments: async () => {
      const wf = get().workflow;
      if (!wf) return set({ deployments: [] });
      try {
        const res = await api.listDeployments(wf.id);
        set({ deployments: res.deployments });
      } catch {
        /* non-fatal */
      }
    },

    deploy: async () => {
      const wf = get().workflow;
      if (!wf) return;
      if (persistTimer) {
        clearTimeout(persistTimer);
        await get().persistNow();
      }
      try {
        const res = await api.deploy(wf.id);
        set((s) => ({
          deployments: [res.deployment, ...s.deployments],
          chat: [
            ...s.chat,
            { role: "system", text: `Deployed. Webhook: ${res.deployment.url}` },
          ],
        }));
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    setDeploymentStatus: async (id, action) => {
      try {
        const res = await api.setDeploymentStatus(id, action);
        set((s) => ({
          deployments: s.deployments.map((d) => (d.id === id ? res.deployment : d)),
        }));
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    removeDeployment: async (id) => {
      try {
        await api.deleteDeployment(id);
        set((s) => ({ deployments: s.deployments.filter((d) => d.id !== id) }));
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    fireHook: async (url, payload) => {
      const wf = get().workflow;
      set({ running: true, error: null, run: null });
      try {
        const { runId } = await api.fireHook(url, payload);
        streamInto(
          runId,
          { workflowId: wf?.id ?? "", mode: "live" },
          "Webhook fired - live run",
        );
      } catch (err) {
        set({ running: false, error: (err as Error).message });
      }
    },

    loadSchedules: async () => {
      const wf = get().workflow;
      if (!wf) return set({ schedules: [] });
      try {
        const res = await api.listSchedules(wf.id);
        set({ schedules: res.schedules });
      } catch {
        /* non-fatal */
      }
    },

    createSchedule: async (cron, timezone) => {
      const wf = get().workflow;
      if (!wf) return;
      if (persistTimer) {
        clearTimeout(persistTimer);
        await get().persistNow();
      }
      try {
        const res = await api.createSchedule(wf.id, cron, timezone);
        set((s) => ({
          schedules: [res.schedule, ...s.schedules],
          chat: [
            ...s.chat,
            { role: "system", text: `Scheduled "${cron}" (${timezone}).` },
          ],
        }));
      } catch (err) {
        set({ error: (err as Error).message });
        throw err;
      }
    },

    setScheduleStatus: async (id, action) => {
      try {
        const res = await api.setScheduleStatus(id, action);
        set((s) => ({
          schedules: s.schedules.map((x) => (x.id === id ? res.schedule : x)),
        }));
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    removeSchedule: async (id) => {
      try {
        await api.deleteSchedule(id);
        set((s) => ({ schedules: s.schedules.filter((x) => x.id !== id) }));
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },

    persistNow: async () => {
      persistTimer = null;
      const wf = get().workflow;
      if (!wf) return;
      set({ saving: true });
      try {
        const res = await api.updateGraph(wf.id, wf.graph);
        // Keep the local graph authoritative (avoid clobbering in-flight edits);
        // only take validation + server metadata back.
        set((s) => ({
          issues: res.issues,
          saving: false,
          workflow: s.workflow
            ? { ...s.workflow, name: res.workflow.name, updatedAt: res.workflow.updatedAt }
            : s.workflow,
        }));
      } catch (err) {
        set({ error: (err as Error).message, saving: false });
      }
    },
  };
});
