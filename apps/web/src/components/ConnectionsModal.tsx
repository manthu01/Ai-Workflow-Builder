import { useEffect, useState } from "react";
import { useApp } from "../store";
import type { ConnectionKind } from "../types";

const KIND_LABEL: Record<ConnectionKind, string> = {
  slack: "Slack",
  http_header: "HTTP auth header",
};

export function ConnectionsModal() {
  const open = useApp((s) => s.connectionsOpen);
  const setOpen = useApp((s) => s.setConnectionsOpen);
  const connections = useApp((s) => s.connections);
  const load = useApp((s) => s.loadConnections);
  const create = useApp((s) => s.createConnection);
  const remove = useApp((s) => s.removeConnection);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<ConnectionKind>("slack");
  const [botToken, setBotToken] = useState("");
  const [headerName, setHeaderName] = useState("Authorization");
  const [headerValue, setHeaderValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  const reset = () => {
    setName("");
    setBotToken("");
    setHeaderValue("");
  };

  const submit = async () => {
    if (!name.trim() || busy) return;
    const secret: Record<string, string> =
      kind === "slack"
        ? { botToken: botToken.trim() }
        : { headerName: headerName.trim(), headerValue: headerValue.trim() };
    setBusy(true);
    try {
      await create({ name: name.trim(), kind, secret });
      reset();
    } catch {
      /* error shown in top bar */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Connections</h2>
          <button onClick={() => setOpen(false)}>Close</button>
        </div>
        <p className="cfg-help">
          Credentials are encrypted at rest and only decrypted inside the execution
          engine — they are never sent back to this page or stored in a workflow.
        </p>

        <div className="conn-list">
          {connections.length === 0 && <div className="empty">No connections yet.</div>}
          {connections.map((c) => (
            <div key={c.id} className="conn-row">
              <div>
                <strong>{c.name}</strong>
                <span className="badge">{KIND_LABEL[c.kind]}</span>
              </div>
              <button style={{ color: "var(--fail)" }} onClick={() => void remove(c.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>

        <div className="conn-form">
          <h3>Add a connection</h3>
          <label className="cfg-field">
            <span className="cfg-label">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Prod Slack" />
          </label>
          <label className="cfg-field">
            <span className="cfg-label">Type</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as ConnectionKind)}>
              <option value="slack">Slack (bot token)</option>
              <option value="http_header">HTTP auth header</option>
            </select>
          </label>
          {kind === "slack" ? (
            <label className="cfg-field">
              <span className="cfg-label">Bot token</span>
              <input
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="xoxb-…"
              />
            </label>
          ) : (
            <>
              <label className="cfg-field">
                <span className="cfg-label">Header name</span>
                <input value={headerName} onChange={(e) => setHeaderName(e.target.value)} />
              </label>
              <label className="cfg-field">
                <span className="cfg-label">Header value</span>
                <input
                  type="password"
                  value={headerValue}
                  onChange={(e) => setHeaderValue(e.target.value)}
                  placeholder="Bearer …"
                />
              </label>
            </>
          )}
          <button className="primary" disabled={busy || !name.trim()} onClick={() => void submit()}>
            {busy ? "Saving…" : "Add connection"}
          </button>
        </div>
      </div>
    </div>
  );
}
