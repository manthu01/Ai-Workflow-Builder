import vm from "node:vm";
import { BranchConfig } from "@awb/core";
import type { NodeExecutor } from "./types.js";

/**
 * Evaluates a boolean condition against the merged upstream outputs. The engine
 * reads `output.result` to decide which outgoing edges ("true" / "false") stay
 * live; the other side's downstream nodes are skipped.
 */
export const runBranch: NodeExecutor = async (node, ctx) => {
  const config = BranchConfig.parse(node.config);
  const sandbox = { input: structuredClone(ctx.outputs), result: undefined as unknown };
  const context = vm.createContext(sandbox, { name: `branch:${node.id}` });

  try {
    sandbox.result = vm.runInContext(`(${config.expression})`, context, {
      timeout: 1000,
      displayErrors: true,
    });
  } catch (err) {
    throw new Error(`branch condition failed: ${(err as Error).message}`);
  }

  const taken = Boolean(sandbox.result);
  return {
    output: { result: taken, expression: config.expression },
    logs: [`condition evaluated to ${taken ? "true" : "false"}`],
  };
};
