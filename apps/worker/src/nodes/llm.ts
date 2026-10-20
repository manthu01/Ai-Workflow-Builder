import Anthropic from "@anthropic-ai/sdk";
import {
  CITATION_INSTRUCTION,
  LlmConfig,
  checkGrounding,
  extractCitations,
  renderString,
  resolveModel,
} from "@awb/core";
import { env, tierModels } from "../env.js";
import type { NodeExecResult, NodeExecutor } from "./types.js";

let client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("llm node needs ANTHROPIC_API_KEY (set DRY_RUN_LLM=mock to skip live calls in dry runs)");
  }
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

function mockAnswer(
  prompt: string,
  output: "text" | "json",
  cite: boolean,
): { output: unknown; raw: string } {
  const firstLine = prompt.split("\n").find((l) => l.trim())?.slice(0, 160) ?? "";
  // With citations required, the mock cites the first chunk it was given, so a
  // dry run exercises the grounded path (and an empty context the ungrounded one).
  const firstChunk = cite ? extractCitations(prompt)[0] : undefined;
  const citation = firstChunk ? ` [chunk:${firstChunk}]` : "";
  if (output === "json") {
    const json = { summary: `[mock] ${firstLine}${citation}`, mock: true };
    return { output: { json }, raw: JSON.stringify(json) };
  }
  const text = `[mock LLM output] Responding to: ${firstLine}${citation}`;
  return { output: { text }, raw: text };
}

/**
 * With requireCitations on, adds the grounding verdict (grounded, citations,
 * invalidCitations, reason) to the output so a branch or approval can route
 * on `{{ node.grounded }}`. The answer's raw text is what gets checked.
 */
function withGrounding(
  result: NodeExecResult,
  raw: string,
  prompt: string,
  requireCitations: boolean,
): NodeExecResult {
  if (!requireCitations) return result;
  const check = checkGrounding(raw, prompt);
  return {
    output: { ...(result.output as Record<string, unknown>), ...check },
    logs: [
      ...result.logs,
      check.grounded
        ? `grounded: cites ${check.citations.length} retrieved chunk(s)`
        : `NOT grounded: ${check.reason}`,
    ],
  };
}

export const runLlm: NodeExecutor = async (node, ctx) => {
  const config = LlmConfig.parse(node.config);
  const prompt = renderString(config.prompt, ctx.outputs);
  const grounded = (result: NodeExecResult, raw: string) =>
    withGrounding(result, raw, prompt, config.requireCitations);

  const routedModel = resolveModel(config.tier, config.model, tierModels);
  const live = ctx.mode === "live" || ctx.dryRunLlm === "live";
  if (!live) {
    const mock = mockAnswer(prompt, config.output, config.requireCitations);
    return grounded(
      {
        output: mock.output,
        logs: [
          `dry run: mock ${config.output} answer (tier "${config.tier}" would use ${routedModel}, no call)`,
        ],
      },
      mock.raw,
    );
  }

  const model = routedModel;
  const response = await getClient().messages.create({
    model,
    max_tokens: 2000,
    system: [
      config.output === "json"
        ? "Respond with a single JSON object and nothing else."
        : "Respond with plain text only.",
      ...(config.requireCitations ? [CITATION_INSTRUCTION] : []),
    ].join("\n\n"),
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  if (config.output === "json") {
    try {
      return grounded({ output: { json: JSON.parse(text) }, logs: [`llm (${model}) returned JSON`] }, text);
    } catch {
      return grounded(
        { output: { json: null, raw: text }, logs: [`llm (${model}) output was not valid JSON`] },
        text,
      );
    }
  }
  return grounded({ output: { text }, logs: [`llm (${model}) returned ${text.length} chars`] }, text);
};
