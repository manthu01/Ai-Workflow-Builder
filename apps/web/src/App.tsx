import { useEffect } from "react";
import { useApp } from "./store";
import { ChatPanel } from "./components/ChatPanel";
import { Toolbar } from "./components/Toolbar";
import { WorkflowCanvas } from "./components/WorkflowCanvas";
import { RightPanel } from "./components/RightPanel";
import { ConnectionsModal } from "./components/ConnectionsModal";
import { AnalyticsView } from "./components/AnalyticsView";

export function App() {
  const workflow = useApp((s) => s.workflow);
  const error = useApp((s) => s.error);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const loadCatalog = useApp((s) => s.loadCatalog);
  const loadConnections = useApp((s) => s.loadConnections);

  useEffect(() => {
    void loadCatalog();
    void loadConnections();
  }, [loadCatalog, loadConnections]);

  return (
    <div className="app">
      <div className="topbar">
        <h1>AI Workflow Builder</h1>
        <div className="view-switch">
          <button
            className={view === "builder" ? "active" : ""}
            onClick={() => setView("builder")}
          >
            Builder
          </button>
          <button
            className={view === "analytics" ? "active" : ""}
            onClick={() => setView("analytics")}
          >
            Analytics
          </button>
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
    </div>
  );
}
