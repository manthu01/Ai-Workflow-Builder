import { useEffect } from "react";
import { useApp } from "./store";
import { ChatPanel } from "./components/ChatPanel";
import { Toolbar } from "./components/Toolbar";
import { WorkflowCanvas } from "./components/WorkflowCanvas";
import { RightPanel } from "./components/RightPanel";
import { ConnectionsModal } from "./components/ConnectionsModal";
import { BlueprintsModal } from "./components/BlueprintsModal";
import { AnalyticsView } from "./components/AnalyticsView";
import { TemplatesView } from "./components/TemplatesView";

export function App() {
  const workflow = useApp((s) => s.workflow);
  const error = useApp((s) => s.error);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const loadCatalog = useApp((s) => s.loadCatalog);
  const loadConnections = useApp((s) => s.loadConnections);
  const loadBlueprints = useApp((s) => s.loadBlueprints);

  useEffect(() => {
    void loadCatalog();
    void loadConnections();
    void loadBlueprints();
  }, [loadCatalog, loadConnections, loadBlueprints]);

  return (
    <div className="app">
      <div className="topbar">
        <h1>AI Workflow Builder</h1>
        <div className="view-switch">
          {(["builder", "analytics", "templates"] as const).map((v) => (
            <button
              key={v}
              className={view === v ? "active" : ""}
              onClick={() => setView(v)}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        {view === "builder" && workflow && (
          <span className="wf-name">/ {workflow.name}</span>
        )}
        <div className="spacer" />
        {view === "builder" && workflow && (
          <span className="wf-name">
            {workflow.graph.nodes.length} nodes · {workflow.graph.edges.length} edges
          </span>
        )}
      </div>
      {error && <div className="error-bar">{error}</div>}
      {view === "analytics" ? (
        <AnalyticsView />
      ) : view === "templates" ? (
        <TemplatesView />
      ) : (
        <div className="main">
          <ChatPanel />
          <div className="center">
            <Toolbar />
            <WorkflowCanvas />
          </div>
          <RightPanel />
        </div>
      )}
      <ConnectionsModal />
      <BlueprintsModal />
    </div>
  );
}
