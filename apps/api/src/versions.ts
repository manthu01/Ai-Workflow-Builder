import { eq, desc } from "drizzle-orm";
import type { WorkflowGraph } from "@awb/core";
import { db, schema } from "./db/client.js";
import { newId } from "./id.js";

type VersionSource = "compile" | "edit" | "deploy" | "run" | "rollback";

/** Stable-ish structural signature of a graph, ignoring node positions. */
function graphSignature(g: WorkflowGraph): string {
  const nodes = [...g.nodes]
    .map((n) => ({ id: n.id, kind: n.kind, label: n.label, config: n.config }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const edges = [...g.edges]
    .map((e) => `${e.source}>${e.target}:${e.sourceHandle ?? ""}`)
    .sort();
  return JSON.stringify({ name: g.name, description: g.description ?? "", nodes, edges });
}

export async function latestVersion(workflowId: string) {
  const [row] = await db
    .select()
    .from(schema.workflowVersions)
    .where(eq(schema.workflowVersions.workflowId, workflowId))
    .orderBy(desc(schema.workflowVersions.version))
    .limit(1);
  return row;
}

/**
 * Writes a new immutable snapshot. Returns the row, or the existing latest row
 * if the graph is structurally identical (so runs/edits don't spam versions).
 */
export async function snapshotVersion(
  workflowId: string,
  graph: WorkflowGraph,
  source: VersionSource,
  label?: string,
) {
  const latest = await latestVersion(workflowId);
  if (latest && graphSignature(latest.graph) === graphSignature(graph)) {
    return latest;
  }
  const [row] = await db
    .insert(schema.workflowVersions)
    .values({
      id: newId("ver"),
      workflowId,
      version: (latest?.version ?? 0) + 1,
      graph,
      source,
      label: label ?? null,
    })
    .returning();
  return row!;
}
