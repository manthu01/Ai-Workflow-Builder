/**
 * Compiler evaluation: compiles every case in eval/compiler-cases.json under
 * several configurations, scores each graph with eval/score.ts, and writes
 * eval/results/<timestamp>.json (raw) and eval/compiler-results.md (tables).
 *
 *   npm run eval:compiler -w apps/api                     (all four configs, 3 repeats)
 *   npm run eval:compiler -w apps/api -- --repeats 1      (cheap run while developing)
 *   npm run eval:compiler -w apps/api -- --routed         (router only)
 *   npm run eval:compiler -w apps/api -- --model claude-sonnet-5-5
 *
 * Flags: --repeats N (default 3; LLMs are non-deterministic), --concurrency N
 * (default 4), --cases id1,id2 or --bucket name (subset), --budget USD (default
 * 5; stops starting new compiles once spend passes it).
 *
 * Needs Postgres (the compiler reads knowledge bases and API blueprints) and,
 * for real numbers, COMPILER_MODE=claude with ANTHROPIC_API_KEY. With the stub
 * compiler it still runs end to end, which is useful for checking the harness.
 *
 * (The report is compiler-results.md rather than RESULTS.md because Windows
 * treats RESULTS.md and the retrieval eval's results.md as the same file.)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compileWorkflow, CompileError, type CompileResult } from "../src/compiler/compile.js";
import { env, tierModels } from "../src/env.js";
import { ZERO_USAGE } from "../src/llm/provider.js";
import { scoreCompile, type CompileOutcome, type CompilerCase } from "../eval/score.js";
import { costOf, renderReport, type EvalConfig, type EvalRecord, type EvalRun } from "../eval/report.js";

const CASES = fileURLToPath(new URL("../eval/compiler-cases.json", import.meta.url));
const RESULTS_DIR = fileURLToPath(new URL("../eval/results/", import.meta.url));
const REPORT = fileURLToPath(new URL("../eval/compiler-results.md", import.meta.url));

/**
 * USD per million tokens, from Anthropic's pricing (as of PRICES_AS_OF). Cache
 * writes are the 5-minute TTL rate (1.25x input); the compiler caches its
 * system prompt. Haiku 5.5 is the <=100K-token prompt rate.
 */
