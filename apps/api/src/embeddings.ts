import {
  createEmbeddingProvider,
  createRerankProvider,
  type EmbeddingProvider,
  type RerankProvider,
} from "@awb/embeddings";
import { env } from "./env.js";

let provider: EmbeddingProvider | undefined;

/** The configured embedder, built on first use (the local model loads lazily). */
export function getEmbedder(): EmbeddingProvider {
  provider ??= createEmbeddingProvider({
    mode: env.EMBEDDINGS_MODE,
    model: env.EMBEDDING_MODEL,
    dimensions: env.EMBEDDING_DIMENSIONS,
    voyageApiKey: env.VOYAGE_API_KEY,
  });
  return provider;
}

let reranker: RerankProvider | undefined;

/** The configured re-ranker, built on first use (the local model loads lazily). */
export function getReranker(): RerankProvider {
  reranker ??= createRerankProvider({
    mode: env.RERANK_MODE,
    model: env.RERANK_MODEL,
    voyageApiKey: env.VOYAGE_API_KEY,
  });
  return reranker;
}
