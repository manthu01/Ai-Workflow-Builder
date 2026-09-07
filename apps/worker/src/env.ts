import { z } from "zod";

const EnvSchema = z.object({
  TEMPORAL_ADDRESS: z.string().default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().default("default"),
  TEMPORAL_TASK_QUEUE: z.string().default("awb-workflows"),
  ANTHROPIC_API_KEY: z.string().optional(),
  MODEL_FAST: z.string().default("claude-haiku-4-5"),
  MODEL_BALANCED: z.string().default("claude-sonnet-5"),
  MODEL_DEEP: z.string().default("claude-opus-5"),
  SLACK_BOT_TOKEN: z.string().optional(),
  /** API base URL used to resolve connection secrets at execution time. */
  AWB_API_URL: z.string().default("http://localhost:8787"),
  INTERNAL_TOKEN: z.string().default("dev-internal-token"),
});

export const env = EnvSchema.parse(process.env);

export const tierModels = {
  fast: env.MODEL_FAST,
  balanced: env.MODEL_BALANCED,
  deep: env.MODEL_DEEP,
};
