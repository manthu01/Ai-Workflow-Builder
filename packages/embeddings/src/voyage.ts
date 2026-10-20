import { checkDimensions, type EmbedKind, type EmbeddingProvider } from "./provider.js";

const ENDPOINT = "https://api.voyageai.com/v1/embeddings";

/** Voyage allows 1,000 inputs per request; stay well under it. */
const MAX_INPUTS_PER_REQUEST = 128;

/**
 * Voyage caps total tokens per request (120K-1M depending on the model). Using
 * a budget under the lowest cap, with a chars/4 estimate, keeps every model safe.
 */
const MAX_TOKENS_PER_REQUEST = 100_000;

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

interface VoyageResponse {
  data: { embedding: number[]; index: number }[];
}

/** Voyage AI embeddings (Anthropic's recommended embeddings partner). */
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts: { apiKey: string; model: string; dimensions: number }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.dimensions = opts.dimensions;
    this.id = `voyage:${opts.model}`;
  }

  async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    const out: number[][] = [];
    for (const batch of batchByBudget(texts)) {
      out.push(...(await this.request(batch, kind)));
    }
    return checkDimensions(out, this.dimensions, this.id);
  }

  private async request(input: string[], kind: EmbedKind): Promise<number[][]> {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        input,
        model: this.model,
        input_type: kind,
        output_dimension: this.dimensions,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`voyage embeddings failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const body = (await res.json()) as VoyageResponse;
    // `index` is each vector's input position; don't rely on response order.
    return [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

/** Splits inputs into requests that respect both the count and token caps. */
function* batchByBudget(texts: string[]): Generator<string[]> {
  let batch: string[] = [];
  let tokens = 0;
  for (const text of texts) {
    const t = estimateTokens(text);
    const full = batch.length >= MAX_INPUTS_PER_REQUEST || tokens + t > MAX_TOKENS_PER_REQUEST;
    if (batch.length && full) {
      yield batch;
      batch = [];
      tokens = 0;
    }
    batch.push(text);
    tokens += t;
  }
  if (batch.length) yield batch;
}
