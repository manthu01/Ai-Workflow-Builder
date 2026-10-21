import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { env } from "./env.js";
import { startScheduler } from "./scheduler.js";
import { startDemoCleanup } from "./demo.js";
import { seedTemplates } from "./seed.js";
import { seedSampleKnowledgeBase } from "./kb/seed.js";

const port = env.API_PORT;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `[api] listening on http://localhost:${info.port}  (compiler: ${env.COMPILER_MODE}${env.DEMO_MODE ? ", DEMO MODE" : ""})`,
  );
  // Schedules are disabled in demo mode, so there is nothing for the scheduler to fire.
  if (!env.DEMO_MODE) startScheduler();
  startDemoCleanup();
  void seedTemplates();
  void seedSampleKnowledgeBase();
});
