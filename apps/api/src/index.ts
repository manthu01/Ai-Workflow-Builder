import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { NODE_CATALOG } from "@awb/core";
import { env } from "./env.js";
import { workflowRoutes } from "./routes/workflows.js";
import { runRoutes } from "./routes/runs.js";
import { connectionRoutes } from "./routes/connections.js";
import { deploymentRoutes, hookRoutes } from "./routes/deployments.js";
import { scheduleRoutes } from "./routes/schedules.js";
import { versionRoutes } from "./routes/versions.js";
import { startScheduler } from "./scheduler.js";

const app = new Hono();

app.use("*", cors({ origin: env.WEB_ORIGIN }));

app.get("/health", (c) =>
  c.json({ ok: true, compilerMode: env.COMPILER_MODE, taskQueue: env.TEMPORAL_TASK_QUEUE }),
);

/** Node palette for the canvas. */
app.get("/api/node-catalog", (c) => c.json({ nodes: Object.values(NODE_CATALOG) }));

app.route("/api/workflows", workflowRoutes);
app.route("/api/connections", connectionRoutes);
app.route("/api/hooks", hookRoutes);
app.route("/api", runRoutes);
app.route("/api", deploymentRoutes);
app.route("/api", scheduleRoutes);
app.route("/api", versionRoutes);

const port = env.API_PORT;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}  (compiler: ${env.COMPILER_MODE})`);
  startScheduler();
});
