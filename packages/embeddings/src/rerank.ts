/**
 * Re-ranking: a second pass over retrieval's candidates with a cross-encoder,
 * which reads the query and each passage together. Embeddings compare two
 * independently computed vectors, so they're fast enough for the whole corpus;
 * a cross-encoder is slower but more precise, so it only sees the shortlist.
 */
export interface RerankProvider {
  /** e.g. "local:Xenova/ms-marco-MiniLM-L-6-v2" */
  readonly id: string;
  /** One relevance score in 0-1 per document, in input order. */
  rerank(query: string, documents: string[]): Promise<number[]>;
}

export const DEFAULT_RERANK_MODELS = {
  local: "Xenova/ms-marco-MiniLM-L-6-v2",
  voyage: "rerank-3-lite",
} as const;

/** Query-passage pairs per forward pass. */
const LOCAL_BATCH = 16;

interface CrossEncoder {
  tokenizer: (
    texts: string[],
    opts: { text_pair: string[]; padding: boolean; truncation: boolean },
  ) => unknown;
  model: (inputs: unknown) => Promise<{ logits: { sigmoid(): { tolist(): number[][] } } }>;
}

/** A small MS MARCO cross-encoder run in-process; weights download once on first use. */
export class LocalRerankProvider implements RerankProvider {
  readonly id: string;
  private readonly modelName: string;
  private loaded?: Promise<CrossEncoder>;

  constructor(model: string) {
    this.modelName = model;
    this.id = `local:${model}`;
  }

  async rerank(query: string, documents: string[]): Promise<number[]> {
    const { tokenizer, model } = await this.load();
    const scores: number[] = [];
    for (let i = 0; i < documents.length; i += LOCAL_BATCH) {
      const batch = documents.slice(i, i + LOCAL_BATCH);
      const inputs = tokenizer(batch.map(() => query), {
        text_pair: batch,
        padding: true,
        truncation: true,
      });
      // One logit per pair; sigmoid maps it to a 0-1 relevance score.
      const { logits } = await model(inputs);
      scores.push(...logits.sigmoid().tolist().map((row) => row[0]!));
    }
    return scores;
  }

  private load(): Promise<CrossEncoder> {
    this.loaded ??= import("@huggingface/transformers").then(
      async ({ AutoTokenizer, AutoModelForSequenceClassification }) => {
        const [tokenizer, model] = await Promise.all([
          AutoTokenizer.from_pretrained(this.modelName),
          AutoModelForSequenceClassification.from_pretrained(this.modelName, { dtype: "fp32" }),
        ]);
        return { tokenizer, model } as unknown as CrossEncoder;
      },
    );
    this.loaded.catch(() => (this.loaded = undefined));
    return this.loaded;
  }
}

interface VoyageRerankResponse {
  data?: { index: number; relevance_score: number }[];
  results?: { index: number; relevance_score: number }[];
}

/** Voyage AI's rerank endpoint. */
export class VoyageRerankProvider implements RerankProvider {
  readonly id: string;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {
    this.id = `voyage:${model}`;
  }

  async rerank(query: string, documents: string[]): Promise<number[]> {
    if (documents.length === 0) return [];
    const res = await fetch("https://api.voyageai.com/v1/rerank", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ query, documents, model: this.model, truncation: true }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`voyage rerank failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const body = (await res.json()) as VoyageRerankResponse;
    const items = body.data ?? body.results ?? [];
    // Results come sorted by relevance; put the scores back in input order.
    const scores = new Array<number>(documents.length).fill(0);
    for (const item of items) scores[item.index] = item.relevance_score;
    return scores;
  }
}

export function createRerankProvider(s: {
  mode: "local" | "voyage";
  model?: string;
  voyageApiKey?: string;
}): RerankProvider {
  const model = s.model || DEFAULT_RERANK_MODELS[s.mode];
  if (s.mode === "voyage") {
    if (!s.voyageApiKey) throw new Error("RERANK_MODE=voyage needs VOYAGE_API_KEY (or use RERANK_MODE=local)");
    return new VoyageRerankProvider(s.voyageApiKey, model);
  }
  return new LocalRerankProvider(model);
}
