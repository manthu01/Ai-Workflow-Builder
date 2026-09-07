import {
  proxyActivities,
  defineQuery,
  defineSignal,
  setHandler,
  condition,
} from "@temporalio/workflow";
import {
  liveInboundEdges,
  renderString,
  ApprovalConfig,
  RunProgressQueryName,
  ApprovalSignalName,
  type WorkflowExecutionInput,
  type RunResult,
  type RunProgress,
  type NodeRunResult,
  type NodeOutcome,
  type ApprovalDecision,
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
const approvalSignal = defineSignal<[ApprovalDecision]>(ApprovalSignalName);

const { executeNode } = proxyActivities<typeof activities>({
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 3, initialInterval: "1s", backoffCoefficient: 2 },
});

/**
 * The stateful execution engine (blueprint Phase 3 + Expansion #4). Runs the DAG
 * in dependency order, executing every node whose inputs are ready **in
 * parallel**, and honouring "branch" nodes: only the taken side's edges stay
 * live, so the other side's descendants are skipped. A merge node runs as soon
 * as any one live path reaches it.
 */
export async function executeWorkflow(input: WorkflowExecutionInput): Promise<RunResult> {
  const { graph, runId, workflowId, mode } = input;
  const startedAt = new Date().toISOString();

  const results: Record<string, NodeRunResult> = {};
  const outputs: Record<string, unknown> = {};
  let anyFailed = false;

  const outcomes = (): Record<string, NodeOutcome> =>
    Object.fromEntries(
      Object.entries(results).map(([id, r]) => [id, { status: r.status, output: r.output }]),
    );

  const approvals: Record<string, ApprovalDecision> = {};
  setHandler(approvalSignal, (d) => {
    approvals[d.nodeId] = d;
  });

  setHandler(getRunProgress, () => ({
    status: anyFailed ? "failed" : "running",
    nodes: Object.values(results),
    startedAt,
  }));

  const isSettled = (id: string) => {
    const r = results[id];
    return r !== undefined && r.status !== "running" && r.status !== "awaiting";
  };

  while (Object.keys(results).length < graph.nodes.length) {
    const ready = graph.nodes.filter(
      (n) =>
        results[n.id] === undefined &&
        graph.edges.filter((e) => e.target === n.id).every((e) => isSettled(e.source)),
    );
    if (ready.length === 0) break; // no progress possible (cycle) - guarded by validation

    const toRun: typeof ready = [];
    for (const n of ready) {
      const inbound = graph.edges.filter((e) => e.target === n.id);
      if (inbound.length === 0) {
        toRun.push(n);
        continue;
      }
      const live = liveInboundEdges(graph, n.id, outcomes());
      if (live.length === 0) {
        results[n.id] = {
          nodeId: n.id,
          status: "skipped",
          input: {},
          logs: ["skipped: no live inbound path"],
          attempts: 0,
        };
      } else {
        toRun.push(n);
      }
    }

    // Snapshot each node's input from its live upstreams, mark running/awaiting.
    const inputs = new Map<string, Record<string, unknown>>();
    for (const n of toRun) {
      const live = liveInboundEdges(graph, n.id, outcomes());
      const slice: Record<string, unknown> = {};
      for (const e of live) slice[e.source] = outputs[e.source];
      inputs.set(n.id, slice);
      const isApproval = n.kind === "approval";
      results[n.id] = {
        nodeId: n.id,
        status: isApproval ? "awaiting" : "running",
        input: slice,
        logs: isApproval
          ? [renderString(ApprovalConfig.parse(n.config).message, outputs)]
          : [],
        attempts: 1,
        startedAt: new Date().toISOString(),
      };
    }

    const settled = await Promise.all(
      toRun.map(async (n): Promise<NodeRunResult> => {
        const slice = inputs.get(n.id)!;

        if (n.kind === "approval") {
          const cfg = ApprovalConfig.parse(n.config);
          const message = renderString(cfg.message, outputs);
          await condition(() => approvals[n.id] !== undefined);
          const d = approvals[n.id]!;
          if (d.decision === "approved") {
            return {
              nodeId: n.id,
              status: "succeeded",
              input: slice,
              output: { approved: true, note: d.note ?? "", by: d.by ?? "", message },
              logs: [`approved${d.by ? ` by ${d.by}` : ""}${d.note ? `: ${d.note}` : ""}`],
              attempts: 1,
              finishedAt: new Date().toISOString(),
            };
          }
          anyFailed = true;
          return {
            nodeId: n.id,
            status: "failed",
            input: slice,
            error: `rejected${d.by ? ` by ${d.by}` : ""}${d.note ? `: ${d.note}` : ""}`,
            logs: [],
            attempts: 1,
            finishedAt: new Date().toISOString(),
          };
        }

        try {
          const res = await executeNode({
            node: n,
            mode,
            dryRunLlm: input.dryRunLlm,
            outputs,
            triggerPayload: input.triggerPayload,
          });
          return {
            nodeId: n.id,
            status: "succeeded",
            input: slice,
            output: res.output,
            logs: res.logs,
            attempts: res.attempts,
            startedAt: res.startedAt,
            finishedAt: res.finishedAt,
          };
        } catch (err) {
          anyFailed = true;
          return {
            nodeId: n.id,
            status: "failed",
            input: slice,
            error: rootMessage(err),
            logs: [],
            attempts: 3,
            finishedAt: new Date().toISOString(),
          };
        }
      }),
    );

    for (const r of settled) {
      results[r.nodeId] = r;
      if (r.status === "succeeded") outputs[r.nodeId] = r.output;
    }
  }

  // Node ordering in the result follows the graph's declared order.
  const ordered = graph.nodes
    .map((n) => results[n.id])
    .filter((r): r is NodeRunResult => r !== undefined);

  return {
    runId,
    workflowId,
    mode,
    status: anyFailed ? "failed" : "succeeded",
    nodes: ordered,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
