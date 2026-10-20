import { useState } from "react";
import { useApp } from "../store";
import type { NodeRunResult, RetrievedChunk } from "../types";
import { ChunkCard } from "./ChunkCard";

interface RetrieveOutput {
  chunks: RetrievedChunk[];
  context: string;
  count: number;
}

interface GroundedOutput {
  text?: string;
  json?: unknown;
  grounded: boolean;
  citations: string[];
  invalidCitations: string[];
  reason?: string;
}

// Detected by shape, so this works whether or not the node's kind is reported.
const asRetrieve = (o: unknown): RetrieveOutput | undefined =>
  o && typeof o === "object" && Array.isArray((o as RetrieveOutput).chunks) &&
  typeof (o as RetrieveOutput).context === "string"
    ? (o as RetrieveOutput)
    : undefined;

const asGrounded = (o: unknown): GroundedOutput | undefined =>
  o && typeof o === "object" && typeof (o as GroundedOutput).grounded === "boolean" &&
  Array.isArray((o as GroundedOutput).citations)
    ? (o as GroundedOutput)
    : undefined;

function RetrievedChunks({ output }: { output: RetrieveOutput }) {
  return (
    <div className="rag-box">
      <div className="rag-title">Retrieved {output.count} chunk(s)</div>
      {output.count === 0 && <div className="cfg-help">Nothing matched the query.</div>}
      {output.chunks.map((c, i) => (
        <ChunkCard key={c.id} chunk={c} rank={i + 1} />
      ))}
    </div>
  );
}

/** The answer with [chunk:id] tags highlighted, plus the chunks it cites. */
function CitedAnswer({ output, pool }: { output: GroundedOutput; pool: Map<string, RetrievedChunk> }) {
  const text = output.text ?? JSON.stringify(output.json, null, 2);
  const valid = new Set(output.citations);
  const parts = text.split(/(\[chunk:[A-Za-z0-9_-]+\])/g);
  return (
    <div className="rag-box">
      <div className="rag-title">
        <span className={`badge ${output.grounded ? "grounded" : "ungrounded"}`}>
          {output.grounded ? "grounded" : "not grounded"}
        </span>
        {output.reason && <span className="cfg-help">{output.reason}</span>}
      </div>
      <div className="cited-answer">
        {parts.map((part, i) => {
          const id = /^\[chunk:(.+)\]$/.exec(part)?.[1];
          if (!id) return <span key={i}>{part}</span>;
          return (
            <mark key={i} className={valid.has(id) ? "cite" : "cite invalid"} title={valid.has(id) ? pool.get(id)?.document : "not among the retrieved chunks"}>
              {part}
            </mark>
          );
        })}
      </div>
      {output.citations.map((id) => {
        const chunk = pool.get(id);
        return chunk ? <ChunkCard key={id} chunk={chunk} cited /> : null;
      })}
    </div>
  );
}

function ApprovalGate({ node }: { node: NodeRunResult }) {
  const approve = useApp((s) => s.approve);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <div className="approval-gate">
      <div className="approval-msg">{node.logs[0] ?? "Approve this step?"}</div>
      <input
        placeholder="note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={sent}
      />
      <div style={{ display: "flex", gap: 6 }}>
        <button
          className="primary"
          disabled={sent}
          onClick={() => {
            setSent(true);
            void approve(node.nodeId, "approve", note || undefined);
          }}
        >
          Approve
        </button>
        <button
          disabled={sent}
          style={{ color: "var(--fail)" }}
          onClick={() => {
            setSent(true);
            void approve(node.nodeId, "reject", note || undefined);
          }}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function NodeRunCard({ node, chunkPool }: { node: NodeRunResult; chunkPool: Map<string, RetrievedChunk> }) {
  const retrieved = asRetrieve(node.output);
  const grounded = asGrounded(node.output);
  return (
    <details className="node-run" open={node.status === "failed" || node.status === "awaiting"}>
      <summary>
        <span className={`dot ${node.status}`} />
        <strong>{node.nodeId}</strong>
        <span className="badge">{node.status}</span>
        {node.attempts > 1 && <span className="badge">{node.attempts} attempts</span>}
      </summary>
      {node.status === "awaiting" && <ApprovalGate node={node} />}
      {node.healed && (
        <div className="heal-box">
          <strong style={{ color: node.healed.succeeded ? "var(--ok)" : "var(--warn)" }}>
            {node.healed.succeeded ? "Self-healed" : "Self-heal failed"}
          </strong>
          <div>{node.healed.explanation}</div>
          <pre>
            <span style={{ color: "var(--muted)" }}>was </span>
            {JSON.stringify(node.healed.from, null, 2)}
          </pre>
          <pre>
            <span style={{ color: "var(--muted)" }}>now </span>
            {JSON.stringify(node.healed.to, null, 2)}
          </pre>
        </div>
      )}
      {node.logs.map((l, i) => (
        <div key={i} className="logline">
          · {l}
        </div>
      ))}
      {node.error && <pre style={{ color: "var(--fail)" }}>{node.error}</pre>}
      {node.input !== undefined && (
        <pre>
          <span style={{ color: "var(--muted)" }}>input </span>
          {JSON.stringify(node.input, null, 2)}
        </pre>
      )}
      {typeof (node.output as { dataUri?: string })?.dataUri === "string" &&
        (node.output as { dataUri: string }).dataUri.startsWith("data:image/") && (
          <img
            className="asset-preview"
            src={(node.output as { dataUri: string }).dataUri}
            alt="generated asset"
          />
        )}
      {retrieved && <RetrievedChunks output={retrieved} />}
      {grounded && <CitedAnswer output={grounded} pool={chunkPool} />}
      {node.output !== undefined && (
        <pre>
          <span style={{ color: "var(--muted)" }}>output </span>
          {JSON.stringify(node.output, null, 2)}
        </pre>
      )}
    </details>
  );
}

export function RunPanel() {
  const workflow = useApp((s) => s.workflow);
  const run = useApp((s) => s.run);
  const running = useApp((s) => s.running);
  const issues = useApp((s) => s.issues);

  // Every chunk any retrieve node returned in this run, for resolving citations.
  const chunkPool = new Map<string, RetrievedChunk>();
  for (const n of run?.nodes ?? []) {
    for (const c of asRetrieve(n.output)?.chunks ?? []) chunkPool.set(c.id, c);
  }

  return (
    <div className="runpanel-inner">
      {run && (
        <div className="run-summary">
          <span className={`badge`}>
            {run.mode} · {run.status}
          </span>
        </div>
      )}
      {issues.map((iss, i) => (
        <div
          key={i}
          className="issue-line"
          style={{ color: iss.level === "error" ? "var(--fail)" : "var(--warn)" }}
        >
          {iss.level}: {iss.nodeId ? `[${iss.nodeId}] ` : ""}
          {iss.message}
        </div>
      ))}
      {!run && !running && (
        <div className="empty">
          {workflow
            ? "Dry run executes every node with mock data — no external calls."
            : "Compile a workflow first."}
        </div>
      )}
      {running && !run && <div className="empty">Running…</div>}
      {run?.nodes.map((n) => (
        <NodeRunCard key={n.nodeId} node={n} chunkPool={chunkPool} />
      ))}
    </div>
  );
}
