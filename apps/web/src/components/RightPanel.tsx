import { useEffect, useState } from "react";
import { useApp } from "../store";
import { NodeConfigPanel } from "./NodeConfigPanel";
import { RunPanel } from "./RunPanel";

export function RightPanel() {
  const selectedNodeId = useApp((s) => s.selectedNodeId);
  const run = useApp((s) => s.run);
  const [tab, setTab] = useState<"inspector" | "run">("run");

  useEffect(() => {
    if (selectedNodeId) setTab("inspector");
  }, [selectedNodeId]);
  useEffect(() => {
    if (run) setTab("run");
  }, [run]);

  return (
    <div className="rightpanel">
      <div className="tabs">
        <button
          className={tab === "inspector" ? "tab active" : "tab"}
          onClick={() => setTab("inspector")}
        >
          Inspector
        </button>
        <button
          className={tab === "run" ? "tab active" : "tab"}
          onClick={() => setTab("run")}
        >
          Run results
        </button>
      </div>
      <div className="rightpanel-body">
        {tab === "inspector" ? <NodeConfigPanel /> : <RunPanel />}
      </div>
    </div>
  );
}
