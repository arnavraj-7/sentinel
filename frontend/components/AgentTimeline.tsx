"use client";

import { AnimatePresence } from "framer-motion";
import { AgentRow } from "./AgentRow";
import type { IncidentState } from "@/lib/types";

export function AgentTimeline({ incident }: { incident: IncidentState }) {
  const agents = incident.agentOrder.map(name => incident.agents[name]);
  if (agents.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-display text-sm font-semibold tracking-tight text-fg">
        Agent timeline
        <span className="ml-2 text-xs font-normal text-fg-muted">
          {agents.length} {agents.length === 1 ? "agent" : "agents"} active
        </span>
      </h3>
      <AnimatePresence initial={false}>
        {agents.map(agent => (
          <AgentRow key={agent.name} agent={agent} />
        ))}
      </AnimatePresence>
    </div>
  );
}
