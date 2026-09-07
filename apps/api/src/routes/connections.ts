import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client.js";
import { newId } from "../id.js";
import { env } from "../env.js";
import { encryptJson, decryptJson } from "../crypto.js";

export const connectionRoutes = new Hono();

const SlackSecret = z.object({ botToken: z.string().min(1) });
const HttpHeaderSecret = z.object({
  headerName: z.string().min(1),
  headerValue: z.string().min(1),
});

const CreateBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("slack"), name: z.string().min(1), secret: SlackSecret }),
  z.object({
    kind: z.literal("http_header"),
    name: z.string().min(1),
    secret: HttpHeaderSecret,
  }),
]);

const publicRow = (r: typeof schema.connections.$inferSelect) => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  createdAt: r.createdAt,
});

connectionRoutes.get("/", async (c) => {
  const rows = await db.select().from(schema.connections);
  return c.json({ connections: rows.map(publicRow) });
});

connectionRoutes.post("/", async (c) => {
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: "invalid connection", details: parsed.error.issues }, 400);
  }
  const id = newId("conn");
  const [row] = await db
    .insert(schema.connections)
    .values({
      id,
      name: parsed.data.name,
      kind: parsed.data.kind,
      secret: encryptJson(parsed.data.secret),
    })
    .returning();
  return c.json({ connection: publicRow(row!) });
});

connectionRoutes.delete("/:id", async (c) => {
  await db.delete(schema.connections).where(eq(schema.connections.id, c.req.param("id")));
  return c.body(null, 204);
});

/**
 * Internal-only: hands a decrypted secret to the Temporal worker at execution
 * time. Guarded by a shared token; never mounted on a public path.
 */
connectionRoutes.post("/internal/:id/resolve", async (c) => {
  if (c.req.header("x-internal-token") !== env.INTERNAL_TOKEN) {
    return c.json({ error: "forbidden" }, 403);
  }
  const [row] = await db
    .select()
    .from(schema.connections)
    .where(eq(schema.connections.id, c.req.param("id")));
  if (!row) return c.json({ error: "not found" }, 404);
  try {
    return c.json({ kind: row.kind, secret: decryptJson(row.secret) });
  } catch {
    return c.json({ error: "could not decrypt (SECRET_KEY changed?)" }, 500);
  }
});
