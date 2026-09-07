import { proxyActivities, defineQuery, setHandler } from "@temporalio/workflow";
import {
  topologicalOrder,
  upstreamOf,
  RunProgressQueryName,
  type WorkflowExecutionInput,
  type RunResult,
  type RunProgress,
  type NodeRunResult,
} from "@awb/core";
import type * as activities from "./activities.js";

/** Temporal wraps activity errors; walk the cause chain for the real message. */
function rootMessage(err: unknown): string {
  let cur: unknown = err;
  let msg = err instanceof Error ? err.message : String(err);
  const seen = new Set<unknown>();
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const e = cur as { message?: string; cause?: unknown };
    if (typeof e.message === "string" && e.message && e.message !== "Activity task failed") {
      msg = e.message;
    }
    cur = e.cause;
  }
  return msg;
}

const getRunProgress = defineQuery<RunProgress>(RunProgressQueryName);

const { executeNode } = proxyActivities<typeof activities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "1s",
    backoffCoefficient: 2,
  },
});

/**
 * The stateful execution engine (blueprint Phase 3). Walks the DAG in
 * topological order, running each node as its own activity so Temporal tracks
 * per-node state and retries failures in isolation. A failed node marks its
 * descendants as skipped; the rest of the graph still runs. Live progress is
 * exposed via the `getRunProgress` query so callers can stream the canvas.
 */
export async function executeWorkflow(input: WorkflowExecutionInput): Promise<RunResult> {
  const { graph, runId, workflowId, mode } = input;
  const startedAt = new Date().toISOString();

  const order = topologicalOrder(graph);
  const outputs: Record<string, unknown> = {};
  const nodeResults: NodeRunResult[] = [];
  const notCompleted = new Set<string>();
  let anyFailed = false;

  setHandler(getRunProgress, () => ({
    status: anyFailed ? "failed" : "running",
    nodes: nodeResults,
    startedAt,
  }));

  for (const nodeId of order) {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) continue;

    const ups = upstreamOf(graph, nodeId);
    const inputSlice = Object.fromEntries(
      ups.filter((u) => u in outputs).map((u) => [u, outputs[u]]),
    );

    if (ups.some((u) => notCompleted.has(u))) {
      notCompleted.add(nodeId);
      nodeResults.push({
        nodeId,
        status: "skipped",
        input: inputSlice,
        logs: ["skipped: an upstream node did not complete"],
        attempts: 0,
      });
      continue;
    }

    // Publish a "running" entry so the canvas can highlight the active node.
    const entry: NodeRunResult = {
      nodeId,
      status: "running",
      input: inputSlice,
      logs: [],
      attempts: 1,
      startedAt: new Date().toISOString(),
    };
    nodeResults.push(entry);

    try {
      const res = await executeNode({
        node,
        mode,
        dryRunLlm: input.dryRunLlm,
        outputs,
        triggerPayload: input.triggerPayload,
      });
      outputs[nodeId] = res.output;
      Object.assign(entry, {
        status: "succeeded",
        output: res.output,
        logs: res.logs,
        attempts: res.attempts,
        startedAt: res.startedAt,
        finishedAt: res.finishedAt,
      });
    } catch (err) {
      anyFailed = true;
      notCompleted.add(nodeId);
      Object.assign(entry, {
        status: "failed",
        error: rootMessage(err),
        attempts: 3,
        finishedAt: new Date().toISOString(),
      });
    }
  }

  return {
    runId,
    workflowId,
    mode,
    status: anyFailed ? "failed" : "succeeded",
    nodes: nodeResults,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