const PRICES_AS_OF = "2026-10-06";
const PRICES: EvalRun["prices"] = {
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

const DEFAULT_CONFIGS: EvalConfig[] = [
  { name: "routed", description: "complexity router picks the tier (default behaviour)" },
  { name: "fast", description: "always the fast tier", tier: "fast" },
  { name: "balanced", description: "always the balanced tier", tier: "balanced" },
  { name: "routed-no-repair", description: "router, repair retry disabled", maxAttempts: 1 },
];

function parseArgs(argv: string[]) {
  const args = {
    repeats: 3,
    concurrency: 4,
    budget: 5,
    configs: DEFAULT_CONFIGS,
    cases: undefined as string[] | undefined,
    bucket: undefined as string | undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    const positive = (v: string) => {
      const n = Number(v);
      if (!(n > 0)) throw new Error(`${flag} must be a positive number, got "${v}"`);
      return n;
    };
    switch (flag) {
      case "--repeats": args.repeats = Math.floor(positive(value())); break;
      case "--concurrency": args.concurrency = Math.floor(positive(value())); break;
      case "--budget": args.budget = positive(value()); break;
      case "--routed": args.configs = [DEFAULT_CONFIGS[0]!]; break;
      case "--model": {
        const model = value();
        args.configs = [{ name: model, description: `always \`${model}\``, model }];
        break;
      }
      case "--cases": args.cases = value().split(","); break;
      case "--bucket": args.bucket = value(); break;
      default: throw new Error(`unknown flag ${flag}`);
    }
  }
  return args;
}

/** Anthropic SDK errors carry an HTTP status; auth and permission failures will fail every compile. */
function isFatal(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 401 || status === 403;
}

async function runOne(c: CompilerCase, config: EvalConfig, repeat: number): Promise<EvalRecord> {
  const started = performance.now();
  let outcome: CompileOutcome;
  let routing: CompileResult["routing"] | undefined;
  try {
    const result = await compileWorkflow(c.prompt, {
      tier: config.tier,
      model: config.model,
      maxAttempts: config.maxAttempts,
    });
    routing = result.routing;
    outcome = {
      ok: true,
      graph: result.graph,
      attempts: result.attempts,
      latencyMs: performance.now() - started,
      usage: result.usage,
    };
  } catch (err) {
    if (isFatal(err)) throw err;
    const compileErr = err instanceof CompileError ? err : undefined;
    routing = compileErr?.routing;
    outcome = {
      ok: false,
      error: (err as Error).message,
      attempts: compileErr?.attempts ?? 1,
      latencyMs: performance.now() - started,
      // A provider error (refusal, bad JSON) loses that call's usage; CompileError keeps it.
      usage: compileErr?.usage ?? ZERO_USAGE,
    };
  }
  const score = scoreCompile(c, outcome);
  const model = routing?.model ?? null;
  return {
    ...score,
    config: config.name,
    repeat,
    model,
    tier: routing?.tier ?? null,
    routingReasons: routing?.reasons ?? [],
    costUsd: env.COMPILER_MODE === "claude" ? costOf(score.usage, PRICES[model ?? ""]) : 0,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (env.COMPILER_MODEL) {
    throw new Error(
      `COMPILER_MODEL=${env.COMPILER_MODEL} is set, which would override the router in the "routed" configs. Unset it for the eval (use --model to force one model).`,
    );
  }
  const file = JSON.parse(await readFile(CASES, "utf8")) as { status?: string; cases: CompilerCase[] };
  let cases = file.cases;
  if (args.cases) cases = cases.filter((c) => args.cases!.includes(c.id));
  if (args.bucket) cases = cases.filter((c) => c.bucket === args.bucket);
  if (cases.length === 0) throw new Error("no cases match the filter");

  if (env.COMPILER_MODE !== "claude") {
    console.warn("[eval] COMPILER_MODE is not 'claude': scoring the offline stub, not Claude. Costs are $0.");
  }
  const unpriced = [...new Set([...Object.values(tierModels), ...args.configs.flatMap((c) => c.model ?? [])])]
    .filter((m) => !PRICES[m]);
  if (env.COMPILER_MODE === "claude" && unpriced.length) {
    console.warn(`[eval] no price for ${unpriced.join(", ")}: their cost shows as n/a and doesn't count toward --budget. Add them to PRICES.`);
  }
  const jobs = args.configs.flatMap((config) =>
    cases.flatMap((c) => Array.from({ length: args.repeats }, (_, r) => ({ c, config, repeat: r + 1 }))),
  );
  console.log(
    `[eval] ${cases.length} cases x ${args.repeats} repeats x ${args.configs.length} configs = ${jobs.length} compiles, concurrency ${args.concurrency}, budget $${args.budget}`,
  );

  const startedAt = new Date().toISOString();
  const records: EvalRecord[] = [];
  let spent = 0;
  let stoppedEarly: string | undefined;
  let next = 0;

  async function worker() {
    while (next < jobs.length && !stoppedEarly) {
      if (spent >= args.budget) {
        stoppedEarly = `spend reached the $${args.budget} budget after ${records.length} of ${jobs.length} compiles`;
        break;
      }
      const job = jobs[next++]!;
      const record = await runOne(job.c, job.config, job.repeat);
      records.push(record);
      spent += record.costUsd ?? 0;
      const mark = record.structuralMatch ? "ok  " : "MISS";
      console.log(
        `[${String(records.length).padStart(4)}/${jobs.length}] ${mark} ${job.config.name.padEnd(16)} ${job.c.id.padEnd(12)} #${job.repeat} ${record.model ?? "?"} a=${record.attempts} ${Math.round(record.latencyMs)}ms $${(record.costUsd ?? 0).toFixed(4)}${record.failures.length ? `  ${record.failures[0]}` : ""}`,
      );
    }
  }
  await Promise.all(Array.from({ length: Math.min(args.concurrency, jobs.length) }, worker));

  // Workers finish out of order; sort so the raw file diffs cleanly between runs.
  const order = new Map(jobs.map((j, i) => [`${j.config.name}|${j.c.id}|${j.repeat}`, i]));
  records.sort((a, b) => order.get(`${a.config}|${a.caseId}|${a.repeat}`)! - order.get(`${b.config}|${b.caseId}|${b.repeat}`)!);

  const run: EvalRun = {
    startedAt,
    finishedAt: new Date().toISOString(),
    compilerMode: env.COMPILER_MODE,
    casesStatus: file.status ?? "final",
    caseCount: cases.length,
    repeats: args.repeats,
    tierModels,
    prices: PRICES,
    pricesAsOf: PRICES_AS_OF,
    configs: args.configs,
    records,
    totalCostUsd: spent,
    stoppedEarly,
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  const rawPath = `${RESULTS_DIR}${run.startedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(rawPath, JSON.stringify(run, null, 2) + "\n");
  await writeFile(REPORT, renderReport(run));
  console.log(`[eval] total cost $${spent.toFixed(4)}`);
  console.log(`[eval] wrote ${rawPath}`);
  console.log(`[eval] wrote ${REPORT}`);
  if (stoppedEarly) console.warn(`[eval] stopped early: ${stoppedEarly}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[eval] failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
