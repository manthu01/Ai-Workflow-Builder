import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities.js";
import { env } from "./env.js";

// tsx runs the .ts sources directly; a compiled build runs .js from dist/.
const isTs = import.meta.url.endsWith(".ts");
const workflowsPath = fileURLToPath(
  new URL(isTs ? "./workflows.ts" : "./workflows.js", import.meta.url),
);

async function main() {
  const connection = await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS });

  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowsPath,
    activities,
  });

  console.log(
    `[worker] polling "${env.TEMPORAL_TASK_QUEUE}" on ${env.TEMPORAL_ADDRESS} (namespace: ${env.TEMPORAL_NAMESPACE})`,
  );
  await worker.run();
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
