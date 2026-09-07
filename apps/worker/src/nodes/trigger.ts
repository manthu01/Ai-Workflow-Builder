import { TriggerConfig, parseJsonObject } from "@awb/core";
import type { NodeExecutor } from "./types.js";

/**
 * Entry point. A webhook-triggered run passes the real event body as
 * `ctx.triggerPayload`; otherwise the run seeds the graph from the configured
 * sample payload (dry runs, manual live runs).
 */
export const runTrigger: NodeExecutor = async (node, ctx) => {
  const config = TriggerConfig.parse(node.config);

  if (ctx.triggerPayload !== undefined && ctx.triggerPayload !== null) {
    return {
      output: ctx.triggerPayload,
      logs: [`trigger "${config.event}" fired from a real event`],
    };
  }

  const payload = parseJsonObject(config.samplePayload, "trigger.samplePayload");
  const logs = [`trigger "${config.event}" fired`];
  if (ctx.mode === "live") {
    logs.push("no real event body - using sample payload");
  }
  return { output: payload, logs };
};
