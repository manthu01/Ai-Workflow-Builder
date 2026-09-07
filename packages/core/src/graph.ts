import { z } from "zod";
import { NODE_KINDS, NODE_CONFIG_SCHEMAS, type NodeKind } from "./nodes.js";

const NodeIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "node id must be snake_case starting with a letter");

export const WorkflowNodeSchema = z.object({
  id: NodeIdSchema,
  kind: z.enum(NODE_KINDS),
  label: z.string().min(1).max(120),
  config: z.record(z.string(), z.unknown()).default({}),
  position: z
    .object({ x: z.number(), y: z.number() })
    .default({ x: 0, y: 0 }),
});
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: NodeIdSchema,
  target: NodeIdSchema,
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const WorkflowGraphSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
});
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

export interface GraphIssue {
  level: "error" | "warning";
  nodeId?: string;
  message: string;
}

/**
 * Structural + per-node-config validation. Returns every problem found rather
 * than throwing on the first, so the UI can surface them all at once.
 */
export function validateGraph(graph: WorkflowGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const ids = new Set<string>();

  for (const node of graph.nodes) {
    if (ids.has(node.id)) {
      issues.push({ level: "error", nodeId: node.id, message: `duplicate node id "${node.id}"` });
    }
    ids.add(node.id);

    const schema = NODE_CONFIG_SCHEMAS[node.kind as NodeKind];
    const parsed = schema.safeParse(node.config);
    if (!parsed.success) {
      for (const err of parsed.error.issues) {
        issues.push({
          level: "error",
          nodeId: node.id,
          message: `config.${err.path.join(".") || "(root)"}: ${err.message}`,
        });
      }
    }
  }

  for (const edge of graph.edges) {
    if (!ids.has(edge.source)) {
      issues.push({ level: "error", message: `edge "${edge.id}" has unknown source "${edge.source}"` });
    }
    if (!ids.has(edge.target)) {
      issues.push({ level: "error", message: `edge "${edge.id}" has unknown target "${edge.target}"` });
    }
  }

  const triggers = graph.nodes.filter((n) => n.kind === "trigger");
  if (triggers.length === 0) {
    issues.push({ level: "error", message: "workflow has no trigger node" });
  }

  // Cycle detection (Kahn's algorithm).
  const cycleNodes = findCycleNodes(graph);
  if (cycleNodes.length > 0) {
    issues.push({
      level: "error",
      message: `workflow is not acyclic; nodes in a cycle: ${cycleNodes.join(", ")}`,
    });
  }

  // Reachability: every non-trigger node should have at least one inbound edge.
  const hasInbound = new Set(graph.edges.map((e) => e.target));
  for (const node of graph.nodes) {
    if (node.kind !== "trigger" && !hasInbound.has(node.id)) {
      issues.push({
        level: "warning",
        nodeId: node.id,
        message: `node "${node.id}" has no inputs and will never run`,
      });
    }
  }

  return issues;
}

function findCycleNodes(graph: WorkflowGraph): string[] {
  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) {
    indegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of graph.edges) {
    if (!indegree.has(e.source) || !indegree.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }
  const queue = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited++;
    for (const next of adj.get(id) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  if (visited === graph.nodes.length) return [];
  return [...indegree.entries()].filter(([, d]) => d > 0).map(([id]) => id);
}

/**
 * Returns node ids in a valid execution order, preserving the graph's declared
 * node order among nodes that are ready at the same time. Throws if the graph
 * has a cycle (call {@link validateGraph} first to surface that gracefully).
 */
export function topologicalOrder(graph: WorkflowGraph): string[] {
  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) {
    indegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of graph.edges) {
    if (!adj.has(e.source) || !indegree.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }

  const declared = graph.nodes.map((n) => n.id);
  const done = new Set<string>();
  const result: string[] = [];

  while (result.length < graph.nodes.length) {
    const next = declared.find(
      (id) => !done.has(id) && (indegree.get(id) ?? 0) === 0,
    );
    if (!next) throw new Error("cannot topologically sort a cyclic graph");
    done.add(next);
    result.push(next);
    for (const m of adj.get(next) ?? []) {
      indegree.set(m, (indegree.get(m) ?? 0) - 1);
    }
  }
  return result;
}

/** Direct upstream node ids for a given node. */
export function upstreamOf(graph: WorkflowGraph, nodeId: string): string[] {
  return graph.edges.filter((e) => e.target === nodeId).map((e) => e.source);
}
