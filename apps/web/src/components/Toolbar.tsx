import { useState } from "react";
import { useApp } from "../store";
import type { NodeKind } from "../types";

const DEMO_OFF = "Disabled in the public demo";

export function Toolbar() {
  const workflow = useApp((s) => s.workflow);
  const catalog = useApp((s) => s.catalog);
  const addNode = useApp((s) => s.addNode);
  const relayout = useApp((s) => s.relayout);
  const doRun = useApp((s) => s.doRun);
  const running = useApp((s) => s.running);
  const saving = useApp((s) => s.saving);
  const issues = useApp((s) => s.issues);
  const setConnectionsOpen = useApp((s) => s.setConnectionsOpen);
  const setBlueprintsOpen = useApp((s) => s.setBlueprintsOpen);
  const setKnowledgeBasesOpen = useApp((s) => s.setKnowledgeBasesOpen);
  const toggleSelfHeal = useApp((s) => s.toggleSelfHeal);
  const publishTemplate = useApp((s) => s.publishTemplate);
  const demoStatus = useApp((s) => s.demo);
  const demo = demoStatus?.demo ? demoStatus : null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [published, setPublished] = useState(false);

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
            {catalog.map((c) => {
              const off = demo?.blockedKinds.includes(c.kind) ?? false;
              return (
                <button
                  key={c.kind}
                  className={off ? "menu-item demo-off" : "menu-item"}
                  disabled={off}
                  title={off ? DEMO_OFF : undefined}
                  onClick={() => {
                    addNode(c.kind as NodeKind);
                    setMenuOpen(false);
                  }}
                >
                  <strong>{c.title}</strong>
                  <span>{off ? DEMO_OFF : c.description}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <button disabled={disabled} onClick={() => void relayout()}>
        Auto-layout
      </button>
      <button disabled={!!demo} title={demo ? DEMO_OFF : undefined} onClick={() => setConnectionsOpen(true)}>
        Connections
      </button>
      <button disabled={!!demo} title={demo ? DEMO_OFF : undefined} onClick={() => setBlueprintsOpen(true)}>
        API blueprints
      </button>
      <button onClick={() => setKnowledgeBasesOpen(true)}>Knowledge bases</button>
      <button
        disabled={disabled || errors > 0 || published || !!demo}
        title={demo ? DEMO_OFF : "Publish this workflow to the Templates gallery"}
        onClick={() => {
          void publishTemplate("", "general");
          setPublished(true);
          setTimeout(() => setPublished(false), 3000);
        }}
      >
        {published ? "Published ✓" : "Publish template"}
      </button>
      <button
        disabled={disabled || (!!demo && !demo.selfHealAvailable)}
        className={workflow?.selfHeal ? "primary" : ""}
        title={
          demo && !demo.selfHealAvailable
            ? `${DEMO_OFF} (it needs an AI model)`
            : "On a node failure, ask the model to fix its config and retry once"
        }
        onClick={() => void toggleSelfHeal()}
      >
        Self-heal {workflow?.selfHeal ? "on" : "off"}
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
      {demo?.liveLlmAvailable && (
        <button
          disabled={disabled || running || errors > 0}
          title="A dry run whose llm steps call the real model (fast tier). One per hour in the demo."
          onClick={() => void doRun("dry", { liveLlm: true })}
        >
          Dry run + live LLM
        </button>
      )}
      <button
        disabled={disabled || running || errors > 0 || !!demo}
        title={demo ? `${DEMO_OFF}: live runs really send HTTP requests and Slack messages` : undefined}
        onClick={() => void doRun("live")}
      >
        Live run
      </button>
    </div>
  );
}
