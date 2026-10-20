import { test } from "node:test";
import assert from "node:assert/strict";
import { ZERO_USAGE } from "../src/llm/provider.js";
import { costOf, flakyCases, percentile, renderReport, type EvalRecord, type EvalRun } from "./report.js";

function rec(over: Partial<EvalRecord> & Pick<EvalRecord, "config" | "caseId">): EvalRecord {
  return {
    bucket: "linear",
    valid: true,
    structuralMatch: true,
    failures: [],
    attempts: 1,
    latencyMs: 100,
    usage: ZERO_USAGE,
    repeat: 1,
    model: "m-balanced",
    tier: "balanced",
    routingReasons: [],
    costUsd: 0.01,
    ...over,
  };
}

const CONFIGS = [
  { name: "routed", description: "router" },
  { name: "fast", description: "fast", tier: "fast" as const },
  { name: "balanced", description: "balanced", tier: "balanced" as const },
  { name: "routed-no-repair", description: "no repair", maxAttempts: 1 },
];

function run(records: EvalRecord[], configs = CONFIGS): EvalRun {
  return {
    startedAt: "2026-10-21T00:00:00.000Z",
    finishedAt: "2026-10-21T00:01:00.000Z",
    compilerMode: "claude",
    casesStatus: "final",
    caseCount: 2,
    repeats: 2,
    tierModels: { fast: "m-fast", balanced: "m-balanced", deep: "m-deep" },
    prices: {},
    pricesAsOf: "2026-10-06",
    configs,
    records,
    totalCostUsd: records.reduce((a, r) => a + (r.costUsd ?? 0), 0),
  };
}

const branchMiss = { bucket: "branching", structuralMatch: false, failures: ['missing required kind "branch"'] };
const records: EvalRecord[] = [
  // routed: lin-01 sent to fast and fails once; br-01 needs the repair retry once.
  rec({ config: "routed", caseId: "lin-01", tier: "fast", model: "m-fast", costUsd: 0.001 }),
  rec({ config: "routed", caseId: "lin-01", tier: "fast", model: "m-fast", costUsd: 0.001, repeat: 2, structuralMatch: false, failures: ["expected 3-5 nodes, got 2"] }),
  rec({ config: "routed", caseId: "br-01", bucket: "branching", attempts: 2 }),
  rec({ config: "routed", caseId: "br-01", bucket: "branching", repeat: 2 }),
  rec({ config: "fast", caseId: "lin-01", tier: "fast" }),
  rec({ config: "fast", caseId: "br-01", tier: "fast", ...branchMiss }),
  rec({ config: "balanced", caseId: "lin-01" }),
  rec({ config: "balanced", caseId: "lin-01", repeat: 2 }),
  rec({ config: "balanced", caseId: "br-01", bucket: "branching" }),
  rec({ config: "balanced", caseId: "br-01", bucket: "branching", repeat: 2 }),
  rec({ config: "routed-no-repair", caseId: "lin-01", tier: "fast" }),
  rec({ config: "routed-no-repair", caseId: "br-01", valid: false, ...branchMiss, failures: ["graph does not pass validateGraph"] }),
];

test("costOf prices each token type and returns null for an unknown model", () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 };
  assert.equal(costOf(usage, { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }), 7.35);
  assert.equal(costOf(usage, undefined), null);
});

test("percentile uses nearest rank", () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 100], 95), 100);
  assert.equal(percentile([], 50), 0);
});

test("flakyCases finds case/config pairs with mixed repeats only", () => {
  assert.deepEqual(flakyCases(records), [{ config: "routed", caseId: "lin-01", runs: 2, matched: 1 }]);
});

test("the report has all five sections", () => {
  const md = renderReport(run(records));
  for (const heading of ["## Headline", "## By bucket", "## Repair impact", "## Routing impact", "## Failures"]) {
    assert.ok(md.includes(heading), `missing ${heading}`);
  }
  assert.match(md, /1 of 8 case\/config pairs gave mixed results \(some repeats matched, some didn't\): lin-01 \(routed, 1\/2\)/);
});

test("by bucket lists the weakest bucket first", () => {
  const md = renderReport(run(records));
  // routed: linear 1/2 = 50%, branching 2/2 = 100%.
  assert.ok(md.indexOf("| linear | 1 | 2 | 50.0% |") < md.indexOf("| branching | 1 | 2 | 100.0% |"));
});

test("repair impact counts compiles the retry saved", () => {
  const md = renderReport(run(records));
  assert.match(md, /\| Without repair \(1 attempt\) \| 50\.0% \| 50\.0% \|/);
  assert.match(md, /the repair retry turned 1 of 4 compiles from invalid into valid graphs, and 1 of those also matched/);
});

test("routing impact compares cost with always-balanced and flags under-routing", () => {
  const md = renderReport(run(records));
  // routed total 0.022 vs balanced 0.04 -> 45% cheaper.
  assert.match(md, /Routing cut cost by 45\.0% vs\. always using the balanced tier\./);
  assert.match(md, /Likely under-routed \(sent to fast, and balanced did better\): lin-01\./);
});

test("the failure list groups repeats and keeps each distinct reason", () => {
  const md = renderReport(run(records));
  assert.match(md, /\| lin-01 \| linear \| routed \| 1\/2 \| expected 3-5 nodes, got 2 \|/);
  assert.match(md, /\| br-01 \| branching \| fast \| 1\/1 \| missing required kind "branch" \|/);
});

test("comparison sections say what's missing when only one config ran", () => {
  const routedOnly = records.filter((r) => r.config === "routed");
  const md = renderReport(run(routedOnly, [CONFIGS[0]!]));
  assert.match(md, /## Repair impact\n\n_Not in this run: needs the `routed` and `routed-no-repair` configs/);
  assert.match(md, /## Routing impact\n\n_Not in this run: needs the `routed` and `balanced` configs/);
});
