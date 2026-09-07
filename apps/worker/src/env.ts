import { z } from "zod";

const EnvSchema = z.object({
  TEMPORAL_ADDRESS: z.string().default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().default("default"),
  TEMPORAL_TASK_QUEUE: z.string().default("awb-workflows"),
  ANTHROPIC_API_KEY: z.string().optional(),
  COMPILER_MODEL: z.string().default("claude-sonnet-5"),
  SLACK_BOT_TOKEN: z.string().optional(),
});

export const env = EnvSchema.parse(process.env);
