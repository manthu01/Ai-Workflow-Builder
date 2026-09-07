import { useEffect, useState } from "react";
import { useApp } from "../store";

const SOURCE_LABEL: Record<string, string> = {
  compile: "compiled",
  edit: "saved",
  deploy: "deployed",
  run: "before run",
  rollback: "rollback",
};

export function HistoryPanel() {
  const workflow = useApp((s) => s.workflow);
  const versions = useApp((s) => s.versions);
  const loadVersions = useApp((s) => s.loadVersions);
  const saveVersion = useApp((s) => s.saveVersion);
  const rollback = useApp((s) => s.rollback);
  const [label, setLabel] = useState("");

  useEffect(() => {
    void loadVersions();
  }, [workflow?.id, loadVersions]);

  if (!workflow) return <div className="empty">Compile a workflow first.</div>;

  return (
    <div className="runpanel-inner">
      <div style={{ display: "flex", gap: 6 }}>
        <input
          className="dep-url"
          placeholder="label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          className="primary"
          onClick={() => {
            void saveVersion(label.trim() || undefined);
            setLabel("");
          }}
        >
          Save version
        </button>
      </div>
      <p className="cfg-help">
        Snapshots are also taken on compile, deploy, and before each run.
      </p>

      {versions.length === 0 && <div className="empty">No versions yet.</div>}

      {versions.map((v, i) => (
        <div key={v.id} className="dep-card">
          <div className="dep-head">
            <strong style={{ fontSize: 13 }}>v{v.version}</strong>
            <span className="badge">{SOURCE_LABEL[v.source] ?? v.source}</span>
            {i === 0 && <span className="badge" style={{ color: "var(--ok)" }}>current</span>}
            <div className="spacer" />
            {i !== 0 && (
              <button onClick={() => void rollback(v.id)}>Restore</button>
            )}
          </div>
          <span className="cfg-help">
            {v.label ? `${v.label} · ` : ""}
            {v.nodeCount} nodes · {v.edgeCount} edges ·{" "}
            {new Date(v.createdAt).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}
