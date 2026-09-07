import { useState } from "react";
import { useApp } from "../store";
import type { NodeRunResult } from "../types";

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

function NodeRunCard({ node }: { node: NodeRunResult }) {
  return (
    <details className="node-run" open={node.status === "failed" || node.status === "awaiting"}>
      <summary>
        <span className={`dot ${node.status}`} />
        <strong>{node.nodeId}</strong>
        <span className="badge">{node.status}</span>
        {node.attempts > 1 && <span className="badge">{node.attempts} attempts</span>}
      </summary>
      {node.status === "awaiting" && <ApprovalGate node={node} />}
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
        <NodeRunCard key={n.nodeId} node={n} />
      ))}
    </div>
  );
}
