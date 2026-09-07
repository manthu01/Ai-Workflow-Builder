import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  useReactFlow,
  useUpdateNodeInternals,
  type Node,
  type Edge,
  type NodeChange,
} from "@xyflow/react";
import { useApp } from "../store";
import { StepNode } from "./StepNode";

const nodeTypes = { step: StepNode };
const NODE_W = 190;
const NODE_H = 60;

function Flow() {
  const workflow = useApp((s) => s.workflow);
  const run = useApp((s) => s.run);
  const setGraph = useApp((s) => s.setGraph);
  const persistGraph = useApp((s) => s.persistGraph);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { fitView } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  const statusByNode = useMemo(() => {
    const m = new Map<string, string>();
    run?.nodes.forEach((n) => m.set(n.nodeId, n.status));
    return m;
  }, [run]);

  const nodes: Node[] = useMemo(
    () =>
      (workflow?.graph.nodes ?? []).map((n) => ({
        id: n.id,
        type: "step",
        position: n.position,
        width: NODE_W,
        height: NODE_H,
        // Some environments (notably headless/occluded tabs) never fire the
        // ResizeObserver React Flow relies on to measure nodes, which also
        // suppresses edge rendering. Seed `measured` so layout is deterministic.
        measured: { width: NODE_W, height: NODE_H },
        data: { label: n.label, kind: n.kind, status: statusByNode.get(n.id) },
      })),
    [workflow, statusByNode],
  );

  const edges: Edge[] = useMemo(
    () =>
      (workflow?.graph.edges ?? []).map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        animated: statusByNode.get(e.target) === "succeeded",
      })),
    [workflow, statusByNode],
  );

  // React Flow occasionally skips its initial handle measurement in this setup;
  // nudge it to re-measure every node whenever the graph identity changes, then
  // frame the result.
  const graphKey = workflow?.id ?? "none";
  useEffect(() => {
    if (!workflow) return;
    const ids = workflow.graph.nodes.map((n) => n.id);
    const raf = requestAnimationFrame(() => {
      ids.forEach((id) => updateNodeInternals(id));
      requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 200 }));
    });
    return () => cancelAnimationFrame(raf);
  }, [graphKey, workflow, updateNodeInternals, fitView]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!workflow) return;
      const next = applyNodeChanges(changes, nodes);
      const moved = next.map((n) => {
        const orig = workflow.graph.nodes.find((g) => g.id === n.id)!;
        return { ...orig, position: n.position };
      });
      setGraph({ ...workflow.graph, nodes: moved });

      if (changes.some((ch) => ch.type === "position" && ch.dragging === false)) {
        if (persistTimer.current) clearTimeout(persistTimer.current);
        persistTimer.current = setTimeout(() => void persistGraph(), 400);
      }
    },
    [workflow, nodes, setGraph, persistGraph],
  );

  useEffect(
    () => () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    },
    [],
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
