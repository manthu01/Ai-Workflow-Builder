import { useEffect, useState } from "react";
import { useApp } from "../store";
import { NodeConfigPanel } from "./NodeConfigPanel";
import { RunPanel } from "./RunPanel";
import { DeployPanel } from "./DeployPanel";

type Tab = "inspector" | "run" | "deploy";

export function RightPanel() {
  const selectedNodeId = useApp((s) => s.selectedNodeId);
  const run = useApp((s) => s.run);
  const [tab, setTab] = useState<Tab>("run");

  useEffect(() => {
    if (selectedNodeId) setTab("inspector");
  }, [selectedNodeId]);
  useEffect(() => {
    if (run) setTab("run");
  }, [run]);

  return (
    <div className="rightpanel">
      <div className="tabs">
        {(["inspector", "run", "deploy"] as Tab[]).map((t) => (
          <button
            key={t}
            className={tab === t ? "tab active" : "tab"}
            onClick={() => setTab(t)}
          >
            {t === "inspector" ? "Inspector" : t === "run" ? "Run results" : "Deploy"}
          </button>
        ))}
      </div>
      <div className="rightpanel-body">
        {tab === "inspector" ? (
          <NodeConfigPanel />
        ) : tab === "run" ? (
          <RunPanel />
        ) : (
          <DeployPanel />
        )}
      </div>
    </div>
  );
}
