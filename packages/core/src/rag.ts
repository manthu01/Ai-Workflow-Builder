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

/** Appended to an llm step's instructions when it has requireCitations on. */
export const CITATION_INSTRUCTION = [
  "Answer only from the context passages in the prompt; do not use outside knowledge.",
  // The example tag must not itself match the citation pattern, or it would
  // count as a provided chunk if this text ever reached a prompt.
  "Each passage starts with a tag like [chunk:<id>]. After every claim, cite the passage",
  "that supports it by repeating its tag exactly. If the context does not contain the",
  "answer, say so plainly and cite nothing.",
].join(" ");

export interface GroundingCheck {
  /** True only if the answer cites at least one chunk and every cited chunk was provided. */
  grounded: boolean;
  /** Cited chunk ids that were in the prompt. */
  citations: string[];
  /** Cited chunk ids that were not in the prompt (hallucinated or mangled). */
  invalidCitations: string[];
  /** Why grounded is false; absent when grounded. */
  reason?: string;
}

/**
 * Checks an answer's citations against the chunks the model was actually
 * given, i.e. the [chunk:<id>] tags in its rendered prompt. One fabricated
 * citation makes the whole answer ungrounded: a reader can't tell which of
 * its claims rest on it.
 */
export function checkGrounding(answer: string, prompt: string): GroundingCheck {
  const provided = new Set(extractCitations(prompt));
  const cited = extractCitations(answer);
  const citations = cited.filter((id) => provided.has(id));
  const invalidCitations = cited.filter((id) => !provided.has(id));

  let reason: string | undefined;
  if (provided.size === 0) reason = "the prompt contains no [chunk:<id>] context to cite";
  else if (cited.length === 0) reason = "the answer cites no chunks";
  else if (invalidCitations.length) reason = `the answer cites chunks it was not given: ${invalidCitations.join(", ")}`;

  return { grounded: reason === undefined, citations, invalidCitations, ...(reason && { reason }) };
}
