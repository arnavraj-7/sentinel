"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect } from "react";

import { AGENT_ICONS, AGENT_LABELS, AGENT_TAGLINES, FALLBACK_ICON } from "./icons";
import type { AgentState } from "@/lib/types";

type Props = {
  agent: AgentState | undefined;
  onClose: () => void;
};

// Right-side slide-in drawer. Opens when the user clicks a graph node.
// Smooth open/close + ESC to close + click-backdrop to close.

export function AgentDetail({ agent, onClose }: Props) {
  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <AnimatePresence>
      {agent && (
        <>
          {/* Click-out backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          />
          <motion.aside
            key="panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 280 }}
            className="
              fixed right-0 top-0 z-50 h-dvh w-full max-w-md
              border-l border-line bg-bg-elev shadow-2xl
              flex flex-col
            "
          >
            <DetailHeader agent={agent} onClose={onClose} />
            <DetailBody agent={agent} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function DetailHeader({ agent, onClose }: { agent: AgentState; onClose: () => void }) {
  const Icon = AGENT_ICONS[agent.name] ?? FALLBACK_ICON;
  const label = AGENT_LABELS[agent.name] ?? agent.name;
  const tagline = AGENT_TAGLINES[agent.name] ?? "";

  const tint =
    agent.status === "running" ? "bg-running/10 text-running ring-1 ring-running/30" :
    agent.status === "done"    ? "bg-success/10 text-success ring-1 ring-success/30" :
    agent.status === "error"   ? "bg-danger/10 text-danger ring-1 ring-danger/30" :
                                 "bg-bg-subtle text-fg-muted";

  return (
    <header className="flex items-start gap-3 border-b border-line px-5 py-4">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tint}`}>
        <Icon size={20} strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg font-semibold tracking-tight">{label}</h3>
          <StatusBadge status={agent.status} />
        </div>
        <p className="mt-0.5 text-xs text-fg-muted">{tagline}</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="
          inline-flex h-8 w-8 items-center justify-center rounded-md
          text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg
        "
        aria-label="Close"
      >
        <X size={16} />
      </button>
    </header>
  );
}

function StatusBadge({ status }: { status: AgentState["status"] }) {
  const map = {
    running: ["text-running bg-running/10 border-running/20",  "Running"],
    done:    ["text-success bg-success/10 border-success/20",  "Done"],
    error:   ["text-danger  bg-danger/10  border-danger/20",   "Error"],
    skipped: ["text-fg-subtle bg-bg-subtle border-line",       "Skipped"],
    idle:    ["text-fg-subtle bg-bg-subtle border-line",       "Queued"],
  } as const;
  const [cls, label] = map[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${cls}`}>
      {label}
    </span>
  );
}

function DetailBody({ agent }: { agent: AgentState }) {
  const hasProgress = agent.progress.length > 0;
  const hasThinking = !!agent.thinkingProcess;
  const hasFindings =
    agent.findings && Object.keys(agent.findings).filter(k => k !== "thinking_process").length > 0;
  const empty = !hasProgress && !hasThinking && !hasFindings && !agent.currentMessage;

  return (
    <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm">
      {agent.currentMessage && (
        <Section label="Currently">
          <p className={`font-mono text-xs ${agent.status === "running" ? "text-running live-cursor" : "text-fg-muted"}`}>
            {agent.currentMessage}
          </p>
        </Section>
      )}
      {hasProgress && (
        <Section label={`Activity (${agent.progress.length})`}>
          <ActivityLog progress={agent.progress} />
        </Section>
      )}
      {hasThinking && (
        <Section label="Thinking">
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-fg">
            {agent.thinkingProcess}
          </p>
        </Section>
      )}
      {hasFindings && (
        <Section label="Findings">
          <FindingsView findings={agent.findings!} />
        </Section>
      )}
      {empty && (
        <div className="rounded-lg border border-dashed border-line bg-bg-subtle/40 p-6 text-center text-xs text-fg-muted">
          No data yet — this agent hasn&apos;t run.
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
        {label}
      </p>
      {children}
    </section>
  );
}

function ActivityLog({ progress }: { progress: AgentState["progress"] }) {
  return (
    <ol className="space-y-1.5">
      {progress.map((p, i) => (
        <motion.li
          key={p.at + "-" + i}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          className="
            flex items-start gap-2.5 rounded-md border border-line bg-bg-subtle px-2.5 py-1.5
          "
        >
          <span className="font-mono text-[10px] uppercase text-fg-subtle min-w-[80px] truncate">
            {p.phase}
          </span>
          <span className="flex-1 text-[12px] text-fg leading-snug">
            {p.message ?? <span className="text-fg-subtle italic">—</span>}
          </span>
        </motion.li>
      ))}
    </ol>
  );
}

function FindingsView({ findings }: { findings: Record<string, unknown> }) {
  const entries = Object.entries(findings).filter(([k]) => k !== "thinking_process");
  return (
    <dl className="space-y-2.5 text-xs">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">{k}</dt>
          <dd className="mt-0.5">{renderValue(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function renderValue(v: unknown): React.ReactNode {
  if (v == null) return <span className="text-fg-subtle italic">null</span>;
  if (typeof v === "string") return <span className="text-fg">{v}</span>;
  if (typeof v === "number") return <span className="font-mono text-fg">{v.toString()}</span>;
  if (typeof v === "boolean") return <span className="font-mono">{v ? "true" : "false"}</span>;
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="text-fg-subtle italic">[]</span>;
    return (
      <ul className="list-disc space-y-1 pl-5 text-fg">
        {v.map((item, i) => <li key={i}>{renderValue(item)}</li>)}
      </ul>
    );
  }
  if (typeof v === "object") {
    return (
      <pre className="overflow-x-auto rounded border border-line bg-bg p-2 font-mono text-[10px] text-fg">
        {JSON.stringify(v, null, 2)}
      </pre>
    );
  }
  return String(v);
}
