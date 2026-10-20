/** Shared shapes for knowledge-base retrieval (API search, retrieve node, UI). */

export const RETRIEVAL_MODES = ["vector", "keyword", "hybrid"] as const;
export type RetrievalMode = (typeof RETRIEVAL_MODES)[number];

export interface RetrievedChunk {
  id: string;
  content: string;
  /**
   * Higher is better. vector: cosine similarity; keyword: ts_rank (small
   * values); hybrid: RRF normalized to 0-1.
   */
  score: number;
  documentId: string;
  /** Source document's filename (or URL). */
  document: string;
  page?: number;
  heading?: string;
  /** Hybrid only: this chunk's 1-based rank in each retriever (null = not returned). */
  ranks?: { vector: number | null; keyword: number | null };
}

/** Output of a retrieve node. */
export interface RetrieveOutput {
  chunks: RetrievedChunk[];
  /** Ready to drop into an llm prompt: each chunk prefixed by its citation tag. */
  context: string;
  count: number;
}

/** The tag an answer cites a chunk with, e.g. "[chunk:chk_abc123]". */
export const citationTag = (chunkId: string) => `[chunk:${chunkId}]`;

/** Every "[chunk:<id>]" in a text, in order of appearance, de-duplicated. */
export function extractCitations(text: string): string[] {
  return [...new Set([...text.matchAll(/\[chunk:([A-Za-z0-9_-]+)\]/g)].map((m) => m[1]!))];
}

export function buildRetrievedContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c) => {
      const where = [c.document, c.heading, c.page !== undefined ? `p. ${c.page}` : undefined]
        .filter(Boolean)
        .join(" · ");
      return `${citationTag(c.id)} (source: ${where})\n${c.content}`;
    })
    .join("\n\n");
}
