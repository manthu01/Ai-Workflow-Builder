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
import type { WorkflowCompilerProvider } from "../llm/provider.js";
import { StubCompilerProvider } from "../llm/stub.js";
import { AnthropicCompilerProvider } from "../llm/anthropic.js";

export class CompileError extends Error {
  constructor(
    message: string,
    readonly issues: GraphIssue[],
    readonly draft?: WorkflowGraph,
  ) {
    super(message);
    this.name = "CompileError";
  }
}

let cached: WorkflowCompilerProvider | undefined;

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
}

/**
 * Compile a natural-language request into a validated, laid-out workflow graph.
 * Routes the request to a model tier by complexity, then retries once with the
 * validation errors fed back to the provider.
 */
export async function compileWorkflow(request: string): Promise<CompileResult> {
  const provider = getCompilerProvider();
  const route = routeCompilerTier(request);
  const model =
    env.COMPILER_MODEL || resolveModel(route.tier, undefined, tierModels);

  const maxAttempts = 2;
  let priorIssues: string[] | undefined;
  let lastGraph: WorkflowGraph | undefined;
  let lastErrors: GraphIssue[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const draft = await provider.generate(request, { priorIssues, model });
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
      };
    }
    priorIssues = errors.map((i) => (i.nodeId ? `[${i.nodeId}] ${i.message}` : i.message));
  }

  throw new CompileError(
    `could not compile a valid workflow after ${maxAttempts} attempts`,
    lastErrors,
    lastGraph,
  );
}
