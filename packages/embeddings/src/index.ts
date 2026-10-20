import { LocalEmbeddingProvider } from "./local.js";
import type { EmbeddingProvider } from "./provider.js";
import { VoyageEmbeddingProvider } from "./voyage.js";

export * from "./provider.js";
export { LocalEmbeddingProvider } from "./local.js";
export { VoyageEmbeddingProvider } from "./voyage.js";

export const DEFAULT_MODELS = {
  local: "Xenova/bge-small-en-v1.5",
  voyage: "voyage-4-lite",
} as const;

export interface EmbeddingSettings {
  /** local = in-process model, no key (the default, like COMPILER_MODE=stub). */
  mode: "local" | "voyage";
  /** Empty means the mode's default model. */
  model?: string;
  /** Must equal the kb_chunks.embedding column width (EMBEDDING_DIMENSIONS). */
  dimensions: number;
  voyageApiKey?: string;
}

/** Builds the configured provider. Each app passes values from its own env. */
export function createEmbeddingProvider(s: EmbeddingSettings): EmbeddingProvider {
  const model = s.model || DEFAULT_MODELS[s.mode];
  if (s.mode === "voyage") {
    if (!s.voyageApiKey) {
      throw new Error("EMBEDDINGS_MODE=voyage needs VOYAGE_API_KEY (or use EMBEDDINGS_MODE=local)");
    }
    return new VoyageEmbeddingProvider({ apiKey: s.voyageApiKey, model, dimensions: s.dimensions });
  }
  return new LocalEmbeddingProvider({ model, dimensions: s.dimensions });
}

/**
 * Vectors from different models live in unrelated spaces, so similarity
 * between them is meaningless. Refuse rather than return garbage rankings.
 */
export function assertKbCompatible(
  kb: { name: string; embeddingModel: string; dimensions: number },
  provider: EmbeddingProvider,
): void {
  if (kb.embeddingModel !== provider.id || kb.dimensions !== provider.dimensions) {
    throw new Error(
      `knowledge base "${kb.name}" was built with ${kb.embeddingModel} (${kb.dimensions} dims) ` +
        `but the configured embedder is ${provider.id} (${provider.dimensions} dims); ` +
        `re-index the KB or switch EMBEDDINGS_MODE/EMBEDDING_MODEL back`,
    );
  }
}
