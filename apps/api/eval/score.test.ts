import { test } from "node:test";
import assert from "node:assert/strict";
import type { WorkflowGraph } from "@awb/core";
import { ZERO_USAGE } from "../src/llm/provider.js";
import { ancestorSets, checkExpectations, scoreCompile, type CompilerCase } from "./score.js";

const CONFIGS: Record<string, Record<string, unknown>> = {
  trigger: { event: "webhook" },
  llm: { prompt: "summarize {{ trigger }}" },
  http_request: { url: "https://example.com" },
  branch: { expression: "true" },
  slack_post: { channel: "#x", text: "hi" },
  approval: { message: "ok?" },
};

/** Builds a graph from "id:kind" nodes and "a>b" or "a>b:true" edges. */
function graph(nodes: string[], edges: string[]): WorkflowGraph {
  return {
    name: "t",
    nodes: nodes.map((spec) => {
      const [id, kind] = spec.split(":") as [string, string];
      return { id, kind: kind as never, label: id, config: { ...CONFIGS[kind] }, position: { x: 0, y: 0 } };
    }),
    edges: edges.map((spec, i) => {
      const [path, handle = ""] = spec.split(":") as [string, string?];
      const [source, target] = path.split(">") as [string, string];
      return { id: `e${i}`, source, target, sourceHandle: handle };
    }),
  };
}

// trigger -> llm -> branch -(true)-> slack, -(false)-> http
const branchy = graph(
  ["t:trigger", "l:llm", "b:branch", "s:slack_post", "h:http_request"],
  ["t>l", "l>b", "b>s:true", "b>h:false"],
);

const ok = (g: WorkflowGraph) => ({ ok: true as const, graph: g, attempts: 1, latencyMs: 10, usage: ZERO_USAGE });
const kase = (expect: CompilerCase["expect"]): CompilerCase => ({ id: "c", bucket: "b", prompt: "p", expect });

test("ancestors are transitive, not just direct parents", () => {
  const anc = ancestorSets(branchy);
  assert.deepEqual([...anc.get("s")!].sort(), ["b", "l", "t"]);
  assert.equal(anc.get("t")!.size, 0);
});

test("a graph meeting every expectation has no failures", () => {
  const failures = checkExpectations(branchy, {
    requiredKinds: ["trigger", "llm", "branch", "slack_post"],
    forbiddenKinds: ["local", "code"],
    mustPrecede: [["llm", "branch"], ["branch", "slack_post"], ["trigger", "http_request"]],
    branchCount: 1,
    nodeCount: { min: 4, max: 7 },
    triggerEvent: "webhook",
  });
  assert.deepEqual(failures, []);
});

test("mustPrecede needs an ancestor, not just an earlier array position", () => {
  // slack is declared after the llm but sits on a separate path from the trigger.
  const g = graph(["t:trigger", "l:llm", "s:slack_post"], ["t>l", "t>s"]);
  const failures = checkExpectations(g, { mustPrecede: [["llm", "slack_post"]] });
  assert.deepEqual(failures, ['"slack_post" node "s" has no "llm" upstream']);
});

test("mustPrecede requires every node of the later kind to be covered", () => {
  const g = graph(
    ["t:trigger", "a:approval", "h1:http_request", "h2:http_request"],
    ["t>a", "a>h1", "t>h2"],
  );
  const failures = checkExpectations(g, { mustPrecede: [["approval", "http_request"]] });
  assert.deepEqual(failures, ['"http_request" node "h2" has no "approval" upstream']);
});

test("parallel passes for siblings and fails for a chain", () => {
  const fanOut = graph(
    ["t:trigger", "h1:http_request", "h2:http_request", "l:llm"],
    ["t>h1", "t>h2", "h1>l", "h2>l"],
  );
  const chain = graph(
    ["t:trigger", "h1:http_request", "h2:http_request", "l:llm"],
    ["t>h1", "h1>h2", "h2>l"],
  );
  const expect = { parallel: [["http_request", "http_request"]] as [string, string][] };
  assert.deepEqual(checkExpectations(fanOut, expect), []);
  assert.deepEqual(checkExpectations(chain, expect), [
    'no "http_request" and "http_request" nodes run in parallel',
  ]);
});

test("kind, count and trigger rules each report their own failure", () => {
  const failures = checkExpectations(branchy, {
    requiredKinds: ["approval"],
    requiredAnyOf: [["transform", "code"]],
    forbiddenKinds: ["llm"],
    minKindCount: { slack_post: 2 },
    branchCount: 0,
    nodeCount: { max: 3 },
    triggerEvent: "schedule",
  });
  assert.deepEqual(failures, [
    'missing required kind "approval"',
    'needs one of "transform" / "code"',
    'contains forbidden kind "llm"',
    'expected at least 2 "slack_post" nodes, got 1',
    "expected exactly 0 branch nodes, got 1",
    "expected at most 3 nodes, got 5",
    'expected a "schedule" trigger, got webhook',
  ]);
});

test("a cyclic graph fails ordering rules instead of throwing", () => {
  const g = graph(["t:trigger", "a:llm", "b:llm"], ["t>a", "a>b", "b>a"]);
  assert.deepEqual(checkExpectations(g, { mustPrecede: [["trigger", "llm"]] }), [
    "graph has a cycle, so ordering rules can't be checked",
  ]);
});

test("scoreCompile marks invalid graphs as neither valid nor matching", () => {
  const noTrigger = graph(["l:llm"], []);
  const score = scoreCompile(kase({ requiredKinds: ["llm"] }), ok(noTrigger));
  assert.equal(score.valid, false);
  assert.equal(score.structuralMatch, false);
  assert.equal(score.failures[0], "graph does not pass validateGraph");
});

test("a valid matching graph scores as a match and keeps attempts and usage", () => {
  const usage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const score = scoreCompile(kase({ branchCount: 1 }), { ...ok(branchy), attempts: 2, usage });
  assert.equal(score.valid, true);
  assert.equal(score.structuralMatch, true);
  assert.equal(score.attempts, 2);
  assert.deepEqual(score.usage, usage);
});

test("a compile error only counts as a match when the case accepts one", () => {
  const failed = { ok: false as const, error: "boom", attempts: 2, latencyMs: 5, usage: ZERO_USAGE };
  const accepted = scoreCompile(kase({ acceptCompileError: true }), failed);
  const rejected = scoreCompile(kase({}), failed);
  assert.equal(accepted.structuralMatch, true);
  assert.equal(accepted.valid, false);
  assert.equal(rejected.structuralMatch, false);
  assert.deepEqual(rejected.failures, ["compile failed: boom"]);
});
