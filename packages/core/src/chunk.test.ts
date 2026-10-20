import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkDocument, estimateTokens, CHARS_PER_TOKEN } from "./chunk.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Deterministic filler prose: numbered sentences so every word is traceable. */
function prose(sentences: number, prefix = "Fact"): string {
  return Array.from(
    { length: sentences },
    (_, i) => `${prefix} number ${i + 1} explains one specific detail of the policy in plain words.`,
  ).join(" ");
}

/** Every chunk must be a contiguous slice of the source that starts and ends on word boundaries. */
function assertCleanSlices(source: string, chunks: { content: string }[]) {
  const src = norm(source);
  for (const c of chunks) {
    const body = norm(c.content);
    const at = src.indexOf(body);
    assert.ok(at !== -1, `chunk is not a contiguous slice of the source: "${body.slice(0, 60)}…"`);
    const before = src[at - 1];
    const after = src[at + body.length];
    assert.ok(before === undefined || before === " ", `chunk starts mid-word: "${body.slice(0, 30)}"`);
    assert.ok(after === undefined || after === " ", `chunk ends mid-word: "…${body.slice(-30)}"`);
  }
}

test("empty and whitespace-only input yields no chunks", () => {
  assert.deepEqual(chunkDocument([]), []);
  assert.deepEqual(chunkDocument([{ text: "  \n\n  \n" }]), []);
});

test("a short document is a single chunk with an estimated token count", () => {
  const text = "Remote work is allowed two days a week.";
  const [only, ...rest] = chunkDocument([{ text }]);
  assert.equal(rest.length, 0);
  assert.equal(only!.content, text);
  assert.equal(only!.chunkIndex, 0);
  assert.equal(only!.tokenCount, Math.ceil(text.length / CHARS_PER_TOKEN));
  assert.deepEqual(only!.metadata, {});
});

test("headings are hard boundaries and become chunk metadata", () => {
  const text = [
    "# Leave",
    "Employees get 20 vacation days.",
    "",
    "## Sick leave",
    "Sick days are unlimited with a note.",
    "",
    "# Expenses",
    "Submit receipts within 30 days.",
  ].join("\n");
  const chunks = chunkDocument([{ text }]);
  assert.deepEqual(
    chunks.map((c) => [c.metadata.heading, c.content]),
    [
      ["Leave", "# Leave\n\nEmployees get 20 vacation days."],
      ["Sick leave", "## Sick leave\n\nSick days are unlimited with a note."],
      ["Expenses", "# Expenses\n\nSubmit receipts within 30 days."],
    ],
  );
});

test("splitOnHeadings: false packs across sections and drops heading metadata", () => {
  const text = "# Leave\nTwenty days per year.\n\n# Expenses\nSubmit receipts within 30 days.";
  const chunks = chunkDocument([{ text }], { splitOnHeadings: false });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]!.content, "# Leave\n\nTwenty days per year.\n\n# Expenses\n\nSubmit receipts within 30 days.");
  assert.deepEqual(chunks[0]!.metadata, {});
});

test("a heading with no body of its own is folded into the next section", () => {
  const text = "# Leave Policy\n\n## Vacation\nTwenty days per year.\n\n# Expenses\n## Travel\nFly economy.";
  const chunks = chunkDocument([{ text }]);
  assert.deepEqual(
    chunks.map((c) => [c.metadata.heading, c.content]),
    [
      ["Vacation", "# Leave Policy\n\n## Vacation\n\nTwenty days per year."],
      ["Travel", "# Expenses\n\n## Travel\n\nFly economy."],
    ],
  );
});

