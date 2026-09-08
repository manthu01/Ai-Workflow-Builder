import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.js";

export interface HealNodeParams {
  kind: string;
  config: Record<string, unknown>;
  error: string;
  input: unknown;
}

export interface HealNodeOutput {
  canFix: boolean;
  /** Full replacement config (same keys, string values) when canFix is true. */
  config: Record<string, string>;
  explanation: string;
}

const SYSTEM = `You repair a single failed step in an automation workflow.
You are given the step's kind, its current config, the runtime error, and the
input it received. Return a corrected config that would make the step succeed.

Rules:
- Keep the same config keys. All values are strings (JSON objects are JSON strings).
- Only change what the error points at (a bad URL, a wrong field path in a
  template, a malformed JSON body, an off expression, etc).
- If the error is not something a config change can fix (a real outage, missing
  credentials, an upstream data problem), set canFix to false.
- explanation: one sentence on what you changed and why.`;

/**
 * Activity: asks the model for a corrected config for a failed node. Runs on the
 * worker; returns canFix=false (never throws) when it can't help.
 */
export async function healNode(params: HealNodeParams): Promise<HealNodeOutput> {
  const noFix = (explanation: string): HealNodeOutput => ({
    canFix: false,
    config: {},
    explanation,
  });
  if (!env.ANTHROPIC_API_KEY) return noFix("self-heal needs ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const user = [
    `step kind: ${params.kind}`,
    `current config: ${JSON.stringify(params.config)}`,
    `error: ${params.error}`,
    `input it received: ${JSON.stringify(params.input).slice(0, 3000)}`,
  ].join("\n");

  try {
    const res = await client.messages.create({
      model: env.MODEL_BALANCED,
      max_tokens: 1500,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["canFix", "config", "explanation"],
            properties: {
              canFix: { type: "boolean" },
              config: { type: "object", additionalProperties: { type: "string" } },
              explanation: { type: "string" },
            },
          },
        },
      },
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const parsed = JSON.parse(text) as HealNodeOutput;
    return {
      canFix: Boolean(parsed.canFix) && parsed.config && Object.keys(parsed.config).length > 0,
      config: parsed.config ?? {},
      explanation: parsed.explanation ?? "",
    };
  } catch (err) {
    return noFix(`self-heal call failed: ${(err as Error).message}`);
  }
}
