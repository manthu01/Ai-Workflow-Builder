import { extractText } from "unpdf";
import type { ChunkSourcePage } from "@awb/core";

/** Turns raw document bytes into text pages for the chunker. */
export async function parseBytes(bytes: Uint8Array, mimeType: string): Promise<ChunkSourcePage[]> {
  if (mimeType === "application/pdf") {
    // pdf.js rejects Node Buffers (a Uint8Array subclass), so hand it a plain copy.
    const { text } = await extractText(new Uint8Array(bytes), { mergePages: false });
    return text.map((t, i) => ({ text: t, page: i + 1 })).filter((p) => p.text.trim());
  }
  const decoded = new TextDecoder("utf-8").decode(bytes);
  if (mimeType === "text/html") return [{ text: htmlToText(decoded) }];
  // Plain text and Markdown go straight to the chunker, which reads # headings.
  return [{ text: decoded }];
}

/** Maps a response content-type to one of the types parseBytes understands. */
export function normalizeMime(contentType: string | null): string | undefined {
  const t = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (t === "application/pdf") return t;
  if (t === "text/html" || t === "application/xhtml+xml") return "text/html";
  if (t === "text/markdown" || t === "text/x-markdown") return "text/markdown";
  if (t === "text/plain" || t === "") return "text/plain";
  return undefined;
}

/**
 * Readable text from an HTML page. Drops non-content elements, keeps headings
 * as Markdown "#" lines (so chunks get heading metadata) and block elements as
 * paragraph breaks. Deliberately simple - no DOM, no readability scoring.
 */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|head|nav|footer|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(
      /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_, level: string, inner: string) =>
        `\n\n${"#".repeat(Number(level))} ${stripTags(inner).replace(/\s+/g, " ").trim()}\n\n`,
    )
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|article|main|header|ul|ol|table|tr|blockquote|pre|dl|figure)>/gi, "\n\n");
  s = decodeEntities(stripTags(s));
  return s
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, " ");

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}
