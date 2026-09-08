import type { CompilerGraph } from "../compiler/schema.js";

export interface CompileAttemptContext {
  /** Validation issues from a previous attempt, for a repair round-trip. */
  priorIssues?: string[];
  /** Model id to use for this attempt (chosen by the complexity router). */
  model?: string;
  /** Extra context (e.g. ingested API blueprints) appended for the model only. */
  extraContext?: string;
}

/**
 * Anything that can turn a natural-language request (plus optional repair
 * feedback) into a compiler graph. Swapping providers (Claude, a stub, later
 * OpenAI) only touches this seam.
 */
export interface WorkflowCompilerProvider {
  readonly name: string;
  generate(request: string, ctx?: CompileAttemptContext): Promise<CompilerGraph>;
}
