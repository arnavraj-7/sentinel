"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CheckCircle2, AlertCircle } from "lucide-react";

import { AGENT_ICONS, AGENT_LABELS, FALLBACK_ICON } from "./icons";
import type { AgentStatus } from "@/lib/types";

export type AgentNodeData = {
  name: string;
  status: AgentStatus;
  currentMessage?: string;
  onSelect?: (name: string) => void;
};

// Custom node renderer. react-flow gives us positioning; this component
// owns the visual identity. Status drives colour, ring, and pulse.
function AgentNodeImpl({ data, selected }: NodeProps) {
  const d = data as AgentNodeData;
  const Icon = AGENT_ICONS[d.name] ?? FALLBACK_ICON;
  const label = AGENT_LABELS[d.name] ?? d.name;

  const statusClass =
    d.status === "running" ? "node-running" :
    d.status === "done"    ? "node-done" :
    d.status === "error"   ? "node-error" :
                             "node-idle";

  const indicator =
    d.status === "running" ? <RunningDot /> :
    d.status === "done"    ? <CheckCircle2 size={11} className="text-success" strokeWidth={3} /> :
    d.status === "error"   ? <AlertCircle size={11} className="text-danger" strokeWidth={3} /> :
                             <IdleDot />;

  return (
    <div
      onClick={() => d.onSelect?.(d.name)}
      className={`
        graph-node ${statusClass}
        ${selected ? "ring-2 ring-accent" : ""}
        group relative w-[180px] cursor-pointer select-none rounded-xl border
        bg-bg-elev px-3 py-2.5
        transition-all duration-200
        hover:-translate-y-0.5 hover:shadow-[var(--shadow-elev)]
      `}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: "var(--line-strong)", border: "none", width: 6, height: 6 }}
      />

      <div className="flex items-center gap-2">
        <div className={`
          flex h-7 w-7 shrink-0 items-center justify-center rounded-md
          ${d.status === "running" ? "bg-running/10 text-running" :
            d.status === "done"    ? "bg-success/10 text-success" :
            d.status === "error"   ? "bg-danger/10 text-danger" :
                                     "bg-bg-subtle text-fg-muted"}
        `}>
          <Icon size={14} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[12px] font-semibold leading-tight text-fg">
            {label}
          </p>
          <p className="font-mono text-[9px] uppercase tracking-wider text-fg-subtle">
            {d.status === "idle" ? "queued" : d.status}
          </p>
        </div>
        <span className="shrink-0">{indicator}</span>
      </div>

      {d.currentMessage && d.status === "running" && (
        <p
          className="mt-1.5 truncate font-mono text-[10px] text-running"
          title={d.currentMessage}
        >
          {d.currentMessage}
        </p>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: "var(--line-strong)", border: "none", width: 6, height: 6 }}
      />
    </div>
  );
}

function RunningDot() {
  return (
    <span className="relative inline-flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full rounded-full bg-running pulse-ring" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-running" />
    </span>
  );
}

function IdleDot() {
  return <span className="inline-block h-2 w-2 rounded-full bg-fg-subtle/30" />;
}

export const AgentNode = memo(AgentNodeImpl);
