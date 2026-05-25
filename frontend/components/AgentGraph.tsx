"use client";

import "@xyflow/react/dist/style.css";

import { useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
} from "@xyflow/react";

import { AgentNode, type AgentNodeData } from "./AgentNode";
import { EnergyEdge, type EnergyEdgeData } from "./EnergyEdge";
import type { IncidentState } from "@/lib/types";

// ── Graph topology ──────────────────────────────────────────────────────────
// Static positions for every node Sentinel can run. Status (idle/running/
// done/error) is layered on top from incident state.

const NODE_POS: Record<string, { x: number; y: number }> = {
  triager:              { x: 320, y:   0 },
  log_detective:        { x:  80, y: 120 },
  metric_analyst:       { x: 320, y: 120 },
  topology_mapper:      { x: 560, y: 120 },
  root_cause_analyst:   { x: 320, y: 240 },
  critic:               { x: 320, y: 360 },
  human_approval_rca:   { x: 320, y: 480 },
  planner:              { x: 320, y: 600 },
  human_approval_plan:  { x: 320, y: 720 },
  executor:             { x: 320, y: 840 },
  code_patch:           { x: 560, y: 840 },
  code_fixer:           { x: 760, y: 960 },
  sandbox_verifier:     { x: 560, y: 960 },
  verifier:             { x: 320, y: 1020 },
  finalize:             { x: 320, y: 1140 },
  post_mortem:          { x: 320, y: 1260 },
};

const TOPOLOGY: Array<[string, string]> = [
  ["triager", "log_detective"],
  ["triager", "metric_analyst"],
  ["triager", "topology_mapper"],
  ["log_detective", "root_cause_analyst"],
  ["metric_analyst", "root_cause_analyst"],
  ["topology_mapper", "root_cause_analyst"],
  ["root_cause_analyst", "critic"],
  ["critic", "human_approval_rca"],
  ["human_approval_rca", "planner"],
  ["planner", "human_approval_plan"],
  ["human_approval_plan", "executor"],
  ["executor", "code_patch"],
  ["code_patch", "code_fixer"],
  ["code_fixer", "sandbox_verifier"],
  ["sandbox_verifier", "code_patch"],   // retry loop
  ["code_patch", "verifier"],
  ["executor", "verifier"],             // when plan has no code patch
  ["verifier", "finalize"],
  ["finalize", "post_mortem"],
];

const NODE_TYPES = { agent: AgentNode };
const EDGE_TYPES = { energy: EnergyEdge };

type Props = {
  incident: IncidentState;
  onNodeClick: (name: string) => void;
  selected?: string;
};

// ── The graph itself ────────────────────────────────────────────────────────
// Wrapped in <ReactFlowProvider> so any descendant can call useReactFlow().

export function AgentGraph(props: Props) {
  return (
    <ReactFlowProvider>
      <AgentGraphInner {...props} />
    </ReactFlowProvider>
  );
}

function AgentGraphInner({ incident, onNodeClick, selected }: Props) {
  const initialNodes: Node[] = useMemo(() => buildNodes(incident, onNodeClick, selected), []); // eslint-disable-line react-hooks/exhaustive-deps
  const initialEdges: Edge[] = useMemo(() => buildEdges(incident), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { fitView } = useReactFlow();

  // Re-derive nodes/edges from incident state. Position is preserved
  // (deliberately static layout); only `data` changes to reflect status.
  useEffect(() => {
    setNodes(buildNodes(incident, onNodeClick, selected));
    setEdges(buildEdges(incident));
  }, [incident, onNodeClick, selected, setNodes, setEdges]);

  // On first render, fit the whole graph to the viewport.
  useEffect(() => {
    const id = setTimeout(() => fitView({ duration: 400, padding: 0.18 }), 60);
    return () => clearTimeout(id);
  }, [fitView]);

  return (
    <div className="
      relative h-[600px] w-full overflow-hidden rounded-xl border border-line
      bg-bg-elev shadow-[var(--shadow-card)]
    ">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.4}
        maxZoom={1.4}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="color-mix(in srgb, var(--line) 60%, transparent)"
        />
        <Controls
          showInteractive={false}
          className="!border-line !bg-bg-elev !shadow-[var(--shadow-card)]"
        />
      </ReactFlow>
    </div>
  );
}

// ── Node + edge builders ────────────────────────────────────────────────────

function buildNodes(
  incident: IncidentState,
  onSelect: (name: string) => void,
  selected?: string,
): Node[] {
  return Object.entries(NODE_POS).map(([name, position]) => {
    const agent = incident.agents[name];
    const status = agent?.status ?? "idle";
    return {
      id: name,
      type: "agent",
      position,
      selected: selected === name,
      data: {
        name,
        status,
        currentMessage: agent?.currentMessage,
        onSelect,
      } satisfies AgentNodeData,
    };
  });
}

function buildEdges(incident: IncidentState): Edge[] {
  return TOPOLOGY.map(([source, target]) => {
    const srcStatus  = incident.agents[source]?.status ?? "idle";
    const tgtStatus  = incident.agents[target]?.status ?? "idle";

    let status: EnergyEdgeData["status"] = "idle";
    if (tgtStatus === "running") status = "active";
    else if (tgtStatus === "done" && srcStatus === "done") status = "done";
    else if (tgtStatus === "error") status = "error";

    return {
      id: `${source}->${target}`,
      source,
      target,
      type: "energy",
      data: { status } satisfies EnergyEdgeData,
    };
  });
}
