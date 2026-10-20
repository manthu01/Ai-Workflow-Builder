import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { RETRIEVAL_MODES } from "@awb/core";
import { decodeVector } from "@awb/embeddings";
import { db, schema } from "../db/client.js";
import { newId } from "../id.js";
import { env } from "../env.js";
import { getEmbedder } from "../embeddings.js";
import { searchKb, KbNotFoundError } from "../kb/search.js";
import { startIngestion } from "../kb/ingest.js";

export const knowledgeBaseRoutes = new Hono();

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Extension wins over the browser's type: browsers often send "" for .md. */
const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  html: "text/html",
  htm: "text/html",
};

// --- Internal (worker) endpoints. Registered first so "/internal/..." never
// matches a "/:id/..." route. ---

knowledgeBaseRoutes.use("/internal/*", async (c, next) => {
  if (c.req.header("x-internal-token") !== env.INTERNAL_TOKEN) {
    return c.json({ error: "forbidden" }, 403);
  }
  await next();
});

/** Internal: the raw document for the worker's parse activity. */
knowledgeBaseRoutes.get("/internal/documents/:docId/source", async (c) => {
  const [doc] = await db
    .select()
    .from(schema.kbDocuments)
    .where(eq(schema.kbDocuments.id, c.req.param("docId")));
  if (!doc) return c.json({ error: "document not found" }, 404);
  return c.json({
    filename: doc.filename,
    mimeType: doc.mimeType,
    sourceUrl: doc.sourceUrl,
    dataBase64: doc.source ? doc.source.toString("base64") : null,
  });
});

const StatusBody = z.object({
  status: z.enum(["indexing", "failed"]),
  error: z.string().optional(),
});

knowledgeBaseRoutes.post("/internal/documents/:docId/status", async (c) => {
  const parsed = StatusBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid status" }, 400);
  await db
    .update(schema.kbDocuments)
    .set({ status: parsed.data.status, error: parsed.data.error?.slice(0, 2000) ?? null })
    .where(eq(schema.kbDocuments.id, c.req.param("docId")));
  return c.json({ ok: true });
});

const ChunksBody = z.object({
  embeddingModel: z.string(),
  chunks: z.array(
    z.object({
      chunkIndex: z.number().int(),
      content: z.string(),
      tokenCount: z.number().int(),
      metadata: z.object({ page: z.number().optional(), heading: z.string().optional() }),
      vector: z.string(),
    }),
  ),
});

/**
 * Internal: replaces a document's chunks and marks it ready, in one
 * transaction - a reader never sees a half-indexed document, and a retried
 * activity can't duplicate chunks.
 */
knowledgeBaseRoutes.post("/internal/documents/:docId/chunks", async (c) => {
  const parsed = ChunksBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid chunks payload" }, 400);
  const docId = c.req.param("docId");

  const [doc] = await db
    .select({ kbId: schema.kbDocuments.kbId })
    .from(schema.kbDocuments)
    .where(eq(schema.kbDocuments.id, docId));
  if (!doc) return c.json({ error: "document not found (deleted during indexing?)" }, 404);
  const [kb] = await db
    .select()
    .from(schema.knowledgeBases)
    .where(eq(schema.knowledgeBases.id, doc.kbId));
  if (!kb) return c.json({ error: "knowledge base not found" }, 404);
  if (kb.embeddingModel !== parsed.data.embeddingModel) {
    return c.json(
      {
        error: `worker embedded with ${parsed.data.embeddingModel} but this KB uses ${kb.embeddingModel}; align EMBEDDINGS_MODE/EMBEDDING_MODEL across api and worker`,
      },
      409,
    );
  }

  const { chunks } = parsed.data;
  await db.transaction(async (tx) => {
    await tx.delete(schema.kbChunks).where(eq(schema.kbChunks.documentId, docId));
    // Batched so a large document doesn't exceed Postgres' bind-parameter limit.
    for (let i = 0; i < chunks.length; i += 200) {
      await tx.insert(schema.kbChunks).values(
        chunks.slice(i, i + 200).map((ch) => ({
          id: newId("chk"),
          kbId: doc.kbId,
          documentId: docId,
          chunkIndex: ch.chunkIndex,
          content: ch.content,
          tokenCount: ch.tokenCount,
          embedding: decodeVector(ch.vector),
          metadata: ch.metadata,
        })),
      );
    }
    await tx
      .update(schema.kbDocuments)
      .set({ status: "ready", error: null, chunkCount: chunks.length })
      .where(eq(schema.kbDocuments.id, docId));
  });
  return c.json({ ok: true, chunkCount: chunks.length });
});

