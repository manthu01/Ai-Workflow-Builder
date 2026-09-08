import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client.js";
import { newId } from "../id.js";
import { env } from "../env.js";
import { parseOpenApi } from "../openapi.js";

export const blueprintRoutes = new Hono();

const view = (b: typeof schema.apiBlueprints.$inferSelect) => ({
  id: b.id,
  name: b.name,
  baseUrl: b.baseUrl,
  operationCount: b.operations.length,
  operations: b.operations.map((o) => ({
    operationId: o.operationId,
    method: o.method,
    path: o.path,
    summary: o.summary,
    params: o.params,
  })),
  createdAt: b.createdAt,
});

blueprintRoutes.get("/", async (c) => {
  const rows = await db.select().from(schema.apiBlueprints);
  return c.json({ blueprints: rows.map(view) });
});

const CreateBody = z.object({
  name: z.string().min(1).max(120).optional(),
  spec: z.union([z.string(), z.record(z.string(), z.unknown())]),
});

blueprintRoutes.post("/", async (c) => {
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "spec is required" }, 400);

  let doc: unknown;
  try {
    doc = typeof parsed.data.spec === "string" ? JSON.parse(parsed.data.spec) : parsed.data.spec;
  } catch {
    return c.json({ error: "spec is not valid JSON (YAML: convert to JSON first)" }, 400);
  }

  const { baseUrl, operations } = parseOpenApi(doc);
  if (operations.length === 0) {
    return c.json({ error: "no operations found in the spec" }, 422);
  }
  const name =
    parsed.data.name ??
    ((doc as { info?: { title?: string } }).info?.title || "Untitled API");

  const [row] = await db
    .insert(schema.apiBlueprints)
    .values({ id: newId("bp"), name, baseUrl, operations })
    .returning();
  return c.json({ blueprint: view(row!) });
});

blueprintRoutes.delete("/:id", async (c) => {
  await db.delete(schema.apiBlueprints).where(eq(schema.apiBlueprints.id, c.req.param("id")));
  return c.body(null, 204);
});

/** Internal: hands the resolved blueprint to the worker at execution time. */
blueprintRoutes.post("/internal/:id/resolve", async (c) => {
  if (c.req.header("x-internal-token") !== env.INTERNAL_TOKEN) {
    return c.json({ error: "forbidden" }, 403);
  }
  const [row] = await db
    .select()
    .from(schema.apiBlueprints)
    .where(eq(schema.apiBlueprints.id, c.req.param("id")));
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ baseUrl: row.baseUrl, operations: row.operations });
});
