"use client";

import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, Sparkles } from "lucide-react";

import { AGENT_ICONS, AGENT_LABELS, FALLBACK_ICON } from "./icons";
import type { IncidentState } from "@/lib/types";

// Bottom strip showing the most recent N events as a live, auto-scrolling
// trail. Events come from custom writer payloads collected on each agent's
// `progress` list. Aggregated across agents and sorted by timestamp.

const MAX_EVENTS = 30;

type TrailEvent = {
  key: string;
  agent: string;
  phase: string;
  message?: string;
  at: number;
};

export function LiveTrail({ incident }: { incident: IncidentState }) {
  const events: TrailEvent[] = useMemo(() => {
    const out: TrailEvent[] = [];
    for (const name of incident.agentOrder) {
      const a = incident.agents[name];
      if (!a) continue;
      for (let i = 0; i < a.progress.length; i++) {
        const p = a.progress[i];
        out.push({
          key: `${name}-${p.at}-${i}`,
          agent: name,
          phase: p.phase,
          message: p.message,
          at: p.at,
        });
      }
    }
    out.sort((a, b) => a.at - b.at);
    return out.slice(-MAX_EVENTS);
  }, [incident]);

  // Auto-scroll to newest event
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }, [events.length]);

  const empty = events.length === 0;

  return (
    <div className="
      rounded-xl border border-line bg-bg-elev p-3 shadow-[var(--shadow-card)]
    ">
      <div className="mb-2 flex items-center gap-2">
        <Activity size={12} strokeWidth={2.5} className="text-running" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          Live trail
        </span>
        <span className="font-mono text-[10px] text-fg-subtle">·</span>
        <span className="font-mono text-[10px] text-fg-subtle">
          {empty ? "no events yet" : `${events.length} recent`}
        </span>
      </div>

      {empty ? (
        <div className="flex items-center gap-2 px-2 py-3 text-xs text-fg-muted">
          <Sparkles size={12} className="text-fg-subtle" />
          Pick a scenario above — custom writer events from the graph will
          appear here as they happen.
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="
            flex gap-2 overflow-x-auto pb-1
            scrollbar-thin
          "
        >
          <AnimatePresence initial={false}>
            {events.map(evt => <TrailPill key={evt.key} evt={evt} />)}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function TrailPill({ evt }: { evt: TrailEvent }) {
  const Icon = AGENT_ICONS[evt.agent] ?? FALLBACK_ICON;
  const label = AGENT_LABELS[evt.agent] ?? evt.agent;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 20, scale: 0.94 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="
        flex shrink-0 items-center gap-2 rounded-md border border-line
        bg-bg-subtle px-2.5 py-1.5
      "
    >
      <Icon size={11} className="text-accent" strokeWidth={2} />
      <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      <span className="font-mono text-[9px] uppercase text-fg-subtle">
        · {evt.phase}
      </span>
      {evt.message && (
        <span className="max-w-[280px] truncate text-[11px] text-fg">
          {evt.message}
        </span>
      )}
    </motion.div>
  );
}
