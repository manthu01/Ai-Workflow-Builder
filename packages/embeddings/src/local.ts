import { checkDimensions, type EmbedKind, type EmbeddingProvider } from "./provider.js";

/**
 * BGE v1.5 models are trained to prefix retrieval queries (not passages) with
 * this instruction; it improves short-query-to-passage matching.
 */
const BGE_QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: ";

/** Inputs per forward pass; bounds memory on large documents. */
const LOCAL_BATCH = 32;

type Extractor = (
  texts: string[],
  opts: { pooling: "cls" | "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/**
 * A small embedding model run in-process with ONNX Runtime. No API key and no
 * per-call network traffic: the weights (~130 MB fp32 for bge-small) download
 * once on first use into the transformers.js cache, then everything is local.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  private readonly model: string;
  private extractor?: Promise<Extractor>;

  constructor(opts: { model: string; dimensions: number }) {
    this.model = opts.model;
    this.dimensions = opts.dimensions;
    this.id = `local:${opts.model}`;
  }

  async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    const extract = await this.load();
    const isBge = /bge-/i.test(this.model);
    const inputs =
      kind === "query" && isBge ? texts.map((t) => BGE_QUERY_INSTRUCTION + t) : texts;

    const out: number[][] = [];
    for (let i = 0; i < inputs.length; i += LOCAL_BATCH) {
      // BGE uses the [CLS] token as the sentence embedding; most other
      // sentence-transformers models (e.g. MiniLM) use mean pooling.
      const tensor = await extract(inputs.slice(i, i + LOCAL_BATCH), {
        pooling: isBge ? "cls" : "mean",
        normalize: true,
      });
      out.push(...tensor.tolist());
    }
    return checkDimensions(out, this.dimensions, this.id);
  }

  /** Loads the model once, lazily, so voyage mode never pulls in ONNX Runtime. */
  private load(): Promise<Extractor> {
    this.extractor ??= import("@huggingface/transformers").then(
      ({ pipeline }) =>
        pipeline("feature-extraction", this.model, { dtype: "fp32" }) as unknown as Promise<Extractor>,
    );
    // A failed load (e.g. offline on first use) shouldn't be cached forever.
    this.extractor.catch(() => (this.extractor = undefined));
    return this.extractor;
  }
}
