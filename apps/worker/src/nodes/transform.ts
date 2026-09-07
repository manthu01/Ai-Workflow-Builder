import vm from "node:vm";
import { TransformConfig } from "@awb/core";
import type { NodeExecutor } from "./types.js";

/**
 * Evaluates a single JS expression with `input` bound to the merged upstream
 * outputs. Runs in a bare vm context with a 1s timeout - not a hardened
 * sandbox (that is a later phase), but no access to require/process/globals.
 */
export const runTransform: NodeExecutor = async (node, ctx) => {
  const config = TransformConfig.parse(node.config);
  const sandbox = { input: structuredClone(ctx.outputs), result: undefined as unknown };
  const context = vm.createContext(sandbox, { name: `transform:${node.id}` });

  try {
    sandbox.result = vm.runInContext(`(${config.expression})`, context, {
      timeout: 1000,
      displayErrors: true,
    });
  } catch (err) {
    throw new Error(`transform expression failed: ${(err as Error).message}`);
  }

  return {
    output: sandbox.result,
    logs: [`evaluated expression -> ${typeof sandbox.result}`],
  };
};
