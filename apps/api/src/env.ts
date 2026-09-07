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
  /** Key for the credential vault. Any string works; use 32 random bytes in prod. */
  SECRET_KEY: z.string().default("dev-insecure-secret-key-change-me"),
  /** Shared token the worker uses to resolve connection secrets from the API. */
  INTERNAL_TOKEN: z.string().default("dev-internal-token"),
  /** Public base URL for webhook listener URLs shown in the UI. */
  PUBLIC_URL: z.string().default("http://localhost:8787"),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
