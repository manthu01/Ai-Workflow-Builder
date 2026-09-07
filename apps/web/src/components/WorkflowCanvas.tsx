import { useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  useUpdateNodeInternals,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react";
import { useApp } from "../store";
import { StepNode } from "./StepNode";

const nodeTypes = { step: StepNode };
const NODE_W = 190;
const NODE_H = 60;

function Flow() {
  const workflow = useApp((s) => s.workflow);
  const run = useApp((s) => s.run);
  const issues = useApp((s) => s.issues);
  const selectedNodeId = useApp((s) => s.selectedNodeId);
  const setGraph = useApp((s) => s.setGraph);
  const persistNow = useApp((s) => s.persistNow);
  const selectNode = useApp((s) => s.selectNode);
  const deleteNode = useApp((s) => s.deleteNode);
  const deleteEdge = useApp((s) => s.deleteEdge);
  const connect = useApp((s) => s.connect);

  const { fitView } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  const statusByNode = useMemo(() => {
    const m = new Map<string, string>();
    run?.nodes.forEach((n) => m.set(n.nodeId, n.status));
    return m;
  }, [run]);

  const errorNodeIds = useMemo(
    () => new Set(issues.filter((i) => i.level === "error" && i.nodeId).map((i) => i.nodeId!)),
    [issues],
  );

  const nodes: Node[] = useMemo(
    () =>
      (workflow?.graph.nodes ?? []).map((n) => ({
        id: n.id,
        type: "step",
        position: n.position,
        selected: n.id === selectedNodeId,
        width: NODE_W,
        height: NODE_H,
        // Some environments never fire the ResizeObserver React Flow uses to
        // measure nodes, which also suppresses edges. Seed `measured`.
        measured: { width: NODE_W, height: NODE_H },
        data: {
          label: n.label,
          kind: n.kind,
          status: statusByNode.get(n.id),
          hasError: errorNodeIds.has(n.id),
        },
      })),
    [workflow, statusByNode, errorNodeIds, selectedNodeId],
  );

  const edges: Edge[] = useMemo(
    () =>
      (workflow?.graph.edges ?? []).map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle || undefined,
        label: e.sourceHandle || undefined,
        animated: statusByNode.get(e.target) === "succeeded",
        style: e.sourceHandle
          ? { stroke: e.sourceHandle === "true" ? "var(--ok)" : "var(--fail)" }
          : undefined,
      })),
    [workflow, statusByNode],
  );

  // Re-measure + reframe only when the graph's structure changes (nodes/edges
  // added or removed), never on every position tweak or selection change.
  const structureKey = workflow
    ? `${workflow.id}|${workflow.graph.nodes.map((n) => n.id).join(",")}|${workflow.graph.edges.length}`
    : "none";
  useEffect(() => {
    if (structureKey === "none") return;
    const ids = structureKey.split("|")[1]?.split(",").filter(Boolean) ?? [];
    const raf = requestAnimationFrame(() => {
      ids.forEach((id) => updateNodeInternals(id));
      requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 200 }));
    });
    return () => cancelAnimationFrame(raf);
  }, [structureKey, updateNodeInternals, fitView]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!workflow) return;
      let didMove = false;
      let settled = false;
      const byId = new Map(workflow.graph.nodes.map((n) => [n.id, n]));
      for (const ch of changes) {
        if (ch.type === "position" && ch.position) {
          const n = byId.get(ch.id);
          if (n) byId.set(ch.id, { ...n, position: ch.position });
          didMove = true;
          if (ch.dragging === false) settled = true;
        } else if (ch.type === "remove") {
          deleteNode(ch.id);
          return;
        }
        // Selection is driven by onNodeClick/onPaneClick; ignoring "select"
        // changes here avoids a feedback loop with the `selected` node prop.
      }
      if (didMove) {
        setGraph({ ...workflow.graph, nodes: [...byId.values()] });
        if (settled) void persistNow();
      }
    },
    [workflow, setGraph, persistNow, deleteNode],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const ch of changes) if (ch.type === "remove") deleteEdge(ch.id);
    },
    [deleteEdge],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (conn.source && conn.target) {
        connect(conn.source, conn.target, conn.sourceHandle ?? "");
      }
    },
    [connect],
  );

  if (!workflow) {
    return (
      <div className="empty">
        Describe a workflow in plain English on the left, then hit Compile.
        <br />
        <br />
        e.g. <em>"When a PR is merged, summarize it and post to #eng on Slack."</em>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={(_, n) => selectNode(n.id)}
      onPaneClick={() => selectNode(null)}
      fitView
      colorMode="dark"
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}

export function WorkflowCanvas() {
  return (
    <div className="canvas">
      <ReactFlowProvider>
        <Flow />
      </ReactFlowProvider>
    </div>
  );
}