/** Internal: the retrieve node's search (same code path as the UI test bench). */
knowledgeBaseRoutes.post("/internal/:kbId/search", async (c) => {
  const { status, body } = await runSearch(c.req.param("kbId"), await c.req.json().catch(() => ({})));
  return c.json(body, status);
});

// --- Public endpoints ---

knowledgeBaseRoutes.get("/", async (c) => {
  const rows = await db
    .select({
      id: schema.knowledgeBases.id,
      name: schema.knowledgeBases.name,
      description: schema.knowledgeBases.description,
      embeddingModel: schema.knowledgeBases.embeddingModel,
      dimensions: schema.knowledgeBases.dimensions,
      createdAt: schema.knowledgeBases.createdAt,
      // Spelled out: drizzle renders the column unqualified, which inside the
      // subquery would resolve to the inner table's own id.
      documentCount: sql<number>`(SELECT count(*)::int FROM kb_documents d WHERE d.kb_id = "knowledge_bases"."id")`,
      chunkCount: sql<number>`(SELECT count(*)::int FROM kb_chunks ch WHERE ch.kb_id = "knowledge_bases"."id")`,
    })
    .from(schema.knowledgeBases)
    .orderBy(desc(schema.knowledgeBases.createdAt));
  return c.json({ knowledgeBases: rows });
});

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).default(""),
});

knowledgeBaseRoutes.post("/", async (c) => {
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "name is required" }, 400);
  let embedder;
  try {
    embedder = getEmbedder();
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
  // The KB is pinned to today's embedder; see assertKbCompatible.
  const [row] = await db
    .insert(schema.knowledgeBases)
    .values({
      id: newId("kb"),
      name: parsed.data.name,
      description: parsed.data.description,
      embeddingModel: embedder.id,
      dimensions: embedder.dimensions,
    })
    .returning();
  return c.json({ knowledgeBase: row });
});

knowledgeBaseRoutes.delete("/:id", async (c) => {
  await db.delete(schema.knowledgeBases).where(eq(schema.knowledgeBases.id, c.req.param("id")));
  return c.body(null, 204);
});

/** Document rows without the (possibly large) source bytes. */
const documentColumns = {
  id: schema.kbDocuments.id,
  kbId: schema.kbDocuments.kbId,
  filename: schema.kbDocuments.filename,
  mimeType: schema.kbDocuments.mimeType,
  sourceUrl: schema.kbDocuments.sourceUrl,
  status: schema.kbDocuments.status,
  error: schema.kbDocuments.error,
  chunkCount: schema.kbDocuments.chunkCount,
  createdAt: schema.kbDocuments.createdAt,
};

knowledgeBaseRoutes.get("/:id/documents", async (c) => {
  const rows = await db
    .select(documentColumns)
    .from(schema.kbDocuments)
    .where(eq(schema.kbDocuments.kbId, c.req.param("id")))
    .orderBy(desc(schema.kbDocuments.createdAt));
  return c.json({ documents: rows });
});

