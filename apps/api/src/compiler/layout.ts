import type { WorkflowGraph } from "@awb/core";
import { topologicalOrder, upstreamOf } from "@awb/core";

const COL_WIDTH = 280;
const ROW_HEIGHT = 140;

/**
 * Assigns a tidy left-to-right layered layout. Each node's column is one past
 * the deepest of its upstream nodes; nodes sharing a column are stacked.
 */
export function autoLayout(graph: WorkflowGraph): WorkflowGraph {
  let order: string[];
  try {
    order = topologicalOrder(graph);
  } catch {
    return graph; // cyclic; leave positions alone, validation will flag it
  }

  const depth = new Map<string, number>();
  for (const id of order) {
    const ups = upstreamOf(graph, id);
    const d = ups.length === 0 ? 0 : Math.max(...ups.map((u) => (depth.get(u) ?? 0) + 1));
    depth.set(id, d);
  }

  const rowByCol = new Map<number, number>();
  const nodes = graph.nodes.map((node) => {
    const col = depth.get(node.id) ?? 0;
    const row = rowByCol.get(col) ?? 0;
    rowByCol.set(col, row + 1);
    return {
      ...node,
      position: { x: col * COL_WIDTH + 40, y: row * ROW_HEIGHT + 40 },
    };
  });

  return { ...graph, nodes };
}
