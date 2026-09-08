import vm from "node:vm";
import { LoopConfig } from "@awb/core";
import type { NodeExecutor } from "./types.js";

/**
 * Maps a per-item expression over an array. `items` resolves to the array;
 * `expression` runs once per element with `item`, `index`, and `input` in scope.
 * Output: `{ results: [...], count }`.
 */
export const runLoop: NodeExecutor = async (node, ctx) => {
  const config = LoopConfig.parse(node.config);
  const input = structuredClone(ctx.outputs);
  const sandbox: Record<string, unknown> = { input, item: undefined, index: 0 };
  const context = vm.createContext(sandbox, { name: `loop:${node.id}` });

  let list: unknown;
  try {
    list = vm.runInContext(`(${config.items})`, context, { timeout: 1000 });
  } catch (err) {
    throw new Error(`loop "items" expression failed: ${(err as Error).message}`);
  }
  if (!Array.isArray(list)) {
    throw new Error(`loop "items" did not evaluate to an array (got ${typeof list})`);
  }

  const results: unknown[] = [];
  for (let i = 0; i < list.length; i++) {
    sandbox.item = list[i];
    sandbox.index = i;
    try {
      results.push(
        vm.runInContext(`(${config.expression})`, context, { timeout: 1000 }),
      );
    } catch (err) {
      throw new Error(`loop body failed at index ${i}: ${(err as Error).message}`);
    }
  }

  return {
    output: { results, count: results.length },
    logs: [`mapped ${results.length} item${results.length === 1 ? "" : "s"}`],
  };
};
