import { test } from "node:test";
import assert from "node:assert/strict";
import { reciprocalRankFusion, RRF_K } from "./rrf.js";

const id = (s: string) => s;
const order = (lists: string[][]) => reciprocalRankFusion(lists, id).map((f) => f.item);

test("an item ranked by both lists beats one ranked first by only one", () => {
  // "b" is 2nd in both; "a" is 1st in vector only; "x" is 1st in keyword only.
  const vector = ["a", "b", "c"];
  const keyword = ["x", "b", "d"];
  assert.equal(order([vector, keyword])[0], "b");
});

test("scores are the sum of 1 / (k + rank)", () => {
  const [top] = reciprocalRankFusion([["a"], ["a"]], id);
  assert.equal(top!.rrf, 2 / (RRF_K + 1));
  assert.deepEqual(top!.ranks, [1, 1]);
});

test("normalized score is 1 for rank 1 everywhere and in (0,1) otherwise", () => {
  const fused = reciprocalRankFusion([["a", "b"], ["a", "c"]], id);
  assert.equal(fused[0]!.item, "a");
  assert.equal(fused[0]!.score, 1);
  for (const f of fused.slice(1)) assert.ok(f.score > 0 && f.score < 1);
});

test("an item missing from a list gets null rank and no contribution from it", () => {
  const fused = reciprocalRankFusion([["a", "b"], ["b"]], id);
  const a = fused.find((f) => f.item === "a")!;
  assert.deepEqual(a.ranks, [1, null]);
  assert.equal(a.rrf, 1 / (RRF_K + 1));
});

test("ties break by best single rank, then first appearance", () => {
  // "a" (rank 1 in list 0) and "z" (rank 1 in list 1) have equal RRF; "a" appeared first.
  assert.deepEqual(order([["a"], ["z"]]), ["a", "z"]);
  // equal RRF, but "p" has the better best rank
  const fused = reciprocalRankFusion([["p", "q"], ["r", "s"]], id);
  assert.deepEqual(fused.map((f) => f.item), ["p", "r", "q", "s"]);
});

test("items are matched by key and the first list's copy is kept", () => {
  const vector = [{ id: "c1", from: "vector" }];
  const keyword = [{ id: "c1", from: "keyword" }];
  const [only, ...rest] = reciprocalRankFusion([vector, keyword], (c) => c.id);
  assert.equal(rest.length, 0);
  assert.equal(only!.item.from, "vector");
});

test("a duplicate within one list counts once, at its best rank", () => {
  const [a] = reciprocalRankFusion([["a", "a"]], id);
  assert.equal(a!.rrf, 1 / (RRF_K + 1));
});

test("empty input fuses to nothing", () => {
  assert.deepEqual(reciprocalRankFusion([], id), []);
  assert.deepEqual(reciprocalRankFusion([[], []], id), []);
});

test("a single list keeps its order", () => {
  assert.deepEqual(order([["c", "a", "b"]]), ["c", "a", "b"]);
});
