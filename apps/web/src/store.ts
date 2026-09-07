import { create } from "zustand";
import { api } from "./api";
import type { GraphIssue, RunResult, WorkflowGraph, WorkflowRecord } from "./types";

export interface ChatEntry {
  role: "user" | "system";
  text: string;
}

interface AppState {
  chat: ChatEntry[];
  workflow: WorkflowRecord | null;
  issues: GraphIssue[];
  run: RunResult | null;
  compiling: boolean;
  running: boolean;
  error: string | null;

  compile: (prompt: string) => Promise<void>;
  doRun: (mode: "dry" | "live") => Promise<void>;
  setGraph: (graph: WorkflowGraph) => void;
  persistGraph: () => Promise<void>;
}

export const useApp = create<AppState>((set, get) => ({
  chat: [],
  workflow: null,
  issues: [],
  run: null,
  compiling: false,
  running: false,
  error: null,

  compile: async (prompt) => {
    set((s) => ({
      compiling: true,
      error: null,
      run: null,
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

  setGraph: (graph) =>
    set((s) => (s.workflow ? { workflow: { ...s.workflow, graph } } : {})),

  persistGraph: async () => {
    const wf = get().workflow;
    if (!wf) return;
    try {
      const res = await api.updateGraph(wf.id, wf.graph);
      set({ workflow: res.workflow, issues: res.issues });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },
}));
