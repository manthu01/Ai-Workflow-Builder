import { z } from "zod";

const EnvSchema = z.object({
  API_PORT: z.coerce.number().default(8787),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  DATABASE_URL: z.string().default("postgres://awb:awb@localhost:5433/awb"),
  TEMPORAL_ADDRESS: z.string().default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().default("default"),
  TEMPORAL_TASK_QUEUE: z.string().default("awb-workflows"),
  COMPILER_MODE: z.enum(["stub", "claude"]).default("stub"),
  ANTHROPIC_API_KEY: z.string().optional(),
  COMPILER_MODEL: z.string().default("claude-sonnet-5"),
  DRY_RUN_LLM: z.enum(["mock", "live"]).default("mock"),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
