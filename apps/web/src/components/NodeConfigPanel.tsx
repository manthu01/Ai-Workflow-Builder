import { useApp } from "../store";
import type { Connection, NodeFieldSpec } from "../types";

function Field({
  spec,
  value,
  invalid,
  connections,
  onChange,
}: {
  spec: NodeFieldSpec;
  value: string;
  invalid: boolean;
  connections: Connection[];
  onChange: (v: string) => void;
}) {
  const common = {
    value: value ?? "",
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    style: invalid ? { borderColor: "var(--fail)" } : undefined,
  };
  const matching = connections.filter((c) => c.kind === spec.connectionKind);
  return (
    <label className="cfg-field">
      <span className="cfg-label">
        {spec.label}
        {spec.optional && <span className="cfg-optional"> (optional)</span>}
      </span>
      {spec.widget === "connection" ? (
        <select {...common}>
          <option value="">
            {matching.length ? "— none —" : "no connections yet"}
          </option>
          {matching.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      ) : spec.widget === "select" ? (
        <select {...common}>
          {spec.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : spec.widget === "textarea" || spec.widget === "json" ? (
        <textarea
          rows={spec.widget === "json" ? 4 : 3}
          placeholder={spec.placeholder}
          spellCheck={false}
          {...common}
        />
      ) : (
        <input type="text" placeholder={spec.placeholder} {...common} />
      )}
      {spec.help && <span className="cfg-help">{spec.help}</span>}
    </label>
  );
}

export function NodeConfigPanel() {
  const workflow = useApp((s) => s.workflow);
  const selectedId = useApp((s) => s.selectedNodeId);
  const catalog = useApp((s) => s.catalog);
  const issues = useApp((s) => s.issues);
  const connections = useApp((s) => s.connections);
  const updateNode = useApp((s) => s.updateNode);
  const deleteNode = useApp((s) => s.deleteNode);

  const node = workflow?.graph.nodes.find((n) => n.id === selectedId);
  if (!node) {
    return <div className="empty">Select a node on the canvas to edit it.</div>;
  }
  const entry = catalog.find((c) => c.kind === node.kind);
  const nodeIssues = issues.filter((i) => i.nodeId === node.id);
  const invalidKeys = new Set(
    nodeIssues
      .map((i) => i.message.match(/^config\.([a-zA-Z0-9_]+)/)?.[1])
      .filter(Boolean) as string[],
  );

  return (
    <div className="cfg">
      <div className="cfg-head">
        <div>
          <div className="badge">{entry?.title ?? node.kind}</div>
          <code className="cfg-id">{node.id}</code>
        </div>
        <button
          onClick={() => deleteNode(node.id)}
          title="Delete node"
          style={{ color: "var(--fail)" }}
        >
          Delete
        </button>
      </div>

      <label className="cfg-field">
        <span className="cfg-label">Label</span>
        <input
          type="text"
          value={node.label}
          onChange={(e) => updateNode(node.id, { label: e.target.value })}
        />
      </label>

      {entry?.fields.map((spec) => (
        <Field
          key={spec.key}
          spec={spec}
          value={node.config[spec.key] ?? ""}
          invalid={invalidKeys.has(spec.key)}
          connections={connections}
          onChange={(v) => updateNode(node.id, { config: { [spec.key]: v } })}
        />
      ))}

      {nodeIssues.length > 0 && (
        <div className="cfg-issues">
          {nodeIssues.map((i, k) => (
            <div key={k} style={{ color: i.level === "error" ? "var(--fail)" : "var(--warn)" }}>
              {i.message}
            </div>
          ))}
        </div>
      )}

      {entry?.hasSideEffects && (
        <div className="cfg-help" style={{ marginTop: 8 }}>
          This node has external side effects. Dry runs simulate it; live runs perform it.
        </div>
      )}
    </div>
  );
}
