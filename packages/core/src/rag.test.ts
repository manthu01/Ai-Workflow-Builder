import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRetrievedContext, checkGrounding, extractCitations } from "./rag.js";

const context = buildRetrievedContext([
  { id: "chk_a1", content: "Five vacation days carry over.", score: 1, documentId: "d1", document: "policy.md", heading: "Vacation" },
  { id: "chk_b2", content: "Hotels are capped at 200 euros.", score: 0.5, documentId: "d1", document: "policy.md", page: 3 },
]);
const prompt = `Context:\n${context}\n\nQuestion: how many days carry over?`;

test("context tags each chunk with its citation and source", () => {
  assert.match(context, /^\[chunk:chk_a1\] \(source: policy\.md · Vacation\)\nFive vacation/);
  assert.match(context, /\[chunk:chk_b2\] \(source: policy\.md · p\. 3\)/);
});

test("extractCitations finds tags in order, without duplicates", () => {
  assert.deepEqual(extractCitations("x [chunk:b] y [chunk:a] z [chunk:b]"), ["b", "a"]);
  assert.deepEqual(extractCitations("no tags here, [chunk:] or [chunk: a]"), []);
});

test("an answer citing only provided chunks is grounded", () => {
  const r = checkGrounding("Five days carry over [chunk:chk_a1].", prompt);
  assert.deepEqual(r, { grounded: true, citations: ["chk_a1"], invalidCitations: [] });
});

test("an answer with no citations is not grounded", () => {
  const r = checkGrounding("Five days carry over.", prompt);
  assert.equal(r.grounded, false);
  assert.match(r.reason!, /cites no chunks/);
});

test("one fabricated citation makes the answer ungrounded", () => {
  const r = checkGrounding("Five days [chunk:chk_a1], unlimited sick days [chunk:chk_zz9].", prompt);
  assert.equal(r.grounded, false);
  assert.deepEqual(r.citations, ["chk_a1"]);
  assert.deepEqual(r.invalidCitations, ["chk_zz9"]);
});

test("with no context in the prompt nothing can be grounded", () => {
  const r = checkGrounding("Five days [chunk:chk_a1].", "Question: how many days?");
  assert.equal(r.grounded, false);
  assert.match(r.reason!, /no \[chunk:<id>\] context/);
});
