import {
  WorkflowGraphSchema,
  validateGraph,
  routeCompilerTier,
  resolveModel,
  type WorkflowGraph,
  type GraphIssue,
  type ModelTier,
} from "@awb/core";
import type { CompilerGraph } from "./schema.js";
import { autoLayout } from "./layout.js";
import { env, tierModels } from "../env.js";
import { desc, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import {
  ZERO_USAGE,
  addUsage,
  type CompilerKnowledgeBase,
  type TokenUsage,
  type WorkflowCompilerProvider,
} from "../llm/provider.js";
import { StubCompilerProvider } from "../llm/stub.js";
import { AnthropicCompilerProvider } from "../llm/anthropic.js";

/** A compact summary of ingested API blueprints for the compiler prompt. */
async function blueprintContext(): Promise<string> {
  const rows = await db.select().from(schema.apiBlueprints).catch(() => []);
  if (rows.length === 0) return "";
  const lines = rows.flatMap((b) =>
    b.operations
      .slice(0, 40)
      .map(
        (o) =>
          `  - blueprint "${b.id}" op "${o.operationId}": ${o.method} ${o.path} — ${o.summary || "(no summary)"} [params: ${o.params.map((p) => p.name).join(", ") || "none"}]`,
      ),
  );
  return `\n\nINGESTED API BLUEPRINTS (use an "api_call" node with blueprintId + operationId + args when one fits):\n${lines.join("\n")}`;
}

/** Knowledge bases with at least one indexed document; empty ones can't answer anything. */
async function listSearchableKbs(): Promise<CompilerKnowledgeBase[]> {
  return db
    .select({
      id: schema.knowledgeBases.id,
      name: schema.knowledgeBases.name,
      description: schema.knowledgeBases.description,
    })
    .from(schema.knowledgeBases)
    .where(
      sql`EXISTS (SELECT 1 FROM kb_documents d WHERE d.kb_id = "knowledge_bases"."id" AND d.status = 'ready')`,
    )
    .orderBy(desc(schema.knowledgeBases.createdAt))
    .limit(30)
    .catch(() => []);
}

/** The same compact listing blueprints get: enough to pick a kbId, nothing more. */
function knowledgeBaseContext(kbs: CompilerKnowledgeBase[]): string {
  if (kbs.length === 0) return "";
  const lines = kbs.map(
    (kb) => `  - kb "${kb.id}": ${kb.name}${kb.description ? ` — ${kb.description}` : ""}`,
  );
  return `\n\nKNOWLEDGE BASES (use a "retrieve" node with one of these kbIds when the request should answer from documents):\n${lines.join("\n")}`;
}

export class CompileError extends Error {
  constructor(
    message: string,
    readonly issues: GraphIssue[],
    readonly draft?: WorkflowGraph,
    readonly attempts = 0,
    readonly usage: TokenUsage = ZERO_USAGE,
    readonly routing?: CompileResult["routing"],
  ) {
    super(message);
    this.name = "CompileError";
  }
}

let cached: WorkflowCompilerProvider | undefined;
const stubProvider = new StubCompilerProvider();

export function getCompilerProvider(): WorkflowCompilerProvider {
  if (cached) return cached;
  if (env.COMPILER_MODE === "claude") {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error(
        "COMPILER_MODE=claude but ANTHROPIC_API_KEY is not set. Set the key or use COMPILER_MODE=stub.",
      );
    }
    cached = new AnthropicCompilerProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.COMPILER_MODEL,
    });
  } else {
    cached = new StubCompilerProvider();
  }
  return cached;
}

function toWorkflowGraph(draft: CompilerGraph): WorkflowGraph {
  return WorkflowGraphSchema.parse({
    name: draft.name,
    description: draft.description || undefined,
    nodes: draft.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      config: n.config,
      position: { x: 0, y: 0 },
    })),
    edges: draft.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? "",
    })),
  });
}

export interface CompileResult {
  graph: WorkflowGraph;
  provider: string;
  warnings: GraphIssue[];
  attempts: number;
  routing: { tier: ModelTier; model: string; reasons: string[] };
  /** Summed over every attempt, including failed ones. Zero for the stub. */
  usage: TokenUsage;
}

export interface CompileOptions {
  /** 1 disables the validation-feedback repair retry. Default 2. */
  maxAttempts?: number;
  /** Skip the router and use this tier's model. */
  tier?: ModelTier;
  /** Skip the router and use this exact model (wins over `tier` and COMPILER_MODEL). */
  model?: string;
  /** Use the offline stub whatever COMPILER_MODE says (demo mode past its daily cap). */
  stub?: boolean;
}

/**
 * Compile a natural-language request into a validated, laid-out workflow graph.
 * Routes the request to a model tier by complexity, then retries once with the
 * validation errors fed back to the provider.
 */
export async function compileWorkflow(
  request: string,
  opts: CompileOptions = {},
): Promise<CompileResult> {
  const provider = opts.stub ? stubProvider : getCompilerProvider();
  const routed = routeCompilerTier(request);
  const route = opts.tier
    ? { tier: opts.tier, reasons: [`forced ${opts.tier} tier`] }
    : routed;
  const model =
    opts.model ||
    (opts.tier ? tierModels[opts.tier] : env.COMPILER_MODEL) ||
    resolveModel(route.tier, undefined, tierModels);

  const knowledgeBases = await listSearchableKbs();
  const extraContext = (await blueprintContext()) + knowledgeBaseContext(knowledgeBases);

  const maxAttempts = opts.maxAttempts ?? 2;
  let priorIssues: string[] | undefined;
  let lastGraph: WorkflowGraph | undefined;
  let lastErrors: GraphIssue[] = [];
  let usage = ZERO_USAGE;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { graph: draft, usage: callUsage } = await provider.generate(request, {
      priorIssues,
      model,
      extraContext,
      knowledgeBases,
    });
    if (callUsage) usage = addUsage(usage, callUsage);
    let graph: WorkflowGraph;
    try {
      graph = autoLayout(toWorkflowGraph(draft));
    } catch (err) {
      lastErrors = [{ level: "error", message: (err as Error).message }];
      priorIssues = lastErrors.map((i) => i.message);
      continue;
    }

    const issues = validateGraph(graph);
    const errors = issues.filter((i) => i.level === "error");
    lastGraph = graph;
    lastErrors = errors;

    if (errors.length === 0) {
      return {
        graph,
        provider: provider.name,
        warnings: issues.filter((i) => i.level === "warning"),
        attempts: attempt,
        routing: { tier: route.tier, model, reasons: route.reasons },
        usage,
      };
    }
    priorIssues = errors.map((i) => (i.nodeId ? `[${i.nodeId}] ${i.message}` : i.message));
  }

  throw new CompileError(
    `could not compile a valid workflow after ${maxAttempts} attempts`,
    lastErrors,
    lastGraph,
    maxAttempts,
    usage,
    { tier: route.tier, model, reasons: route.reasons },
  );
}
