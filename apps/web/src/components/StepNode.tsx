import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { NodeKind, NodeRunStatus } from "../types";

export interface StepNodeData {
  label: string;
  kind: NodeKind;
  status?: NodeRunStatus;
  hasError?: boolean;
  [key: string]: unknown;
}

const KIND_LABEL: Record<NodeKind, string> = {
  trigger: "Trigger",
  llm: "LLM Step",
  http_request: "HTTP Request",
  transform: "Transform",
  branch: "Branch",
  loop: "Loop",
  code: "Code",
  asset: "2D Asset",
  api_call: "API call",
  approval: "Approval",
  slack_post: "Post to Slack",
};

export function StepNode({ data, selected }: NodeProps) {
  const d = data as StepNodeData;
  const isBranch = d.kind === "branch";
  const cls = [
    "step-node",
    isBranch ? "branch" : "",
    d.status ?? "",
    d.hasError ? "invalid" : "",
    selected ? "selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      {d.kind !== "trigger" && <Handle type="target" position={Position.Left} />}
      <div className="kind">
        {KIND_LABEL[d.kind]}
        {d.hasError && <span className="node-err" title="Has configuration errors">!</span>}
      </div>
      <div className="label">{d.label}</div>

      {isBranch ? (
        <>
          <Handle
            id="true"
            type="source"
            position={Position.Right}
            style={{ top: "35%" }}
          />
          <span className="branch-tag t">true</span>
          <Handle
            id="false"
            type="source"
            position={Position.Right}
            style={{ top: "70%" }}
          />
          <span className="branch-tag f">false</span>
        </>
      ) : (
        <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}
