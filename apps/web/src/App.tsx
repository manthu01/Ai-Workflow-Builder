import { useApp } from "./store";
import { ChatPanel } from "./components/ChatPanel";
import { WorkflowCanvas } from "./components/WorkflowCanvas";
import { RunPanel } from "./components/RunPanel";

export function App() {
  const workflow = useApp((s) => s.workflow);
  const error = useApp((s) => s.error);

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
        <WorkflowCanvas />
        <RunPanel />
      </div>
    </div>
  );
}
