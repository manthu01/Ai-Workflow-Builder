import { Hono } from "hono";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { WorkflowGraphSchema, autoLayoutSafe } from "./_shared.js";
import { db, schema } from "../db/client.js";
import { newId } from "../id.js";
import { snapshotVersion } from "../versions.js";

export const templateRoutes = new Hono();

const summary = (t: typeof schema.templates.$inferSelect) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  category: t.category,
  author: t.author,
  builtIn: t.builtIn,
  cloneCount: t.cloneCount,
  nodeCount: t.graph.nodes.length,
  edgeCount: t.graph.edges.length,
  kinds: [...new Set(t.graph.nodes.map((n) => n.kind))],
  createdAt: t.createdAt,
});

templateRoutes.get("/", async (c) => {
  const rows = await db
    .select()
    .from(schema.templates)
    .orderBy(desc(schema.templates.builtIn), desc(schema.templates.cloneCount));
  return c.json({ templates: rows.map(summary) });
});

templateRoutes.get("/:id", async (c) => {
  const [row] = await db
    .select()
    .from(schema.templates)
    .where(eq(schema.templates.id, c.req.param("id")));
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ template: { ...summary(row), graph: row.graph } });
});

const PublishBody = z.object({
  workflowId: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(600).default(""),
  category: z.string().max(40).default("general"),
});

/** Publish a workflow's current graph as a community template. */
templateRoutes.post("/", async (c) => {
  const parsed = PublishBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "workflowId is required" }, 400);

  const [wf] = await db
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.id, parsed.data.workflowId));
  if (!wf) return c.json({ error: "workflow not found" }, 404);

  const [row] = await db
    .insert(schema.templates)
    .values({
      id: newId("tpl"),
      name: parsed.data.name ?? wf.name,
      description: parsed.data.description || wf.description || "",
      category: parsed.data.category,
      graph: wf.graph,
    })
    .returning();
  return c.json({ template: summary(row!) });
});

/** Clone a template into a new workflow. */
templateRoutes.post("/:id/clone", async (c) => {
  const [tpl] = await db
    .select()
    .from(schema.templates)
    .where(eq(schema.templates.id, c.req.param("id")));
  if (!tpl) return c.json({ error: "not found" }, 404);

  const id = newId("wf");
  const graph = autoLayoutSafe(WorkflowGraphSchema.parse(tpl.graph));
  const [wf] = await db
    .insert(schema.workflows)
    .values({
      id,
      name: `${tpl.name} (copy)`,
      description: tpl.description,
      graph,
    })
    .returning();

  await db
    .update(schema.templates)
    .set({ cloneCount: sql`${schema.templates.cloneCount} + 1` })
    .where(eq(schema.templates.id, tpl.id));
  await snapshotVersion(id, graph, "edit", `from template "${tpl.name}"`);

  return c.json({ workflow: wf });
});

templateRoutes.delete("/:id", async (c) => {
  await db
    .delete(schema.templates)
    .where(eq(schema.templates.id, c.req.param("id")));
  return c.body(null, 204);
});
