import type { NodeKind } from "@awb/core";
import type { NodeExecutor } from "./types.js";
import { runTrigger } from "./trigger.js";
import { runLlm } from "./llm.js";
import { runHttpRequest } from "./httpRequest.js";
import { runTransform } from "./transform.js";
import { runBranch } from "./branch.js";
import { runSlackPost } from "./slackPost.js";

export const NODE_EXECUTORS: Record<NodeKind, NodeExecutor> = {
  trigger: runTrigger,
  llm: runLlm,
  http_request: runHttpRequest,
  transform: runTransform,
  branch: runBranch,
  // Approval gates are handled inline by the engine workflow (they wait on a
  // signal), never dispatched as an activity.
  approval: async () => {
    throw new Error("approval nodes are handled by the engine, not as an activity");
  },
  slack_post: runSlackPost,
};

export type { NodeExecutor, NodeExecCtx, NodeExecResult } from "./types.js";
