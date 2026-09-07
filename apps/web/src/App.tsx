import { useEffect } from "react";
import { useApp } from "./store";
import { ChatPanel } from "./components/ChatPanel";
import { Toolbar } from "./components/Toolbar";
import { WorkflowCanvas } from "./components/WorkflowCanvas";
import { RightPanel } from "./components/RightPanel";

export function App() {
  const workflow = useApp((s) => s.workflow);
  const error = useApp((s) => s.error);
  const loadCatalog = useApp((s) => s.loadCatalog);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  return (
    <div className="app">
      <div className="topbar">
        <h1>AI Workflow Builder</h1>
        {workflow && <span className="wf-name">/ {workflow.name}</span>}
        <div className="spacer" />
        {workflow && (
          <span className="wf-name">
            {workflow.graph.nodes.length} nodes · {workflow.graph.edges.length} edges
          </span>
        )}
      </div>
      {error && <div className="error-bar">{error}</div>}
      <div className="main">
        <ChatPanel />
        <div className="center">
          <Toolbar />
          <WorkflowCanvas />
        </div>
        <RightPanel />
      </div>
    </div>
  );
}
