import { useState } from "react";
import type { RetrievedChunk } from "../types";

/** "policy.md › Vacation · p. 3" */
export function chunkSource(c: RetrievedChunk): string {
  return [c.document, c.heading && `› ${c.heading}`, c.page !== undefined && `· p. ${c.page}`]
    .filter(Boolean)
    .join(" ");
}

/** One retrieved chunk: rank, score, source, and its text (collapsed until clicked). */
export function ChunkCard({
  chunk,
  rank,
  cited,
}: {
  chunk: RetrievedChunk;
  rank?: number;
  /** Highlight as cited by an llm answer. */
  cited?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`chunk-card ${cited ? "cited" : ""}`} onClick={() => setExpanded((e) => !e)}>
      <div className="chunk-head">
        {rank !== undefined && <span className="chunk-rank">#{rank}</span>}
        <span className="chunk-score" title="score (higher is better)">
          {chunk.score.toFixed(3)}
        </span>
        <span className="chunk-source" title={chunkSource(chunk)}>
          {chunkSource(chunk)}
        </span>
        {chunk.retrievalScore !== undefined && (
          <span className="cfg-help" title="first-pass retrieval score, before re-ranking">
            ret {chunk.retrievalScore.toFixed(3)}
          </span>
        )}
        {chunk.ranks && (
          <span className="cfg-help" title="rank in each retriever before fusion">
            vec {chunk.ranks.vector ?? "–"} · kw {chunk.ranks.keyword ?? "–"}
          </span>
        )}
        {cited && <span className="badge cited-badge">cited</span>}
      </div>
      <div className={`chunk-text ${expanded ? "expanded" : ""}`}>
        {/* Collapsed, skip leading "# Heading" lines: the source label already shows the heading. */}
        {expanded ? chunk.content : chunk.content.replace(/^(?:#{1,6} [^\n]*\n+)+/, "")}
      </div>
    </div>
  );
}
