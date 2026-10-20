import { eq, sql } from "drizzle-orm";
import { assertKbCompatible } from "@awb/embeddings";
import { db, schema } from "../db/client.js";
import { getEmbedder } from "../embeddings.js";

export type SearchMode = "vector" | "keyword";

export interface SearchParams {
  kbId: string;
  query: string;
  topK: number;
  mode: SearchMode;
  minScore?: number;
}

export interface RetrievedChunk {
  id: string;
  content: string;
  score: number;
  documentId: string;
  document: string;
  page?: number;
  heading?: string;
}

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

  const rows = p.mode === "vector" ? await vectorSearch(kb, p) : await keywordSearch(p);
  return rows
    .filter((r) => r.score >= (p.minScore ?? 0))
    .slice(0, p.topK)
    .map((r) => ({
      id: r.id,
      content: r.content,
      score: Number(r.score),
      documentId: r.document_id,
      document: r.filename,
      ...(r.metadata.page !== undefined && { page: r.metadata.page }),
      ...(r.metadata.heading !== undefined && { heading: r.metadata.heading }),
    }));
}

/**
 * Nearest neighbours by cosine distance (`<=>`), scored as similarity 1 - d.
 * Fetches 2x topK so a later fusion step has candidates to work with.
 *
 * The kb_id filter is applied after the HNSW scan, which on its own can return
 * fewer than LIMIT rows when other KBs crowd the nearest neighbours. pgvector
 * 0.8's iterative scan keeps searching until the limit is filled; relaxed
 * order means the outer query re-sorts by exact distance.
 */
async function vectorSearch(
  kb: typeof schema.knowledgeBases.$inferSelect,
  p: SearchParams,
): Promise<ChunkRow[]> {
  const embedder = getEmbedder();
  assertKbCompatible(kb, embedder);
  const [vec] = await embedder.embed([p.query], "query");
  const q = `[${vec!.join(",")}]`;

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL hnsw.iterative_scan = relaxed_order`);
    const res = await tx.execute<ChunkRow>(sql`
      SELECT * FROM (
        SELECT c.id, c.content, c.metadata, c.document_id, d.filename,
               1 - (c.embedding <=> ${q}::vector) AS score
        FROM kb_chunks c
        JOIN kb_documents d ON d.id = c.document_id
        WHERE c.kb_id = ${p.kbId}
        ORDER BY c.embedding <=> ${q}::vector
        LIMIT ${p.topK * 2}
      ) nearest
      ORDER BY score DESC`);
    return res.rows;
  });
}

/**
 * Full-text search ranked by ts_rank. plainto_tsquery ANDs every term, so a
 * natural question ("how many vacation days do I get") would only match
 * chunks containing all of them. Rewriting & to | ORs the terms instead, and
 * ts_rank still rewards chunks that match more of them.
 */
async function keywordSearch(p: SearchParams): Promise<ChunkRow[]> {
  const res = await db.execute<ChunkRow>(sql`
    SELECT c.id, c.content, c.metadata, c.document_id, d.filename,
           ts_rank(c.content_tsv, q.query) AS score
    FROM kb_chunks c
    JOIN kb_documents d ON d.id = c.document_id,
         to_tsquery('english', replace(plainto_tsquery('english', ${p.query})::text, '&', '|')) AS q(query)
    WHERE c.kb_id = ${p.kbId} AND c.content_tsv @@ q.query
    ORDER BY score DESC
    LIMIT ${p.topK * 2}`);
  return res.rows;
}