const UrlBody = z.object({ url: z.string().url().refine((u) => /^https?:\/\//i.test(u)) });

/** Upload a file (multipart field "file") or register a URL, then start ingestion. */
knowledgeBaseRoutes.post("/:id/documents", async (c) => {
  const kbId = c.req.param("id");
  const [kb] = await db
    .select({ id: schema.knowledgeBases.id })
    .from(schema.knowledgeBases)
    .where(eq(schema.knowledgeBases.id, kbId));
  if (!kb) return c.json({ error: "knowledge base not found" }, 404);

  let values: typeof schema.kbDocuments.$inferInsert;
  const id = newId("doc");
  if ((c.req.header("content-type") ?? "").includes("multipart/form-data")) {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) return c.json({ error: 'multipart field "file" is required' }, 400);
    if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: "file is larger than 10 MB" }, 413);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const mimeType = MIME_BY_EXT[ext];
    if (!mimeType) {
      return c.json({ error: "unsupported file type (use .pdf, .md, .txt or .html)" }, 415);
    }
    values = {
      id,
      kbId,
      filename: file.name,
      mimeType,
      source: Buffer.from(await file.arrayBuffer()),
    };
  } else {
    const parsed = UrlBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "send a multipart file or { url }" }, 400);
    // The real type is known only once the worker fetches it.
    values = { id, kbId, filename: parsed.data.url, mimeType: "text/html", sourceUrl: parsed.data.url };
  }

  await db.insert(schema.kbDocuments).values(values);
  if (!(await startIngestion(kbId, id))) {
    return c.json({ error: "could not start ingestion (is Temporal running?)" }, 503);
  }

  const [row] = await db.select(documentColumns).from(schema.kbDocuments).where(eq(schema.kbDocuments.id, id));
  return c.json({ document: row }, 202);
});

/** Re-runs ingestion, e.g. after a failure or a chunker change. */
knowledgeBaseRoutes.post("/:id/documents/:docId/reindex", async (c) => {
  const [doc] = await db
    .select(documentColumns)
    .from(schema.kbDocuments)
    .where(
      and(
        eq(schema.kbDocuments.id, c.req.param("docId")),
        eq(schema.kbDocuments.kbId, c.req.param("id")),
      ),
    );
  if (!doc) return c.json({ error: "document not found" }, 404);
  if (doc.status === "pending" || doc.status === "indexing") {
    return c.json({ error: "document is already being indexed" }, 409);
  }
  if (!(await startIngestion(doc.kbId, doc.id))) {
    return c.json({ error: "could not start ingestion (is Temporal running?)" }, 503);
  }
  return c.json({ ok: true }, 202);
});

knowledgeBaseRoutes.delete("/:id/documents/:docId", async (c) => {
  await db
    .delete(schema.kbDocuments)
    .where(
      and(
        eq(schema.kbDocuments.id, c.req.param("docId")),
        eq(schema.kbDocuments.kbId, c.req.param("id")),
      ),
    );
  return c.body(null, 204);
});

const SearchBody = z.object({
  query: z.string().trim().min(1),
  topK: z.number().int().min(1).max(20).default(5),
  mode: z.enum(RETRIEVAL_MODES).default("hybrid"),
  minScore: z.number().min(0).max(1).default(0),
});

async function runSearch(kbId: string, raw: unknown) {
  const parsed = SearchBody.safeParse(raw);
  if (!parsed.success) {
    return { status: 400 as const, body: { error: parsed.error.issues[0]?.message ?? "invalid search" } };
  }
  try {
    const started = Date.now();
    const chunks = await searchKb({ kbId, ...parsed.data });
    return { status: 200 as const, body: { chunks, count: chunks.length, tookMs: Date.now() - started } };
  } catch (err) {
    if (err instanceof KbNotFoundError) return { status: 404 as const, body: { error: err.message } };
    return { status: 422 as const, body: { error: (err as Error).message } };
  }
}

/** Retrieval test bench for the UI. */
knowledgeBaseRoutes.post("/:id/search", async (c) => {
  const { status, body } = await runSearch(c.req.param("id"), await c.req.json().catch(() => ({})));
  return c.json(body, status);
});
