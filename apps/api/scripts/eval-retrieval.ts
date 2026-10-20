/**
 * Retrieval evaluation: recall@5 and MRR@10 for every search mode x chunk size
 * over the sample knowledge base (apps/api/seed-kb), using the same chunker
 * and search code as the app.
 *
 *   npm run eval:retrieval            (from the repo root; needs Postgres)
 *
 * recall@5: the share of questions with at least one relevant chunk in the top
 *   5 - "did the answer reach the llm at all?" with the retrieve node's default.
 * recall@1: the same for the top 1 - stricter, and still informative when
 *   recall@5 saturates on a small corpus.
 * MRR@10: the mean of 1/rank of the first relevant chunk in the top 10 (0 if
 *   none) - rewards putting the answer first, not just somewhere in the top 5.
 *
 * Each mode runs as-is, and hybrid also runs with re-ranking (a cross-encoder
 * re-scores the candidates; RERANK_MODE picks local or Voyage).
 *
 * Two chunking strategies are compared: "headings" (the app's chunker, which
 * never spans a heading) and "flat" (headings ignored, so chunk size alone sets
 * the boundaries). Each strategy x size is indexed into its own throwaway KB
 * (kb_eval_<strategy>_<size>), so the real knowledge bases are untouched; they
 * are deleted when the run ends.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { eq, inArray } from "drizzle-orm";
import {
  chunkDocument,
  RETRIEVAL_MODES,
  type RetrievalMode,
  type RetrievedChunk,
} from "@awb/core";
import { db, schema } from "../src/db/client.js";
import { getEmbedder, getReranker } from "../src/embeddings.js";
import { newId } from "../src/id.js";
import { searchKb } from "../src/kb/search.js";

const SEED_DIR = fileURLToPath(new URL("../seed-kb/", import.meta.url));
const QUESTIONS = fileURLToPath(new URL("../eval/questions.json", import.meta.url));
const RESULTS = fileURLToPath(new URL("../eval/results.md", import.meta.url));

const CHUNK_SIZES = [300, 500, 800];
const STRATEGIES = ["headings", "flat"] as const;
type Strategy = (typeof STRATEGIES)[number];
/** Overlap scales with size (15%, the default's 75/500) so sizes are compared like for like. */
const overlapFor = (size: number) => Math.round(size * 0.15);
const RECALL_K = 5;
const MRR_K = 10;

interface Question {
  id: string;
  question: string;
  document: string;
  evidence: string;
}

interface QuestionResult {
  q: Question;
  /** 1-based rank of the first relevant chunk in the top MRR_K, or null. */
  rank: number | null;
  top: RetrievedChunk | undefined;
}