test("long text splits near the target size, with overlap between neighbours", () => {
  const text = prose(120); // ~9,000 chars ≈ 2,250 tokens
  const chunks = chunkDocument([{ text }], { targetTokens: 500, overlapTokens: 75 });

  assert.ok(chunks.length >= 4 && chunks.length <= 7, `got ${chunks.length} chunks`);
  for (const c of chunks) {
    // target plus at most one overlap's worth of slack
    assert.ok(c.tokenCount <= 500 + 75, `chunk ${c.chunkIndex} has ${c.tokenCount} tokens`);
  }
  for (const c of chunks.slice(0, -1)) {
    assert.ok(c.tokenCount >= 300, `non-final chunk ${c.chunkIndex} is only ${c.tokenCount} tokens`);
  }
  for (let i = 1; i < chunks.length; i++) {
    const prev = norm(chunks[i - 1]!.content);
    const next = norm(chunks[i]!.content);
    const lead = next.slice(0, 40);
    assert.ok(prev.includes(lead), `chunk ${i} does not start inside chunk ${i - 1}'s tail`);
    const shared = prev.length - prev.lastIndexOf(lead);
    assert.ok(shared > 0 && shared <= 75 * CHARS_PER_TOKEN, `overlap of ${shared} chars is out of range`);
  }
  assertCleanSlices(text, chunks);
});

test("overlap starts on a sentence boundary when one is available", () => {
  const chunks = chunkDocument([{ text: prose(80) }]);
  for (const c of chunks.slice(1)) {
    assert.match(c.content, /^Fact number \d+/);
  }
});

test("every word of the source lands in some chunk", () => {
  const text = `${prose(60, "Alpha")}\n\n${prose(60, "Beta")}`;
  const chunks = chunkDocument([{ text }], { targetTokens: 200, overlapTokens: 30 });
  const covered = norm(chunks.map((c) => c.content).join(" "));
  for (const marker of ["Alpha number 1 ", "Alpha number 60 ", "Beta number 1 ", "Beta number 60 "]) {
    assert.ok(covered.includes(marker), `missing "${marker.trim()}"`);
  }
});

test("paragraph boundaries are preferred when paragraphs fit", () => {
  const para = (n: number) => `Paragraph ${n}. ${"Some words here. ".repeat(20).trim()}`;
  const text = [1, 2, 3, 4, 5, 6].map(para).join("\n\n"); // each ~350 chars
  const chunks = chunkDocument([{ text }], { targetTokens: 200, overlapTokens: 0 });
  for (const c of chunks) {
    assert.match(c.content, /^Paragraph \d+\./, "chunk should start at a paragraph");
    assert.match(c.content, /here\.$/, "chunk should end at a paragraph end");
  }
});

test("without overlap, chunks partition the text exactly", () => {
  const text = prose(50);
  const chunks = chunkDocument([{ text }], { targetTokens: 100, overlapTokens: 0 });
  assert.equal(norm(chunks.map((c) => c.content).join(" ")), norm(text));
});

test("a single word longer than the target is kept whole, not cut", () => {
  const huge = "x".repeat(3000);
  const text = `Start of text. ${huge} end of text.`;
  const chunks = chunkDocument([{ text }], { targetTokens: 100, overlapTokens: 10 });
  assert.ok(chunks.some((c) => c.content.includes(huge)), "the long word was split");
  assertCleanSlices(text, chunks);
});

test("page numbers come from the page each chunk starts on", () => {
  const chunks = chunkDocument(
    [
      { text: "# Handbook\nWelcome to the company.", page: 1 },
      { text: "Benefits start on day one.", page: 2 },
      { text: prose(40), page: 3 },
    ],
    { targetTokens: 150, overlapTokens: 20 },
  );
  assert.equal(chunks[0]!.metadata.page, 1);
  assert.ok(chunks.some((c) => c.metadata.page === 3));
  // headings carry across page breaks
  assert.ok(chunks.every((c) => c.metadata.heading === "Handbook"));
  // pages never go backwards
  const pages = chunks.map((c) => c.metadata.page!);
  assert.deepEqual(pages, [...pages].sort((a, b) => a - b));
});

test("chunk indexes are sequential across sections", () => {
  const text = `# A\n${prose(30)}\n\n# B\n${prose(30)}`;
  const chunks = chunkDocument([{ text }], { targetTokens: 150 });
  assert.deepEqual(
    chunks.map((c) => c.chunkIndex),
    chunks.map((_, i) => i),
  );
});

test("estimateTokens is chars / 4, rounded up", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
});
