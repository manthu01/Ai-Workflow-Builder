/**
 * Document chunker for knowledge bases (RAG).
 *
 * Why ~500 tokens: big enough that a chunk holds a complete idea (a policy
 * clause, a procedure), small enough that its embedding stays specific and
 * five of them fit comfortably in an llm prompt. Why ~75 tokens of overlap: a
 * fact that straddles a cut still appears whole in at least one chunk, and
 * each chunk keeps a little lead-in context.
 *
 * How it splits, coarsest first: headings are hard boundaries (a chunk never
 * spans two sections), then paragraphs, then sentences, then words. A piece
 * is only broken further when it alone exceeds the target, and no level ever
 * cuts inside a word.
 *
 * Tokens are approximated as chars / 4 - close enough for English, and it
 * keeps the chunker free of any tokenizer dependency.
 */

export const CHARS_PER_TOKEN = 4;

export const estimateTokens = (text: string): number =>
  Math.ceil(text.length / CHARS_PER_TOKEN);

/** One page of extracted text (PDF), or the whole document (text/Markdown/URL). */
export interface ChunkSourcePage {
  text: string;
  /** 1-based page number, when the source has pages. */
  page?: number;
}

export interface ChunkOptions {
  targetTokens?: number;
  overlapTokens?: number;
}

export interface ChunkMetadata {
  page?: number;
  /** The nearest Markdown heading above the chunk. */
  heading?: string;
}

export interface Chunk {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  metadata: ChunkMetadata;
}

export const DEFAULT_CHUNK_TOKENS = 500;
export const DEFAULT_OVERLAP_TOKENS = 75;

const HEADING_LINE = /^#{1,6}\s+(.+?)\s*#*\s*$/;

/** A sentence ends at . ! or ? (plus closing quotes/brackets) followed by space and a likely sentence start. */
const SENTENCE_BREAK = /(?<=[.!?]["')\]]?)\s+(?=["'(\[]?[A-Z0-9])/;

interface Paragraph {
  text: string;
  page?: number;
}

interface Section {
  heading?: string;
  paragraphs: Paragraph[];
}

/** A packable piece of text, and how it joins the piece before it. */
interface Unit {
  text: string;
  page?: number;
  sep: "\n\n" | " ";
}

export function chunkDocument(pages: ChunkSourcePage[], opts: ChunkOptions = {}): Chunk[] {
  const targetChars = (opts.targetTokens ?? DEFAULT_CHUNK_TOKENS) * CHARS_PER_TOKEN;
  const overlapChars = (opts.overlapTokens ?? DEFAULT_OVERLAP_TOKENS) * CHARS_PER_TOKEN;

  const chunks: Chunk[] = [];
  for (const section of splitSections(pages)) {
    const units = section.paragraphs.flatMap((p) => toUnits(p, targetChars));
    for (const { content, page } of pack(units, targetChars, overlapChars)) {
      chunks.push({
        chunkIndex: chunks.length,
        content,
        tokenCount: estimateTokens(content),
        metadata: {
          ...(page !== undefined && { page }),
          ...(section.heading !== undefined && { heading: section.heading }),
        },
      });
    }
  }
  return chunks;
}

/**
 * Level 1 + 2: headings start a new section, blank lines end a paragraph.
 * The heading line itself stays in the text so the first chunk of a section
 * carries its title. Headings carry across page breaks.
 */
function splitSections(pages: ChunkSourcePage[]): Section[] {
  const sections: Section[] = [{ paragraphs: [] }];
  let current = sections[0]!;
  let lines: string[] = [];
  let linesPage: number | undefined;

  const flush = () => {
    const text = lines.join("\n").trim();
    if (text) current.paragraphs.push({ text, page: linesPage });
    lines = [];
  };

  for (const { text, page } of pages) {
    flush(); // a paragraph never spans pages, so its page number is exact
    linesPage = page;
    for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
      const heading = HEADING_LINE.exec(line.trim());
      if (heading) {
        flush();
        // A heading followed directly by a subheading ("# Leave" then "## Vacation")
        // would be a chunk of only a title. Fold it into the new section instead,
        // where it adds context.
        const carried = current.paragraphs.length === 1 && current.heading !== undefined
          ? current.paragraphs.splice(0)
          : [];
        current = { heading: heading[1], paragraphs: carried };
        sections.push(current);
        lines.push(line.trim());
        flush(); // the heading is its own paragraph, never merged into body text
      } else if (!line.trim()) {
        flush();
      } else {
        lines.push(line);
      }
    }
  }
  flush();
  return sections.filter((s) => s.paragraphs.length > 0);
}

/** Level 3 + 4: a paragraph over the target becomes sentences, a sentence over it becomes word runs. */
function toUnits(p: Paragraph, targetChars: number): Unit[] {
  if (p.text.length <= targetChars) return [{ text: p.text, page: p.page, sep: "\n\n" }];

  const units: Unit[] = [];
  for (const sentence of p.text.split(SENTENCE_BREAK)) {
    const pieces = sentence.length <= targetChars ? [sentence] : splitWords(sentence, targetChars);
    for (const text of pieces) {
      units.push({ text, page: p.page, sep: units.length === 0 ? "\n\n" : " " });
    }
  }
  return units;
}

/** Greedy word packing. A single word longer than the target is kept whole rather than cut. */
function splitWords(text: string, targetChars: number): string[] {
  const out: string[] = [];
  let run = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (run && run.length + 1 + word.length > targetChars) {
      out.push(run);
      run = word;
    } else {
      run = run ? `${run} ${word}` : word;
    }
  }
  if (run) out.push(run);
  return out;
}

/**
 * Greedily fills chunks up to the target. When a chunk is full, the next one
 * starts with the tail of the previous (the overlap), so the cut point is
 * covered from both sides.
 */
function pack(
  units: Unit[],
  targetChars: number,
  overlapChars: number,
): { content: string; page?: number }[] {
  const out: { content: string; page?: number }[] = [];
  let content = "";
  let page: number | undefined;

  for (const unit of units) {
    if (!content) {
      content = unit.text;
      page = unit.page;
      continue;
    }
    const joined = content + unit.sep + unit.text;
    if (joined.length <= targetChars) {
      content = joined;
      continue;
    }
    out.push({ content, page });
    const tail = overlapTail(content, overlapChars);
    content = tail ? tail + unit.sep + unit.text : unit.text;
    page = unit.page;
  }
  if (content) out.push({ content, page });
  return out;
}

/**
 * The last ~overlapChars of a chunk, trimmed forward to a clean start: a
 * sentence start if one leaves a useful amount of text, else a word start.
 */
function overlapTail(text: string, overlapChars: number): string {
  if (overlapChars <= 0) return "";
  let tail = text.slice(-overlapChars);
  if (tail.length < text.length) {
    const sentence = /[.!?]["')\]]?\s+/.exec(tail);
    const afterSentence = sentence ? sentence.index + sentence[0].length : -1;
    if (afterSentence > 0 && tail.length - afterSentence >= overlapChars / 3) {
      tail = tail.slice(afterSentence);
    } else {
      const space = tail.search(/\s/);
      tail = space === -1 ? "" : tail.slice(space + 1);
    }
  }
  return tail.trim();
}
