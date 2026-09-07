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
  /** Force a compiler model; leave empty to route by request complexity. */
  COMPILER_MODEL: z.string().default(""),
  DRY_RUN_LLM: z.enum(["mock", "live"]).default("mock"),
  /** Model ids for the three routing tiers (compiler + llm nodes). */
  MODEL_FAST: z.string().default("claude-haiku-4-5"),
  MODEL_BALANCED: z.string().default("claude-sonnet-5"),
  MODEL_DEEP: z.string().default("claude-opus-5"),
  /** Key for the credential vault. Any string works; use 32 random bytes in prod. */
  SECRET_KEY: z.string().default("dev-insecure-secret-key-change-me"),
  /** Shared token the worker uses to resolve connection secrets from the API. */
  INTERNAL_TOKEN: z.string().default("dev-internal-token"),
  /** Public base URL for webhook listener URLs shown in the UI. */
  PUBLIC_URL: z.string().default("http://localhost:8787"),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;

export const tierModels = {
  fast: env.MODEL_FAST,
  balanced: env.MODEL_BALANCED,
  deep: env.MODEL_DEEP,
};