interface ConfigResult {
  strategy: Strategy;
  size: number;
  mode: RetrievalMode;
  rerank: boolean;
  chunks: number;
  /** Questions whose evidence no chunk contains (the chunker split it). */
  unanswerable: number;
  recall1: number;
  recall: number;
  mrr: number;
  msPerQuery: number;
  perQuestion: QuestionResult[];
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const isRelevant = (c: { document: string; content: string }, q: Question) =>
  c.document === q.document && norm(c.content).includes(norm(q.evidence));

async function loadQuestions(docs: Map<string, string>): Promise<Question[]> {
  const { questions } = JSON.parse(await readFile(QUESTIONS, "utf8")) as { questions: Question[] };
  // Fail fast on a stale label rather than quietly scoring it as a miss.
  const bad = questions.filter((q) => !norm(docs.get(q.document) ?? "").includes(norm(q.evidence)));
  if (bad.length) {
    throw new Error(`evidence not found in its document: ${bad.map((q) => q.id).join(", ")}`);
  }
  return questions;
}

/** Chunks + embeds every sample doc into a fresh KB for one chunk size. */
async function indexAtSize(strategy: Strategy, size: number, docs: Map<string, string>) {
  const kbId = `kb_eval_${strategy}_${size}`;
  const embedder = getEmbedder();
  await db.delete(schema.knowledgeBases).where(eq(schema.knowledgeBases.id, kbId));
  await db.insert(schema.knowledgeBases).values({
    id: kbId,
    name: `eval: ${strategy} chunking, size ${size}`,
    description: "temporary - created by scripts/eval-retrieval.ts",
    embeddingModel: embedder.id,
    dimensions: embedder.dimensions,
  });

  const all: { content: string; document: string }[] = [];
  for (const [filename, text] of docs) {
    const chunks = chunkDocument([{ text }], {
      targetTokens: size,
      overlapTokens: overlapFor(size),
      splitOnHeadings: strategy === "headings",
    });
    const vectors = await embedder.embed(chunks.map((c) => c.content), "document");
    const documentId = newId("doc");
    await db.insert(schema.kbDocuments).values({
      id: documentId,
      kbId,
      filename,
      mimeType: "text/markdown",
      status: "ready",
      chunkCount: chunks.length,
    });
    await db.insert(schema.kbChunks).values(
      chunks.map((c, i) => ({
        id: newId("chk"),
        kbId,
        documentId,
        chunkIndex: c.chunkIndex,
        content: c.content,
        tokenCount: c.tokenCount,
        embedding: vectors[i]!,
        metadata: c.metadata,
      })),
    );
    all.push(...chunks.map((c) => ({ content: c.content, document: filename })));
  }
  return { kbId, chunks: all };
}

async function evaluate(
  kbId: string,
  strategy: Strategy,
  size: number,
  mode: RetrievalMode,
  rerank: boolean,
  questions: Question[],
  chunks: { content: string; document: string }[],
): Promise<ConfigResult> {
  const perQuestion: QuestionResult[] = [];
  const started = Date.now();
  for (const q of questions) {
    const hits = await searchKb({ kbId, query: q.question, topK: MRR_K, mode, rerank });
    const idx = hits.findIndex((h) => isRelevant(h, q));
    perQuestion.push({ q, rank: idx === -1 ? null : idx + 1, top: hits[0] });
  }
  const n = questions.length;
  return {
    strategy,
    size,
    mode,
    rerank,
    chunks: chunks.length,
    unanswerable: questions.filter((q) => !chunks.some((c) => isRelevant(c, q))).length,
    recall1: perQuestion.filter((r) => r.rank === 1).length / n,
    recall: perQuestion.filter((r) => r.rank !== null && r.rank <= RECALL_K).length / n,
    mrr: perQuestion.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / n,
    msPerQuery: (Date.now() - started) / n,
    perQuestion,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const label = (r: { mode: RetrievalMode; rerank: boolean }) => (r.rerank ? `${r.mode}+rerank` : r.mode);

/** Every mode as-is, plus hybrid re-ranked. */
const CONFIGS: { mode: RetrievalMode; rerank: boolean }[] = [
  ...RETRIEVAL_MODES.map((mode) => ({ mode, rerank: false })),
  { mode: "hybrid", rerank: true },
];

function table(results: ConfigResult[], best: ConfigResult): string {
  const rows = results.map((r) => {
    const cells = [
      r.strategy,
      String(r.size),
      label(r),
      String(r.chunks),
      pct(r.recall1),
      pct(r.recall),
      r.mrr.toFixed(3),
      `${r.msPerQuery.toFixed(0)} ms`,
    ];
    return `| ${(r === best ? cells.map((c) => `**${c}**`) : cells).join(" | ")} |`;
  });
  return [
    `| chunking | chunk size | mode | chunks | recall@1 | recall@${RECALL_K} | MRR@${MRR_K} | latency |`,
    "|---|---:|---|---:|---:|---:|---:|---:|",
    ...rows,
  ].join("\n");
}

function report(
  results: ConfigResult[],
  best: ConfigResult,
  questions: Question[],
  embedderId: string,
  rerankerId: string,
): string {
  const misses = best.perQuestion.filter((r) => r.rank === null || r.rank > RECALL_K);
  const late = best.perQuestion.filter((r) => r.rank !== null && r.rank > 1 && r.rank <= RECALL_K);
  const modeAvg = (c: { mode: RetrievalMode; rerank: boolean }) => {
    const rs = results.filter((r) => r.mode === c.mode && r.rerank === c.rerank);
    return `${label(c)}: recall@1 ${pct(rs.reduce((s, r) => s + r.recall1, 0) / rs.length)}, recall@${RECALL_K} ${pct(rs.reduce((s, r) => s + r.recall, 0) / rs.length)}, MRR ${(rs.reduce((s, r) => s + r.mrr, 0) / rs.length).toFixed(3)}`;
  };
  const describe = (r: QuestionResult) =>
    `- **${r.q.id}** "${r.q.question}" (expected ${r.q.document}) - ${
      r.rank === null ? `not in top ${MRR_K}` : `rank ${r.rank}`
    }; top hit: ${r.top ? `${r.top.document}${r.top.heading ? ` > ${r.top.heading}` : ""}` : "none"}`;

  return `# Retrieval evaluation

Generated by \`npm run eval:retrieval\` on ${new Date().toISOString().slice(0, 10)}.

- Corpus: the sample knowledge base (\`apps/api/seed-kb\`, 5 Markdown documents)
- Questions: ${questions.length} (\`eval/questions.json\`)
- Embeddings: \`${embedderId}\`
- Re-ranker (\`+rerank\` rows): \`${rerankerId}\`, re-scoring the top 20+ candidates of each retriever
- Chunking: "headings" is the app's chunker (never spans a heading); "flat" ignores headings
- Chunk overlap: 15% of the chunk size
- A chunk is relevant when it comes from the labelled document and contains the labelled evidence phrase

## Results

${table(results, best)}

**Best: ${best.strategy} chunking, size ${best.size}, ${label(best)}** - recall@1 ${pct(best.recall1)}, recall@${RECALL_K} ${pct(best.recall)}, MRR@${MRR_K} ${best.mrr.toFixed(3)}.
Ranked by recall@${RECALL_K}, then MRR, then recall@1; ties go to the earlier row.

Averaged per mode over every chunking setting: ${CONFIGS.map(modeAvg).join("; ")}.

${results.some((r) => r.chunks <= RECALL_K) ? `Caution: ${results.filter((r) => r.chunks <= RECALL_K).map((r) => `${r.strategy}/${r.size}/${label(r)}`).join(", ")} produced ${RECALL_K} or fewer chunks, so their top ${RECALL_K} is the whole corpus and recall@${RECALL_K} is trivially 100%. Compare those rows on recall@1 and MRR instead.\n\n` : ""}${results.some((r) => r.unanswerable) ? `Some evidence phrases were split across chunks (no single chunk contains them): ${results.filter((r) => r.unanswerable).map((r) => `${r.strategy}/${r.size}/${label(r)}: ${r.unanswerable}`).join(", ")}.\n\n` : ""}## Best setting: misses and late hits

${misses.length ? `Not in the top ${RECALL_K}:\n\n${misses.map(describe).join("\n")}` : `Every question had a relevant chunk in the top ${RECALL_K}.`}

${late.length ? `In the top ${RECALL_K} but not first:\n\n${late.map(describe).join("\n")}` : ""}
`;
}

async function main() {
  const filenames = (await readdir(SEED_DIR)).filter((f) => f.endsWith(".md")).sort();
  const docs = new Map<string, string>();
  for (const f of filenames) docs.set(f, await readFile(SEED_DIR + f, "utf8"));
  const questions = await loadQuestions(docs);
  const embedder = getEmbedder();
  console.log(`[eval] ${questions.length} questions, ${docs.size} documents, ${embedder.id}`);

  const kbIds: string[] = [];
  const results: ConfigResult[] = [];
  try {
    for (const strategy of STRATEGIES) {
      for (const size of CHUNK_SIZES) {
        const { kbId, chunks } = await indexAtSize(strategy, size, docs);
        kbIds.push(kbId);
        for (const { mode, rerank } of CONFIGS) {
          const r = await evaluate(kbId, strategy, size, mode, rerank, questions, chunks);
          results.push(r);
          console.log(
            `[eval] ${strategy.padEnd(8)} ${size} ${label(r).padEnd(14)} recall@1 ${pct(r.recall1).padStart(6)}  recall@${RECALL_K} ${pct(r.recall).padStart(6)}  MRR ${r.mrr.toFixed(3)}  (${r.chunks} chunks)`,
          );
        }
      }
    }
  } finally {
    if (kbIds.length) await db.delete(schema.knowledgeBases).where(inArray(schema.knowledgeBases.id, kbIds));
  }

  const best = [...results].sort(
    (a, b) => b.recall - a.recall || b.mrr - a.mrr || b.recall1 - a.recall1,
  )[0]!;
  console.log(`\n${table(results, best)}\n`);
  await writeFile(RESULTS, report(results, best, questions, embedder.id, getReranker().id));
  console.log(`[eval] best: ${best.strategy} ${best.size} ${label(best)}; wrote eval/results.md`);
}

main()
  .catch((err) => {
    console.error("[eval] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
