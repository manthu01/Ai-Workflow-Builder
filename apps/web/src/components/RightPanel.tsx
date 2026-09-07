import { useEffect, useState } from "react";
import { useApp } from "../store";
import { NodeConfigPanel } from "./NodeConfigPanel";
import { RunPanel } from "./RunPanel";
import { DeployPanel } from "./DeployPanel";
import { HistoryPanel } from "./HistoryPanel";

type Tab = "inspector" | "run" | "deploy" | "history";
const LABELS: Record<Tab, string> = {
  inspector: "Inspector",
  run: "Run",
  deploy: "Deploy",
  history: "History",
};

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
        {(["inspector", "run", "deploy", "history"] as Tab[]).map((t) => (
          <button
            key={t}
            className={tab === t ? "tab active" : "tab"}
            onClick={() => setTab(t)}
          >
            {LABELS[t]}
          </button>
        ))}
      </div>
      <div className="rightpanel-body">
        {tab === "inspector" ? (
          <NodeConfigPanel />
        ) : tab === "run" ? (
          <RunPanel />
        ) : tab === "deploy" ? (
          <DeployPanel />
        ) : (
          <HistoryPanel />
        )}
      </div>
    </div>
  );
}
