import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import {
  WorkflowGraphSchema,
  validateGraph,
  autoLayoutSafe,
} from "./_shared.js";
import { db, schema } from "../db/client.js";
import { newId } from "../id.js";
import { compileWorkflow, CompileError } from "../compiler/compile.js";
import { snapshotVersion } from "../versions.js";

export const workflowRoutes = new Hono();

/** Compile a natural-language prompt into a new, saved workflow. */
workflowRoutes.post("/compile", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({ prompt: z.string().min(1).max(4000) }).safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "prompt is required" }, 400);
  }

  try {
    const result = await compileWorkflow(parsed.data.prompt);
    const id = newId("wf");
    const [row] = await db
      .insert(schema.workflows)
      .values({
        id,
        name: result.graph.name,
        description: result.graph.description ?? null,
        graph: result.graph,
        sourcePrompt: parsed.data.prompt,
      })
      .returning();

    await snapshotVersion(id, result.graph, "compile", "compiled");

    return c.json({
      workflow: row,
      provider: result.provider,
      attempts: result.attempts,
      warnings: result.warnings,
      routing: result.routing,
    });
  } catch (err) {
    if (err instanceof CompileError) {
      return c.json({ error: err.message, issues: err.issues, draft: err.draft }, 422);
    }
    console.error("compile failed", err);
    return c.json({ error: (err as Error).message }, 500);
  }
});

workflowRoutes.get("/", async (c) => {
  const rows = await db
    .select()
    .from(schema.workflows)
    .orderBy(desc(schema.workflows.updatedAt));
  return c.json({ workflows: rows });
});

workflowRoutes.get("/:id", async (c) => {
  const [row] = await db
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.id, c.req.param("id")));
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ workflow: row, issues: validateGraph(row.graph) });
});

const UpdateBody = z.object({
  name: z.string().min(1).max(160).optional(),
  graph: WorkflowGraphSchema.optional(),
});

workflowRoutes.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = UpdateBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid body", details: parsed.error.issues }, 400);
  }

  const [existing] = await db
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.id, id));
  if (!existing) return c.json({ error: "not found" }, 404);

  // Positions are preserved as sent - the canvas owns layout while editing.
  const graph = parsed.data.graph ?? existing.graph;

  const [row] = await db
    .update(schema.workflows)
    .set({
      name: parsed.data.name ?? graph.name ?? existing.name,
      description: graph.description ?? existing.description,
      graph,
      updatedAt: new Date(),
    })
    .where(eq(schema.workflows.id, id))
    .returning();

  return c.json({ workflow: row, issues: validateGraph(row!.graph) });
});

/** Re-run the automatic left-to-right layered layout and save it. */
workflowRoutes.post("/:id/relayout", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({ graph: WorkflowGraphSchema }).safeParse(body);

  const [existing] = await db
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.id, id));
  if (!existing) return c.json({ error: "not found" }, 404);

  const graph = autoLayoutSafe(parsed.success ? parsed.data.graph : existing.graph);
  const [row] = await db
    .update(schema.workflows)
    .set({ graph, updatedAt: new Date() })
    .where(eq(schema.workflows.id, id))
    .returning();

  return c.json({ workflow: row, issues: validateGraph(row!.graph) });
});

workflowRoutes.delete("/:id", async (c) => {
  await db.delete(schema.workflows).where(eq(schema.workflows.id, c.req.param("id")));
  return c.body(null, 204);
});
