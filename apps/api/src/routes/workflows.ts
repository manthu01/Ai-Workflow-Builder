import { Hono } from "hono";
import { and, eq, desc } from "drizzle-orm";
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
import { env } from "../env.js";
import {
  demoForbidden,
  demoGraphGuard,
  demoHasModel,
  findWorkflow,
  ownerFilter,
  takeCompileBudget,
} from "../demo.js";

export const workflowRoutes = new Hono();

/** Compile a natural-language prompt into a new, saved workflow. */
workflowRoutes.post("/compile", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({ prompt: z.string().min(1).max(4000) }).safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "prompt is required" }, 400);
  }
  if (env.DEMO_MODE && parsed.data.prompt.length > env.DEMO_PROMPT_MAX_CHARS) {
    return c.json({ error: `Demo prompts are limited to ${env.DEMO_PROMPT_MAX_CHARS} characters.` }, 400);
  }
  const budget = takeCompileBudget(c);
  if (!budget.ok) {
    c.header("retry-after", String(budget.retryAfter));
    return c.json({ error: budget.error, demo: true }, 429);
  }

  try {
    const result = await compileWorkflow(parsed.data.prompt, { stub: budget.useStub });
    const blocked = demoGraphGuard(c, result.graph);
    if (blocked) return blocked;
    const id = newId("wf");
    const [row] = await db
      .insert(schema.workflows)
      .values({
        id,
        name: result.graph.name,
        description: result.graph.description ?? null,
        graph: result.graph,
        sourcePrompt: parsed.data.prompt,
        ownerSid: c.get("sid"),
      })
      .returning();

    await snapshotVersion(id, result.graph, "compile", "compiled");

    return c.json({
      workflow: row,
      provider: result.provider,
      attempts: result.attempts,
      warnings: result.warnings,
      routing: result.routing,
      // Demo mode past the global daily cap: compiled offline instead of by the model.
      offlineFallback: budget.useStub,
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
    .where(ownerFilter(c))
    .orderBy(desc(schema.workflows.updatedAt));
  return c.json({ workflows: rows });
});

workflowRoutes.get("/:id", async (c) => {
  const row = await findWorkflow(c, c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ workflow: row, issues: validateGraph(row.graph) });
});

const UpdateBody = z.object({
  name: z.string().min(1).max(160).optional(),
  graph: WorkflowGraphSchema.optional(),
  selfHeal: z.boolean().optional(),
});

workflowRoutes.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = UpdateBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid body", details: parsed.error.issues }, 400);
  }

  const existing = await findWorkflow(c, id);
  if (!existing) return c.json({ error: "not found" }, 404);
  if (parsed.data.graph) {
    const blocked = demoGraphGuard(c, parsed.data.graph);
    if (blocked) return blocked;
  }
  if (env.DEMO_MODE && parsed.data.selfHeal && !demoHasModel()) {
    return demoForbidden(c, "Self-heal (it needs a model, and this demo runs offline)");
  }

  // Positions are preserved as sent - the canvas owns layout while editing.
  const graph = parsed.data.graph ?? existing.graph;

  const [row] = await db
    .update(schema.workflows)
    .set({
      name: parsed.data.name ?? graph.name ?? existing.name,
      description: graph.description ?? existing.description,
      graph,
      selfHeal: parsed.data.selfHeal ?? existing.selfHeal,
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

  const existing = await findWorkflow(c, id);
  if (!existing) return c.json({ error: "not found" }, 404);

  const graph = autoLayoutSafe(parsed.success ? parsed.data.graph : existing.graph);
  const blocked = demoGraphGuard(c, graph);
  if (blocked) return blocked;
  const [row] = await db
    .update(schema.workflows)
    .set({ graph, updatedAt: new Date() })
    .where(eq(schema.workflows.id, id))
    .returning();

  return c.json({ workflow: row, issues: validateGraph(row!.graph) });
});

workflowRoutes.delete("/:id", async (c) => {
  await db
    .delete(schema.workflows)
    .where(and(eq(schema.workflows.id, c.req.param("id")), ownerFilter(c)));
  return c.body(null, 204);
});
