import Anthropic from "@anthropic-ai/sdk";
import {
  CompilerGraphSchema,
  COMPILER_JSON_SCHEMA,
  type CompilerGraph,
} from "../compiler/schema.js";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildRepairPrompt,
} from "../compiler/prompt.js";
import type {
  WorkflowCompilerProvider,
  CompileAttemptContext,
} from "./provider.js";

export class AnthropicCompilerProvider implements WorkflowCompilerProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;
  private readonly fallbackModel: string;
  private readonly system = buildSystemPrompt();

  constructor(opts: { apiKey: string; model: string }) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.fallbackModel = opts.model;
  }

  async generate(
    request: string,
    ctx?: CompileAttemptContext,
  ): Promise<CompilerGraph> {
    const model = ctx?.model || this.fallbackModel;
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: buildUserPrompt(request) },
    ];
    if (ctx?.priorIssues?.length) {
      messages.push({ role: "user", content: buildRepairPrompt(ctx.priorIssues) });
    }

    const response = await this.client.messages.create({
      model,
      max_tokens: 8000,
      system: [
        { type: "text", text: this.system, cache_control: { type: "ephemeral" } },
      ],
      messages,
      output_config: {
        format: { type: "json_schema", schema: COMPILER_JSON_SCHEMA },
      },
    });

    if (response.stop_reason === "refusal") {
      throw new Error(
        `compiler model refused: ${response.stop_details?.explanation ?? "no detail"}`,
      );
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error(`compiler model did not return JSON (got ${text.slice(0, 120)}…)`);
    }
    return CompilerGraphSchema.parse(raw);
  }
}
