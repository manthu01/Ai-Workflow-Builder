import Anthropic from "@anthropic-ai/sdk";
import { LlmConfig, renderString } from "@awb/core";
import { env } from "../env.js";
import type { NodeExecutor } from "./types.js";

let client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("llm node needs ANTHROPIC_API_KEY (set DRY_RUN_LLM=mock to skip live calls in dry runs)");
  }
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

function mockAnswer(prompt: string, output: "text" | "json"): unknown {
  const firstLine = prompt.split("\n").find((l) => l.trim())?.slice(0, 160) ?? "";
  if (output === "json") {
    return { json: { summary: `[mock] ${firstLine}`, mock: true } };
  }
  return { text: `[mock LLM output] Responding to: ${firstLine}` };
}

export const runLlm: NodeExecutor = async (node, ctx) => {
  const config = LlmConfig.parse(node.config);
  const prompt = renderString(config.prompt, ctx.outputs);

  const live = ctx.mode === "live" || ctx.dryRunLlm === "live";
  if (!live) {
    return {
      output: mockAnswer(prompt, config.output),
      logs: [`dry run: returned a mock ${config.output} answer (no model call)`],
    };
  }

  const model = config.model ?? env.COMPILER_MODEL;
  const response = await getClient().messages.create({
    model,
    max_tokens: 2000,
    system:
      config.output === "json"
        ? "Respond with a single JSON object and nothing else."
        : "Respond with plain text only.",
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  if (config.output === "json") {
    try {
      return { output: { json: JSON.parse(text) }, logs: [`llm (${model}) returned JSON`] };
    } catch {
      return {
        output: { json: null, raw: text },
        logs: [`llm (${model}) output was not valid JSON`],
      };
    }
  }
  return { output: { text }, logs: [`llm (${model}) returned ${text.length} chars`] };
};
