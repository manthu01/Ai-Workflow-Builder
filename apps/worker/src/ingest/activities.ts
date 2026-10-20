import { createHash } from "node:crypto";
import { ApplicationFailure } from "@temporalio/activity";
import { chunkDocument, type Chunk, type ChunkSourcePage } from "@awb/core";
import { encodeVector } from "@awb/embeddings";
import { env } from "../env.js";
import { resolveConnection } from "../connections.js";
import { getEmbedder } from "../embeddings.js";
import { normalizeMime, parseBytes } from "./parse.js";

/**
 * Upper bound on a document's extracted text. Chunks and their vectors travel
 * between activities as Temporal payloads (2 MB limit each); 500K chars keeps
 * the final storeChunks payload around 1.3 MB.
 */
const MAX_DOCUMENT_CHARS = 500_000;
const MAX_URL_BYTES = 10 * 1024 * 1024;

async function internal<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${env.AWB_API_URL}/api/kbs/internal${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "x-internal-token": env.INTERNAL_TOKEN,
      ...(init?.body !== undefined && { "content-type": "application/json" }),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const msg = `kb api ${path}: ${body.error ?? res.status}`;
    // 4xx means the request itself is wrong (deleted doc, model mismatch); retrying won't help.
    if (res.status >= 400 && res.status < 500) throw ApplicationFailure.nonRetryable(msg);
    throw new Error(msg);
  }
  return body;
}

export async function markDocumentStatus(p: {
  documentId: string;
  status: "indexing" | "failed";
  error?: string;
}): Promise<void> {
  await internal(`/documents/${p.documentId}/status`, {
    method: "POST",
    body: { status: p.status, error: p.error },
  });
}

/** Step 1: fetch the document (stored upload or remote URL) and extract text pages. */
export async function parseDocument(p: { documentId: string }): Promise<ChunkSourcePage[]> {
  const src = await internal<{
    mimeType: string;
    sourceUrl: string | null;
    dataBase64: string | null;
    connectionId: string | null;
  }>(`/documents/${p.documentId}/source`);

  let bytes: Uint8Array;
  let mimeType = src.mimeType;
  if (src.dataBase64 !== null) {
    bytes = Buffer.from(src.dataBase64, "base64");
  } else if (src.sourceUrl) {
    const headers: Record<string, string> = {
      accept: "text/html,application/pdf,text/plain;q=0.9,*/*;q=0.5",
    };
    if (src.connectionId) {
      // The KB's vault connection (e.g. a bearer token for an intranet wiki).
      // The secret is resolved here and lives only in this activity's memory.
      const conn = await resolveConnection(src.connectionId);
      if (conn.kind !== "http_header") {
        throw ApplicationFailure.nonRetryable("URL auth connection must be of kind http_header");
      }
      headers[conn.secret.headerName] = conn.secret.headerValue;
    }
    const res = await fetch(src.sourceUrl, { signal: AbortSignal.timeout(20_000), headers });
    if (!res.ok) {
      const msg = `fetching ${src.sourceUrl} failed: HTTP ${res.status}`;
      throw res.status >= 500 ? new Error(msg) : ApplicationFailure.nonRetryable(msg);
    }
    const fetchedMime = normalizeMime(res.headers.get("content-type"));
    if (!fetchedMime) {
      throw ApplicationFailure.nonRetryable(`unsupported content-type ${res.headers.get("content-type")}`);
    }
    mimeType = fetchedMime;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_URL_BYTES) throw ApplicationFailure.nonRetryable("page is larger than 10 MB");
    bytes = new Uint8Array(buf);
  } else {
    throw ApplicationFailure.nonRetryable("document has neither stored content nor a URL");
  }

  let pages: ChunkSourcePage[];
  try {
    pages = await parseBytes(bytes, mimeType);
  } catch (err) {
    throw ApplicationFailure.nonRetryable(`could not parse ${mimeType}: ${(err as Error).message}`);
  }
  const chars = pages.reduce((n, pg) => n + pg.text.length, 0);
  if (chars === 0) {
    throw ApplicationFailure.nonRetryable(
      "no extractable text (a scanned PDF needs OCR, which isn't supported)",
    );
  }
  if (chars > MAX_DOCUMENT_CHARS) {
    throw ApplicationFailure.nonRetryable(
      `document has ${chars.toLocaleString()} characters of text; the limit is ${MAX_DOCUMENT_CHARS.toLocaleString()}`,
    );
  }
  return pages;
}

export type HashedChunk = Chunk & { contentHash: string };

/**
 * Step 2: split into ~500-token overlapping chunks (packages/core/src/chunk.ts),
 * each with a sha256 of its content for incremental re-indexing.
 */
export async function chunkPages(p: { pages: ChunkSourcePage[] }): Promise<HashedChunk[]> {
  return chunkDocument(p.pages).map((c) => ({
    ...c,
    contentHash: createHash("sha256").update(c.content).digest("hex"),
  }));
}

/**
 * Step 2b: embeddings this KB already has for any of these content hashes.
 * Re-indexing an edited document, or re-uploading a file, then only embeds the
 * chunks whose text actually changed. Safe because every chunk in a KB was
 * embedded with the same model.
 */
export async function findReusableVectors(p: {
  documentId: string;
  hashes: string[];
}): Promise<{ embeddingModel: string; vectors: Record<string, string> }> {
  return internal(`/documents/${p.documentId}/vectors`, {
    method: "POST",
    body: { hashes: [...new Set(p.hashes)] },
  });
}

/** Step 3: embed one batch. Each batch is its own activity, so a failure retries only that batch. */
export async function embedChunkBatch(p: {
  texts: string[];
}): Promise<{ embeddingModel: string; vectors: string[] }> {
  const embedder = getEmbedder();
  const vectors = await embedder.embed(p.texts, "document");
  return { embeddingModel: embedder.id, vectors: vectors.map(encodeVector) };
}

/** Step 4: write all chunks in one transaction and mark the document ready. */
export async function storeChunks(p: {
  documentId: string;
  embeddingModel: string;
  chunks: HashedChunk[];
  vectors: string[];
  reusedCount: number;
}): Promise<number> {
  const { chunkCount } = await internal<{ chunkCount: number }>(
    `/documents/${p.documentId}/chunks`,
    {
      method: "POST",
      body: {
        embeddingModel: p.embeddingModel,
        reusedCount: p.reusedCount,
        chunks: p.chunks.map((ch, i) => ({ ...ch, vector: p.vectors[i] })),
      },
    },
  );
  return chunkCount;
}
