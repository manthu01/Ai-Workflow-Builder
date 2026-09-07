import { TriggerConfig, parseJsonObject } from "@awb/core";
import type { NodeExecutor } from "./types.js";

/**
 * Entry point. In milestone 1 there is no live webhook listener yet, so both
 * dry and live runs seed the graph from the configured sample payload.
 */
export const runTrigger: NodeExecutor = async (node, ctx) => {
  const config = TriggerConfig.parse(node.config);
  const payload = parseJsonObject(config.samplePayload, "trigger.samplePayload");
  const logs = [`trigger "${config.event}" fired`];
  if (ctx.mode === "live") {
    logs.push("no live event source wired yet - using sample payload");
  }
  return { output: payload, logs };
};
