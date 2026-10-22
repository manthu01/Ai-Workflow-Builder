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
  /** Embeddings for knowledge bases: local = in-process model, no API key. */
  EMBEDDINGS_MODE: z.enum(["local", "voyage"]).default("local"),
  /** Empty means the mode's default (bge-small-en-v1.5 / voyage-4-lite). */
  EMBEDDING_MODEL: z.string().default(""),
  /** Must match the kb_chunks.embedding column (see db/schema.ts). */
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(384),
  VOYAGE_API_KEY: z.string().optional(),
  /** Second-pass re-ranking (retrieve nodes with rerank on): local cross-encoder or Voyage. */
  RERANK_MODE: z.enum(["local", "voyage"]).default("local"),
  /** Empty means the mode's default (ms-marco-MiniLM-L-6-v2 / rerank-3-lite). */
  RERANK_MODEL: z.string().default(""),
  /** Key for the credential vault. Any string works; use 32 random bytes in prod. */
  SECRET_KEY: z.string().default("dev-insecure-secret-key-change-me"),
  /** Shared token the worker uses to resolve connection secrets from the API. */
  INTERNAL_TOKEN: z.string().default("dev-internal-token"),
  /** Token the local runner presents to poll for and report on local tasks. */
  LOCAL_RUNNER_TOKEN: z.string().default("dev-local-runner-token"),
  /** Public base URL for webhook listener URLs shown in the UI. */
  PUBLIC_URL: z.string().default("http://localhost:8787"),

  /**
   * Public demo mode: per-visitor isolation (awb_sid cookie), dry runs only,
   * dangerous features off, compile rate limits, nightly cleanup. See demo.ts.
   */
  DEMO_MODE: z
    .enum(["true", "false", "1", "0", ""])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  /** Compiles per visitor (cookie) and per IP, per rolling hour. */
  DEMO_COMPILES_PER_HOUR: z.coerce.number().int().positive().default(5),
  /** Compiles across all visitors per UTC day; past it the compiler falls back to the stub. */
  DEMO_COMPILES_PER_DAY: z.coerce.number().int().positive().default(200),
  DEMO_PROMPT_MAX_CHARS: z.coerce.number().int().positive().default(1000),
  /** Visitor-owned workflows older than this are deleted by the cleanup job. */
  DEMO_RETENTION_HOURS: z.coerce.number().positive().default(24),
  /** Linked from the demo banner. */
  DEMO_REPO_URL: z.string().default("https://github.com/manthu01/Ai-Workflow-Builder"),
  /**
   * Set when the demo is embedded in another site's iframe (e.g. a Hugging Face
   * Space page): the visitor cookie becomes SameSite=None + Partitioned so the
   * browser still sends it from inside the frame. Requires an https PUBLIC_URL.
   */
  DEMO_COOKIE_CROSS_SITE: z
    .enum(["true", "false", "1", "0", ""])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;

export const tierModels = {
  fast: env.MODEL_FAST,
  balanced: env.MODEL_BALANCED,
  deep: env.MODEL_DEEP,
};
