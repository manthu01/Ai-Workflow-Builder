import { useEffect } from "react";
import { useApp } from "../store";

const KIND_LABEL: Record<string, string> = {
  trigger: "trigger",
  llm: "LLM",
  http_request: "HTTP",
  transform: "transform",
  branch: "branch",
  loop: "loop",
  code: "code",
  asset: "asset",
  api_call: "API",
  local: "local",
  approval: "approval",
  slack_post: "Slack",
};

export function TemplatesView() {
  const templates = useApp((s) => s.templates);
  const loadTemplates = useApp((s) => s.loadTemplates);
  const useTemplate = useApp((s) => s.useTemplate);
  const removeTemplate = useApp((s) => s.removeTemplate);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  return (
    <div className="analytics">
      <div className="analytics-head">
        <h2>Templates</h2>
        <span className="muted">
          {templates.length} template{templates.length === 1 ? "" : "s"} · publish
          one from the Builder toolbar
        </span>
      </div>

      {templates.length === 0 && <div className="empty">No templates yet.</div>}

      <div className="tpl-grid">
        {templates.map((t) => (
          <div key={t.id} className="tpl-card">
            <div className="tpl-top">
              <strong>{t.name}</strong>
              <span className="badge">{t.category}</span>
              {t.builtIn && <span className="badge" style={{ color: "var(--accent)" }}>built-in</span>}
            </div>
            <p className="tpl-desc">{t.description || "No description."}</p>
            <div className="tpl-kinds">
              {t.kinds.map((k) => (
                <span key={k} className="tpl-chip">
                  {KIND_LABEL[k] ?? k}
                </span>
              ))}
            </div>
            <div className="tpl-foot">
              <span className="muted">
                {t.nodeCount} nodes · {t.cloneCount} clone{t.cloneCount === 1 ? "" : "s"}
              </span>
              <div style={{ flex: 1 }} />
              {!t.builtIn && (
                <button
                  style={{ color: "var(--fail)" }}
                  onClick={() => void removeTemplate(t.id)}
                >
                  Delete
                </button>
              )}
              <button className="primary" onClick={() => void useTemplate(t.id)}>
                Use this
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
