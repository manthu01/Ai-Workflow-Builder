import { create } from "zustand";
import { api } from "./api";
import type {
  GraphIssue,
  NodeCatalogEntry,
  NodeKind,
  RunResult,
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
  compiling: boolean;
  running: boolean;
  saving: boolean;
  error: string | null;

  loadCatalog: () => Promise<void>;
  compile: (prompt: string) => Promise<void>;
  doRun: (mode: "dry" | "live") => Promise<void>;
  selectNode: (id: string | null) => void;

  setGraph: (graph: WorkflowGraph) => void;
  updateNode: (id: string, patch: Partial<Pick<WorkflowNode, "label" | "config">>) => void;
  addNode: (kind: NodeKind) => void;
  deleteNode: (id: string) => void;
  connect: (source: string, target: string) => void;
  deleteEdge: (id: string) => void;
  relayout: () => Promise<void>;
  persistNow: () => Promise<void>;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

const rand = () => Math.random().toString(36).slice(2, 7);

export const useApp = create<AppState>((set, get) => {
  /** Apply a graph mutation locally and schedule a debounced save. */
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
      set((s) => ({
        compiling: true,
        error: null,
        run: null,
        selectedNodeId: null,
        chat: [...s.chat, { role: "user", text: prompt }],
      }));
      try {
        const res = await api.compile(prompt);
        const warn = res.warnings.length
          ? ` (${res.warnings.length} warning${res.warnings.length > 1 ? "s" : ""})`
          : "";
        set((s) => ({
          workflow: res.workflow,
          issues: res.warnings,
          compiling: false,
          chat: [
            ...s.chat,
            {
              role: "system",
              text: `Compiled "${res.workflow.name}" - ${res.workflow.graph.nodes.length} nodes via ${res.provider}${warn}.`,
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
        const res = await api.run(wf.id, mode);
        set((s) => ({
          run: res.result,
          running: false,
          chat: [
            ...s.chat,
            {
              role: "system",
              text: `${mode === "dry" ? "Dry run" : "Live run"} ${res.result.status} - ${res.result.nodes.filter((n) => n.status === "succeeded").length}/${res.result.nodes.length} nodes ok.`,
            },
          ],
        }));
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

    connect: (source, target) => {
      if (source === target) return;
      mutate((g) => {
        if (g.edges.some((e) => e.source === source && e.target === target)) return g;
        return {
          ...g,
          edges: [...g.edges, { id: `e_${source}_${target}_${rand()}`, source, target }],
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
