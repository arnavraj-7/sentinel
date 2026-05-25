"use client";

// Left-rail agent list. Always visible during a run. Topological order
// (matches the graph) so users build a mental map of the flow. Click any
// row to open AgentDetail (drawer).

import { AGENT_ICONS, AGENT_LABELS, FALLBACK_ICON } from "./icons";
import type { AgentStatus, IncidentState } from "@/lib/types";

// Topological order — matches the graph layout, not the chronological
// order things appeared (which would shuffle parallel investigators).
// code_fixer + sandbox_verifier are sub-graph nodes (children of
// code_patch); rendered slightly indented to communicate the hierarchy.
const ORDER: Array<{ name: string; nested?: boolean }> = [
  { name: "triager" },
  { name: "log_detective" },
  { name: "metric_analyst" },
  { name: "topology_mapper" },
  { name: "root_cause_analyst" },
  { name: "critic" },
  { name: "human_approval_rca" },
  { name: "planner" },
  { name: "human_approval_plan" },
  { name: "executor" },
  { name: "code_patch" },
  { name: "code_fixer",       nested: true },
  { name: "sandbox_verifier", nested: true },
  { name: "verifier" },
  { name: "post_mortem" },
];

export function AgentList({
  incident,
  onSelect,
  selected,
}: {
  incident: IncidentState;
  onSelect: (name: string) => void;
  selected?: string;
}) {
  return (
    <aside className="
      flex flex-col rounded-xl border border-line bg-bg-elev
      shadow-[var(--shadow-card)] overflow-hidden
    ">
      <div className="border-b border-line px-4 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          Agents
        </span>
      </div>
      <ul className="flex flex-col gap-0.5 p-2 overflow-y-auto min-h-0">
        {ORDER.map(({ name, nested }) => {
          const agent = incident.agents[name];
          const status: AgentStatus = agent?.status ?? "idle";
          const Icon = AGENT_ICONS[name] ?? FALLBACK_ICON;
          const label = AGENT_LABELS[name] ?? name;
          const isSelected = selected === name;

          return (
            // Indent on the LI so the selection ring + hover bg align
            // with the indented button — otherwise the highlighted row
            // appears wider than its siblings (image feedback).
            <li
              key={name}
              className={`relative ${nested ? "pl-4" : ""}`}
            >
              {nested && (
                // Tree-style vertical connector — left edge of nested
                // rows links visually to the parent (code_patch).
                <span
                  aria-hidden
                  className="absolute left-1.5 top-0 bottom-0 w-px bg-line"
                />
              )}
              <button
                type="button"
                onClick={() => onSelect(name)}
                className={`
                  group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2
                  text-left text-[12.5px] font-medium
                  transition-colors
                  ${isSelected
                    ? "bg-bg-subtle text-fg ring-1 ring-line-strong"
                    : "text-fg-muted hover:bg-bg-subtle hover:text-fg"}
                `}
              >
                <div className={`
                  flex h-6 w-6 shrink-0 items-center justify-center rounded
                  ${status === "running" ? "bg-running/10 text-running" :
                    status === "done"    ? "bg-success/10 text-success" :
                    status === "error"   ? "bg-danger/10 text-danger" :
                                           "bg-bg-subtle text-fg-subtle"}
                `}>
                  <Icon size={12} strokeWidth={2} />
                </div>
                <span className="flex-1 truncate">{label}</span>
                <StatusDot status={status} />
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function StatusDot({ status }: { status: AgentStatus }) {
  if (status === "running") {
    return (
      <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full bg-running pulse-ring" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-running" />
      </span>
    );
  }
  if (status === "done") {
    return <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-success" />;
  }
  if (status === "error") {
    return <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />;
  }
  return <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-fg-subtle/30" />;
}
