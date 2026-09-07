import { useState } from "react";
import { useApp } from "../store";
import type { NodeKind } from "../types";

export function Toolbar() {
  const workflow = useApp((s) => s.workflow);
  const catalog = useApp((s) => s.catalog);
  const addNode = useApp((s) => s.addNode);
  const relayout = useApp((s) => s.relayout);
  const doRun = useApp((s) => s.doRun);
  const running = useApp((s) => s.running);
  const saving = useApp((s) => s.saving);
  const issues = useApp((s) => s.issues);
  const [menuOpen, setMenuOpen] = useState(false);

  const errors = issues.filter((i) => i.level === "error").length;
  const disabled = !workflow;

  return (
    <div className="toolbar">
      <div style={{ position: "relative" }}>
        <button disabled={disabled} onClick={() => setMenuOpen((o) => !o)}>
          + Add node ▾
        </button>
        {menuOpen && !disabled && (
          <div className="menu">
            {catalog.map((c) => (
              <button
                key={c.kind}
                className="menu-item"
                onClick={() => {
                  addNode(c.kind as NodeKind);
                  setMenuOpen(false);
                }}
              >
                <strong>{c.title}</strong>
                <span>{c.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button disabled={disabled} onClick={() => void relayout()}>
        Auto-layout
      </button>

      <span className="save-state">
        {saving ? "Saving…" : workflow ? "Saved" : ""}
      </span>

      <div className="spacer" />

      {errors > 0 && <span className="badge" style={{ color: "var(--fail)" }}>{errors} error{errors > 1 ? "s" : ""}</span>}
      <button
        className="primary"
        disabled={disabled || running || errors > 0}
        onClick={() => void doRun("dry")}
      >
        {running ? "Running…" : "Dry run"}
      </button>
      <button
        disabled={disabled || running || errors > 0}
        onClick={() => void doRun("live")}
      >
        Live run
      </button>
    </div>
  );
}
