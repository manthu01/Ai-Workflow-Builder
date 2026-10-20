import { eq, sql } from "drizzle-orm";
import {
  reciprocalRankFusion,
  type RetrievalMode,
  type RetrievedChunk,
} from "@awb/core";
import { assertKbCompatible } from "@awb/embeddings";
import { db, schema } from "../db/client.js";
import { getEmbedder, getReranker } from "../embeddings.js";

export interface SearchParams {
  kbId: string;
  query: string;
  topK: number;
  mode: RetrievalMode;
  minScore?: number;
  /** Re-score the candidates with the cross-encoder before taking the top K. */
  rerank?: boolean;
}

/** Candidates per retriever when re-ranking: enough for the cross-encoder to promote a buried answer. */
const RERANK_CANDIDATES = 20;

interface ChunkRow extends Record<string, unknown> {
  id: string;
  content: string;
  score: number;
  document_id: string;
  filename: string;
  metadata: { page?: number; heading?: string };
}

export class KbNotFoundError extends Error {}

export async function searchKb(p: SearchParams): Promise<RetrievedChunk[]> {
  const [kb] = await db
    .select()
    .from(schema.knowledgeBases)
    .where(eq(schema.knowledgeBases.id, p.kbId));
  if (!kb) throw new KbNotFoundError(`knowledge base ${p.kbId} not found`);

  // Each retriever returns its top 2K (more when re-ranking, to give it a shortlist to work with).
  const limit = p.rerank ? Math.max(p.topK * 2, RERANK_CANDIDATES) : p.topK * 2;

  let chunks: RetrievedChunk[];
  if (p.mode === "hybrid") {
    const [vector, keyword] = await Promise.all([vectorSearch(kb, p, limit), keywordSearch(p, limit)]);
    chunks = reciprocalRankFusion([vector.map(toChunk), keyword.map(toChunk)], (c) => c.id).map(
      (f) => ({
        ...f.item,
        score: f.score,
        ranks: { vector: f.ranks[0] ?? null, keyword: f.ranks[1] ?? null },
      }),
    );
  } else {
    const rows =
      p.mode === "vector" ? await vectorSearch(kb, p, limit) : await keywordSearch(p, limit);
    chunks = rows.map(toChunk);
  }
  if (p.rerank && chunks.length > 0) chunks = await rerank(p.query, chunks);
  return chunks.filter((c) => c.score >= (p.minScore ?? 0)).slice(0, p.topK);
}

/** Second pass: the cross-encoder's relevance replaces the score and decides the order. */
async function rerank(query: string, chunks: RetrievedChunk[]): Promise<RetrievedChunk[]> {
  const scores = await getReranker().rerank(query, chunks.map((c) => c.content));
  return chunks
    .map((c, i) => ({ ...c, retrievalScore: c.score, score: scores[i] ?? 0 }))
    .sort((a, b) => b.score - a.score);
}

function toChunk(r: ChunkRow): RetrievedChunk {
  return {
    id: r.id,
    content: r.content,
    score: Number(r.score),
    documentId: r.document_id,
    document: r.filename,
    ...(r.metadata.page !== undefined && { page: r.metadata.page }),
    ...(r.metadata.heading !== undefined && { heading: r.metadata.heading }),
  };
}

/**
 * Nearest neighbours by cosine distance (`<=>`), scored as similarity 1 - d.
 * Fetches more than topK so fusion or re-ranking has candidates to work with.
 *
 * The kb_id filter is applied after the HNSW scan, which on its own can return
 * fewer than LIMIT rows when other KBs crowd the nearest neighbours. pgvector
 * 0.8's iterative scan keeps searching until the limit is filled; relaxed
 * order means the outer query re-sorts by exact distance.
 */
async function vectorSearch(
  kb: typeof schema.knowledgeBases.$inferSelect,
  p: SearchParams,
  limit: number,
): Promise<ChunkRow[]> {
  const embedder = getEmbedder();
  assertKbCompatible(kb, embedder);
  const [vec] = await embedder.embed([p.query], "query");
  const q = `[${vec!.join(",")}]`;

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL hnsw.iterative_scan = relaxed_order`);
    const res = await tx.execute<ChunkRow>(sql`
      SELECT * FROM (
        SELECT c.id, c.content, c.metadata, c.document_id, c.chunk_index, d.filename,
               1 - (c.embedding <=> ${q}::vector) AS score
        FROM kb_chunks c
        JOIN kb_documents d ON d.id = c.document_id
        WHERE c.kb_id = ${p.kbId}
        ORDER BY c.embedding <=> ${q}::vector
        LIMIT ${limit}
      ) nearest
      ORDER BY score DESC, filename, chunk_index`);
    return res.rows;
  });
}

/**
 * Full-text search ranked by ts_rank. plainto_tsquery ANDs every term, so a
 * natural question ("how many vacation days do I get") would only match
 * chunks containing all of them. Rewriting & to | ORs the terms instead, and
 * ts_rank still rewards chunks that match more of them.
 */
async function keywordSearch(p: SearchParams, limit: number): Promise<ChunkRow[]> {
  const res = await db.execute<ChunkRow>(sql`
    SELECT c.id, c.content, c.metadata, c.document_id, d.filename,
           ts_rank(c.content_tsv, q.query) AS score
    FROM kb_chunks c
    JOIN kb_documents d ON d.id = c.document_id,
         to_tsquery('english', replace(plainto_tsquery('english', ${p.query})::text, '&', '|')) AS q(query)
    WHERE c.kb_id = ${p.kbId} AND c.content_tsv @@ q.query
    -- ts_rank ties are common (same terms, similar length); break them by
    -- position so rankings, and eval numbers, are reproducible run to run.
    ORDER BY score DESC, d.filename, c.chunk_index
    LIMIT ${limit}`);
  return res.rows;
}
