import { WorkflowGraphSchema, validateGraph, type WorkflowGraph } from "@awb/core";
import { autoLayout } from "../compiler/layout.js";

export { WorkflowGraphSchema, validateGraph };
export type { WorkflowGraph };

/** autoLayout that never throws (falls back to the input on a cyclic graph). */
export function autoLayoutSafe(graph: WorkflowGraph): WorkflowGraph {
  try {
    return autoLayout(graph);
  } catch {
    return graph;
  }
}
