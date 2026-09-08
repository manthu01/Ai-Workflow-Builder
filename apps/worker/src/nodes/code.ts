import { Worker } from "node:worker_threads";
import { CodeConfig } from "@awb/core";
import type { NodeExecutor } from "./types.js";

const RUNNER = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const input = workerData.input;
  // new Function bodies run in global scope - no access to require/module here.
  const fn = new Function('input', workerData.code);
  const value = await fn(input);
  parentPort.postMessage({ ok: true, value });
})().catch((e) => {
  parentPort.postMessage({ ok: false, error: String((e && e.message) || e) });
});
`;

/**
 * Runs author JavaScript in a separate worker thread with a hard timeout. The
 * thread has its own globals and is terminated if it overruns - a lightweight
 * sandbox (isolation + resource cap), not a full jail.
 */
export const runCode: NodeExecutor = async (node, ctx) => {
  const config = CodeConfig.parse(node.config);
  const timeoutMs = Math.min(30_000, Math.max(100, Number(config.timeoutMs) || 2000));

  const result = await new Promise<{ ok: boolean; value?: unknown; error?: string }>(
    (resolve) => {
      const worker = new Worker(RUNNER, {
        eval: true,
        workerData: { input: structuredClone(ctx.outputs), code: config.code },
        resourceLimits: { maxOldGenerationSizeMb: 64 },
      });
      const timer = setTimeout(() => {
        void worker.terminate();
        resolve({ ok: false, error: `code timed out after ${timeoutMs}ms` });
      }, timeoutMs);
      worker.once("message", (m) => {
        clearTimeout(timer);
        void worker.terminate();
        resolve(m);
      });
      worker.once("error", (e) => {
        clearTimeout(timer);
        resolve({ ok: false, error: e.message });
      });
    },
  );

  if (!result.ok) throw new Error(result.error ?? "code node failed");
  return {
    output: result.value,
    logs: [`code ran in a worker thread (${timeoutMs}ms cap)`],
  };
};
