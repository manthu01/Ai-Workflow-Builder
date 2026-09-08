import { useEffect, useState } from "react";
import { useApp } from "../store";

export function BlueprintsModal() {
  const open = useApp((s) => s.blueprintsOpen);
  const setOpen = useApp((s) => s.setBlueprintsOpen);
  const blueprints = useApp((s) => s.blueprints);
  const load = useApp((s) => s.loadBlueprints);
  const create = useApp((s) => s.createBlueprint);
  const remove = useApp((s) => s.removeBlueprint);

  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  const submit = async () => {
    if (!spec.trim() || busy) return;
    setBusy(true);
    try {
      await create(name.trim(), spec.trim());
      setName("");
      setSpec("");
    } catch {
      /* error shown in top bar */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>API blueprints</h2>
          <button onClick={() => setOpen(false)}>Close</button>
        </div>
        <p className="cfg-help">
          Paste an OpenAPI (v2/v3) JSON document. Its operations become callable
          from an <code>api_call</code> node, and the compiler can wire them up.
        </p>

        <div className="conn-list">
          {blueprints.length === 0 && <div className="empty">No blueprints yet.</div>}
          {blueprints.map((b) => (
            <details key={b.id} className="node-run">
              <summary>
                <strong>{b.name}</strong>
                <span className="badge">{b.operationCount} ops</span>
                <span className="cfg-help" style={{ marginLeft: "auto" }}>{b.baseUrl}</span>
                <button
                  style={{ color: "var(--fail)", marginLeft: 8 }}
                  onClick={(e) => {
                    e.preventDefault();
                    void remove(b.id);
                  }}
                >
                  Delete
                </button>
              </summary>
              <div style={{ padding: "6px 10px", fontSize: 11 }}>
                <div className="cfg-help">blueprint id: <code>{b.id}</code></div>
                {b.operations.map((o) => (
                  <div key={o.operationId} className="logline" style={{ padding: "3px 0" }}>
                    <code>{o.operationId}</code> — {o.method} {o.path}
                    {o.params.length > 0 && (
                      <span style={{ color: "var(--muted)" }}> · {o.params.map((p) => p.name).join(", ")}</span>
                    )}
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>

        <div className="conn-form">
          <h3>Ingest a spec</h3>
          <label className="cfg-field">
            <span className="cfg-label">Name (optional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Petstore API" />
          </label>
          <label className="cfg-field">
            <span className="cfg-label">OpenAPI JSON</span>
            <textarea
              rows={8}
              spellCheck={false}
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              placeholder='{ "openapi": "3.0.0", "servers": [...], "paths": {...} }'
              style={{ fontFamily: "ui-monospace, monospace", fontSize: 11 }}
            />
          </label>
          <button className="primary" disabled={busy || !spec.trim()} onClick={() => void submit()}>
            {busy ? "Ingesting…" : "Ingest"}
          </button>
        </div>
      </div>
    </div>
  );
}
