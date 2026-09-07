import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { validateGraph } from "@awb/core";
import { db, schema } from "../db/client.js";
import { snapshotVersion } from "../versions.js";

export const versionRoutes = new Hono();

const summary = (r: typeof schema.workflowVersions.$inferSelect) => ({
  id: r.id,
  version: r.version,
  label: r.label,
  source: r.source,
  nodeCount: r.graph.nodes.length,
  edgeCount: r.graph.edges.length,
  createdAt: r.createdAt,
});

versionRoutes.get("/workflows/:id/versions", async (c) => {
  const rows = await db
    .select()
    .from(schema.workflowVersions)
    .where(eq(schema.workflowVersions.workflowId, c.req.param("id")))
    .orderBy(desc(schema.workflowVersions.version));
  return c.json({ versions: rows.map(summary) });
});

versionRoutes.get("/workflows/:id/versions/:versionId", async (c) => {
  const [row] = await db
    .select()
    .from(schema.workflowVersions)
    .where(eq(schema.workflowVersions.id, c.req.param("versionId")));
  if (!row || row.workflowId !== c.req.param("id")) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ version: { ...summary(row), graph: row.graph } });
});

/** Explicitly snapshot the workflow's current graph. */
versionRoutes.post("/workflows/:id/versions", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const label = z.object({ label: z.string().max(120).optional() }).parse(body).label;

  const [wf] = await db
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.id, id));
  if (!wf) return c.json({ error: "workflow not found" }, 404);

  const row = await snapshotVersion(id, wf.graph, "edit", label ?? "manual save");
  return c.json({ version: summary(row) });
});

const RollbackBody = z.object({ versionId: z.string().min(1) });

/** Restore a previous version as the working graph. */
versionRoutes.post("/workflows/:id/rollback", async (c) => {
  const id = c.req.param("id");
  const parsed = RollbackBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "versionId is required" }, 400);

  const [wf] = await db
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.id, id));
  if (!wf) return c.json({ error: "workflow not found" }, 404);

  const [target] = await db
    .select()
    .from(schema.workflowVersions)
    .where(eq(schema.workflowVersions.id, parsed.data.versionId));
  if (!target || target.workflowId !== id) {
    return c.json({ error: "version not found" }, 404);
  }

  // Preserve the current graph so the rollback itself is reversible.
  await snapshotVersion(id, wf.graph, "rollback", "before rollback");

  const [row] = await db
    .update(schema.workflows)
    .set({ graph: target.graph, name: target.graph.name, updatedAt: new Date() })
    .where(eq(schema.workflows.id, id))
    .returning();

  await snapshotVersion(id, target.graph, "rollback", `restored v${target.version}`);

  return c.json({ workflow: row, issues: validateGraph(row!.graph) });
});
