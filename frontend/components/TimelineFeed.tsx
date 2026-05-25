"use client";

// Vertical event feed — chronological, top-to-bottom, newest at the
// bottom. Replaces the horizontally-scrolling LiveTrail that was hard to
// read. Auto-scrolls to bottom when new events arrive (only if the user
// hadn't scrolled away — respect their reading position).

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";

import { AGENT_ICONS, AGENT_LABELS, FALLBACK_ICON } from "./icons";
import type { IncidentState } from "@/lib/types";

type TimelineEvent = {
  key: string;
  agent: string;
  phase: string;
  message?: string;
  at: number;
};

export function TimelineFeed({ incident }: { incident: IncidentState }) {
  // Aggregate every agent's progress entries, sort chronologically.
  const events: TimelineEvent[] = [];
  for (const name of incident.agentOrder) {
    const agent = incident.agents[name];
    if (!agent) continue;
    for (let i = 0; i < agent.progress.length; i++) {
      const p = agent.progress[i];
      events.push({
        key: `${name}-${p.at}-${i}`,
        agent: name,
        phase: p.phase,
        message: p.message,
        at: p.at,
      });
    }
  }
  events.sort((a, b) => a.at - b.at);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  // Track whether user has scrolled away from the bottom — only auto-scroll
  // if they're "stuck" at the bottom (reading the latest).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distance < 24;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [events.length]);

  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-bg-subtle">
            <Sparkles size={16} className="text-fg-subtle" />
          </div>
          <p className="text-sm text-fg-muted">No events yet</p>
          <p className="mt-1 text-xs text-fg-subtle">
            Pick a scenario above to start streaming
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <ul className="flex flex-col">
        <AnimatePresence initial={false}>
          {events.map(e => <TimelineRow key={e.key} event={e} />)}
        </AnimatePresence>
      </ul>
    </div>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  const Icon = AGENT_ICONS[event.agent] ?? FALLBACK_ICON;
  const label = AGENT_LABELS[event.agent] ?? event.agent;
  const ts = new Date(event.at).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="
        flex items-start gap-3 border-b border-line/40 px-4 py-2.5
        transition-colors hover:bg-bg-subtle/40
      "
    >
      <span className="
        flex h-7 w-7 shrink-0 items-center justify-center rounded-md
        bg-bg-subtle text-accent
      ">
        <Icon size={12} strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider">
          <span className="font-mono font-medium text-fg">{label}</span>
          <span className="font-mono text-fg-subtle">·</span>
          <span className="font-mono text-fg-subtle truncate">{event.phase}</span>
          <span className="ml-auto font-mono text-fg-subtle whitespace-nowrap">{ts}</span>
        </div>
        {event.message && (
          <p className="mt-0.5 text-[12.5px] leading-snug text-fg">
            {event.message}
          </p>
        )}
      </div>
    </motion.li>
  );
}
