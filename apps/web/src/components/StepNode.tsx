import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { NodeKind, NodeRunStatus } from "../types";

export interface StepNodeData {
  label: string;
  kind: NodeKind;
  status?: NodeRunStatus;
  [key: string]: unknown;
}

const KIND_LABEL: Record<NodeKind, string> = {
  trigger: "Trigger",
  llm: "LLM Step",
  http_request: "HTTP Request",
  transform: "Transform",
  slack_post: "Post to Slack",
};

export function StepNode({ data }: NodeProps) {
  const d = data as StepNodeData;
  const status = d.status ?? "";
  return (
    <div className={`step-node ${status}`}>
      {d.kind !== "trigger" && <Handle type="target" position={Position.Left} />}
      <div className="kind">{KIND_LABEL[d.kind]}</div>
      <div className="label">{d.label}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
