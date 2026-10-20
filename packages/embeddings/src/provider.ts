/**
 * Queries and documents are embedded differently by retrieval-tuned models
 * (Voyage's input_type, BGE's query instruction), so callers always say which.
 */
export type EmbedKind = "document" | "query";

/**
 * Anything that turns text into vectors. Swapping providers (local model,
 * Voyage) only touches this seam - the same shape as the compiler's
 * WorkflowCompilerProvider.
 */
export interface EmbeddingProvider {
  /** Stored on each knowledge base, e.g. "local:Xenova/bge-small-en-v1.5". */
  readonly id: string;
  readonly dimensions: number;
  /** Returns one vector per input, in input order. */
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
}

/**
 * Compact wire format for a vector: base64 of its float32 bytes (~2 KB for 384
 * dims vs ~4 KB as JSON numbers). Used to keep Temporal payloads small.
 */
export function encodeVector(v: number[]): string {
  return Buffer.from(new Float32Array(v).buffer).toString("base64");
}

export function decodeVector(s: string): number[] {
  const bytes = Buffer.from(s, "base64");
  // Copy out: Buffer.from may return a pooled, non-4-byte-aligned view.
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return Array.from(new Float32Array(copy));
}

/** Throws if any vector's width doesn't match what the provider promised. */
export function checkDimensions(
  vectors: number[][],
  expected: number,
  providerId: string,
): number[][] {
  const bad = vectors.find((v) => v.length !== expected);
  if (bad) {
    throw new Error(
      `${providerId} returned ${bad.length}-dim vectors but ${expected} were expected ` +
        `(check EMBEDDING_DIMENSIONS)`,
    );
  }
  return vectors;
}
