import { Hono } from "hono";
import { cors } from "hono/cors";
import { sql } from "drizzle-orm";
import { NODE_CATALOG } from "@awb/core";
import { env } from "./env.js";
import { db } from "./db/client.js";
import { getTemporalClient } from "./temporal/client.js";
import { demoGuard, demoSession, demoStatus } from "./demo.js";
import { workflowRoutes } from "./routes/workflows.js";
import { runRoutes } from "./routes/runs.js";
import { connectionRoutes } from "./routes/connections.js";
import { deploymentRoutes, hookRoutes } from "./routes/deployments.js";
import { scheduleRoutes } from "./routes/schedules.js";
import { versionRoutes } from "./routes/versions.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { templateRoutes } from "./routes/templates.js";
import { blueprintRoutes } from "./routes/blueprints.js";
import { localTaskRoutes } from "./routes/localTasks.js";
import { knowledgeBaseRoutes } from "./routes/knowledgeBases.js";

export const app = new Hono();

app.use("*", cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.use("/api/*", demoSession);
app.use("/api/*", demoGuard);

app.get("/health", (c) =>
  c.json({ ok: true, compilerMode: env.COMPILER_MODE, taskQueue: env.TEMPORAL_TASK_QUEUE }),
);

/** Rejects if `p` hasn't settled within `ms`. */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)),
  ]);
}

/** Deep health check for uptime monitoring: Postgres and Temporal must both answer. */
app.get("/api/health", async (c) => {
  const check = async (fn: () => Promise<unknown>) => {
    try {
      await within(fn(), 3000);
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  };
  const [postgres, temporal] = await Promise.all([
    check(() => db.execute(sql`select 1`)),
    check(async () => (await getTemporalClient()).workflowService.getSystemInfo({})),
  ]);
  const ok = postgres.ok && temporal.ok;
  return c.json({ ok, postgres, temporal }, ok ? 200 : 503);
});

/** Demo-mode status for the UI: banner, disabled features, remaining compile budget. */
app.get("/api/demo", (c) => c.json(demoStatus(c)));

/** Node palette for the canvas. */
app.get("/api/node-catalog", (c) => c.json({ nodes: Object.values(NODE_CATALOG) }));

app.route("/api/workflows", workflowRoutes);
app.route("/api/connections", connectionRoutes);
app.route("/api/hooks", hookRoutes);
app.route("/api", runRoutes);
app.route("/api", deploymentRoutes);
app.route("/api", scheduleRoutes);
app.route("/api", versionRoutes);
app.route("/api", analyticsRoutes);
app.route("/api/templates", templateRoutes);
app.route("/api/blueprints", blueprintRoutes);
app.route("/api/local-tasks", localTaskRoutes);
app.route("/api/kbs", knowledgeBaseRoutes);
