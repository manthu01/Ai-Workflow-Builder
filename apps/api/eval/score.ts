/**
 * Scoring for the compiler eval (apps/api/eval/compiler-cases.json). Pure
 * functions only: the runner (scripts/eval-compiler.ts) compiles, times and
 * counts tokens, then hands each outcome here.
 *
 * Cases state structural expectations rather than one gold graph, because many
 * different graphs are correct for the same request. See the "description" in
 * compiler-cases.json for what each rule means.
 */
import { topologicalOrder, validateGraph, type WorkflowGraph } from "@awb/core";
import type { TokenUsage } from "../src/llm/provider.js";

export type Range = { min?: number; max?: number };

export interface CaseExpect {
  requiredKinds?: string[];
  requiredAnyOf?: string[][];
  forbiddenKinds?: string[];
  mustPrecede?: [string, string][];
  parallel?: [string, string][];
  minKindCount?: Record<string, number>;
  branchCount?: number | Range;
  nodeCount?: Range;
  triggerEvent?: "webhook" | "manual" | "schedule";
  acceptCompileError?: boolean;
}

export interface CompilerCase {
  id: string;
  bucket: string;
  prompt: string;
  expect: CaseExpect;
}

/** What the runner observed for one compile of one case. */
export type CompileOutcome = {
  attempts: number;
  latencyMs: number;
  usage: TokenUsage;
} & ({ ok: true; graph: WorkflowGraph } | { ok: false; error: string });

export interface CaseScore {
  caseId: string;
  bucket: string;
  /** Compiled, and validateGraph reports no errors (warnings are allowed, as in the app). */
  valid: boolean;
  /** Every expectation passed (or a CompileError on a case that accepts one). */
  structuralMatch: boolean;
  /** One message per failed expectation; empty on a match. */
  failures: string[];
  /** 1 = first try, 2 = saved by the repair retry. */
  attempts: number;
  latencyMs: number;
  usage: TokenUsage;
  error?: string;
}

/** Every node's transitive ancestors, built in topological order so each parent is done first. */
export function ancestorSets(graph: WorkflowGraph): Map<string, Set<string>> {
  const parents = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) parents.get(e.target)?.push(e.source);

  const ancestors = new Map<string, Set<string>>();
  for (const id of topologicalOrder(graph)) {
    const set = new Set<string>();
    for (const p of parents.get(id) ?? []) {
      set.add(p);
      for (const a of ancestors.get(p) ?? []) set.add(a);
    }
    ancestors.set(id, set);
  }
  return ancestors;
}

function inRange(n: number, r: number | Range): boolean {
  if (typeof r === "number") return n === r;
  return (r.min === undefined || n >= r.min) && (r.max === undefined || n <= r.max);
}

function describeRange(r: number | Range): string {
  if (typeof r === "number") return `exactly ${r}`;
  if (r.min !== undefined && r.max !== undefined) return `${r.min}-${r.max}`;
  return r.min !== undefined ? `at least ${r.min}` : `at most ${r.max}`;
}

/** Checks a compiled graph against a case's expectations. Returns one message per failure. */
export function checkExpectations(graph: WorkflowGraph, expect: CaseExpect): string[] {
  const failures: string[] = [];
  const kindCount = new Map<string, number>();
  for (const n of graph.nodes) kindCount.set(n.kind, (kindCount.get(n.kind) ?? 0) + 1);
  const has = (kind: string) => (kindCount.get(kind) ?? 0) > 0;
  const idsOf = (kind: string) => graph.nodes.filter((n) => n.kind === kind).map((n) => n.id);

  for (const kind of expect.requiredKinds ?? []) {
    if (!has(kind)) failures.push(`missing required kind "${kind}"`);
  }
  for (const group of expect.requiredAnyOf ?? []) {
    if (!group.some(has)) failures.push(`needs one of ${group.map((k) => `"${k}"`).join(" / ")}`);
  }
  for (const kind of expect.forbiddenKinds ?? []) {
    if (has(kind)) failures.push(`contains forbidden kind "${kind}"`);
  }
  for (const [kind, min] of Object.entries(expect.minKindCount ?? {})) {
    const n = kindCount.get(kind) ?? 0;
    if (n < min) failures.push(`expected at least ${min} "${kind}" nodes, got ${n}`);
  }
  if (expect.branchCount !== undefined) {
    const n = kindCount.get("branch") ?? 0;
    if (!inRange(n, expect.branchCount)) {
      failures.push(`expected ${describeRange(expect.branchCount)} branch nodes, got ${n}`);
    }
  }
  if (expect.nodeCount && !inRange(graph.nodes.length, expect.nodeCount)) {
    failures.push(`expected ${describeRange(expect.nodeCount)} nodes, got ${graph.nodes.length}`);
  }
  if (expect.triggerEvent) {
    const events = graph.nodes.filter((n) => n.kind === "trigger").map((n) => n.config.event);
    if (!events.includes(expect.triggerEvent)) {
      failures.push(`expected a "${expect.triggerEvent}" trigger, got ${events.map(String).join(", ") || "none"}`);
    }
  }

  if (!expect.mustPrecede?.length && !expect.parallel?.length) return failures;

  let ancestors: Map<string, Set<string>>;
  try {
    ancestors = ancestorSets(graph);
  } catch {
    failures.push("graph has a cycle, so ordering rules can't be checked");
    return failures;
  }
  const isAncestor = (a: string, b: string) => ancestors.get(b)?.has(a) ?? false;

  for (const [before, after] of expect.mustPrecede ?? []) {
    // Missing kinds are already reported by requiredKinds; nothing to order here.
    const afterIds = idsOf(after);
    const beforeIds = idsOf(before);
    if (afterIds.length === 0 || beforeIds.length === 0) continue;
    for (const b of afterIds) {
      if (!beforeIds.some((a) => isAncestor(a, b))) {
        failures.push(`"${after}" node "${b}" has no "${before}" upstream`);
      }
    }
  }

  for (const [kindA, kindB] of expect.parallel ?? []) {
    const found = idsOf(kindA).some((a) =>
      idsOf(kindB).some((b) => a !== b && !isAncestor(a, b) && !isAncestor(b, a)),
    );
    if (!found) failures.push(`no "${kindA}" and "${kindB}" nodes run in parallel`);
  }

  return failures;
}

/** Scores one compile of one case. */
export function scoreCompile(c: CompilerCase, outcome: CompileOutcome): CaseScore {
  const base = {
    caseId: c.id,
    bucket: c.bucket,
    attempts: outcome.attempts,
    latencyMs: outcome.latencyMs,
    usage: outcome.usage,
  };

  if (!outcome.ok) {
    const accepted = c.expect.acceptCompileError === true;
    return {
      ...base,
      valid: false,
      structuralMatch: accepted,
      failures: accepted ? [] : [`compile failed: ${outcome.error}`],
      error: outcome.error,
    };
  }

  const valid = !validateGraph(outcome.graph).some((i) => i.level === "error");
  const failures = checkExpectations(outcome.graph, c.expect);
  if (!valid) failures.unshift("graph does not pass validateGraph");
  return { ...base, valid, structuralMatch: failures.length === 0, failures };
}
