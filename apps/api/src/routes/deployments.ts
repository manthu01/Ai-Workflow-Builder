import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { validateGraph } from "@awb/core";
import { db, schema } from "../db/client.js";
import { newId } from "../id.js";
import { env } from "../env.js";
import { startRun } from "../engine.js";

export const deploymentRoutes = new Hono();
export const hookRoutes = new Hono();

const withUrl = (d: typeof schema.deployments.$inferSelect) => ({
  id: d.id,
  workflowId: d.workflowId,
  status: d.status,
  fireCount: d.fireCount,
  lastFiredAt: d.lastFiredAt,
  createdAt: d.createdAt,
  url: `${env.PUBLIC_URL}/api/hooks/${d.token}`,
});

/** Compile the current graph into a live webhook listener. */
deploymentRoutes.post("/workflows/:id/deploy", async (c) => {
  const workflowId = c.req.param("id");
  const [wf] = await db
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.id, workflowId));
  if (!wf) return c.json({ error: "workflow not found" }, 404);

  const blocking = validateGraph(wf.graph).filter((i) => i.level === "error");
  if (blocking.length > 0) {
    return c.json({ error: "fix validation errors before deploying", issues: blocking }, 422);
  }

  const [row] = await db
    .insert(schema.deployments)
    .values({
      id: newId("dep"),
      workflowId,
      token: randomBytes(24).toString("base64url"),
      status: "active",
      graphSnapshot: wf.graph,
    })
    .returning();

  return c.json({ deployment: withUrl(row!) });
});

deploymentRoutes.get("/workflows/:id/deployments", async (c) => {
  const rows = await db
    .select()
    .from(schema.deployments)
    .where(eq(schema.deployments.workflowId, c.req.param("id")))
    .orderBy(desc(schema.deployments.createdAt));
  return c.json({ deployments: rows.map(withUrl) });
});

deploymentRoutes.post("/deployments/:id/:action{pause|resume}", async (c) => {
  const status = c.req.param("action") === "pause" ? "paused" : "active";
  const [row] = await db
    .update(schema.deployments)
    .set({ status })
    .where(eq(schema.deployments.id, c.req.param("id")))
    .returning();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ deployment: withUrl(row) });
});

deploymentRoutes.delete("/deployments/:id", async (c) => {
  await db.delete(schema.deployments).where(eq(schema.deployments.id, c.req.param("id")));
  return c.body(null, 204);
});

/**
 * Public webhook endpoint. The request body becomes the trigger payload and a
 * live run starts immediately.
 */
hookRoutes.post("/:token", async (c) => {
  const [dep] = await db
    .select()
    .from(schema.deployments)
    .where(eq(schema.deployments.token, c.req.param("token")));
  if (!dep) return c.json({ error: "unknown webhook" }, 404);
  if (dep.status !== "active") return c.json({ error: "webhook is paused" }, 409);

  const payload = await c.req.json().catch(() => ({}));

  await db
    .update(schema.deployments)
    .set({ fireCount: dep.fireCount + 1, lastFiredAt: new Date() })
    .where(eq(schema.deployments.id, dep.id));

  try {
    const { runId, done } = await startRun({
      workflowId: dep.workflowId,
      graph: dep.graphSnapshot,
      mode: "live",
      trigger: "webhook",
      deploymentId: dep.id,
      triggerPayload: payload,
    });
    void done.catch(() => {}); // finalized in the background
    return c.json({ runId }, 202);
  } catch (err) {
    return c.json({ error: `engine error: ${(err as Error).message}` }, 502);
  }
});
