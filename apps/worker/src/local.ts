import { env } from "./env.js";

export interface EnqueueLocalTaskParams {
  runId: string;
  nodeId: string;
  temporalWorkflowId: string;
  command: string;
}

/** Activity: register a local task so the user's runner can pick it up. */
export async function enqueueLocalTask(params: EnqueueLocalTaskParams): Promise<void> {
  const res = await fetch(`${env.AWB_API_URL}/api/local-tasks/internal`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-token": env.INTERNAL_TOKEN,
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`could not enqueue local task: ${body.error ?? res.status}`);
  }
}
