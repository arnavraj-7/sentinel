"use client";

import * as Collapsible from "@radix-ui/react-collapsible";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, ChevronDown, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useState } from "react";

import { AGENT_ICONS, AGENT_LABELS, AGENT_TAGLINES, FALLBACK_ICON } from "./icons";
import type { AgentState } from "@/lib/types";

type Props = { agent: AgentState };

function StatusDot({ status }: { status: AgentState["status"] }) {
  if (status === "running") {
    return (
      <span className="relative inline-flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-running pulse-ring" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-running" />
      </span>
    );
  }
  if (status === "done") {
    return <CheckCircle2 size={14} className="text-success" strokeWidth={2.5} />;
  }
  if (status === "error") {
    return <AlertCircle size={14} className="text-danger" strokeWidth={2.5} />;
  }
  return <span className="inline-block h-2.5 w-2.5 rounded-full bg-fg-subtle/40" />;
}

function StatusLabel({ status }: { status: AgentState["status"] }) {
  const map = {
    running: ["text-running",  "running"],
    done:    ["text-success",  "done"],
    error:   ["text-danger",   "error"],
    skipped: ["text-fg-subtle","skipped"],
    idle:    ["text-fg-subtle","queued"],
  } as const;
  const [cls, label] = map[status];
  return (
    <span className={`text-[10px] uppercase tracking-wider font-medium ${cls}`}>
      {label}
    </span>
  );
}

export function AgentRow({ agent }: Props) {
  const Icon = AGENT_ICONS[agent.name] ?? FALLBACK_ICON;
  const label = AGENT_LABELS[agent.name] ?? agent.name;
  const tagline = AGENT_TAGLINES[agent.name] ?? "";

  const [openProgress, setOpenProgress] = useState(false);
  const [openThinking, setOpenThinking] = useState(false);
  const [openFindings, setOpenFindings] = useState(false);

  const hasProgress = agent.progress.length > 0;
  const hasThinking = !!agent.thinkingProcess;
  const hasFindings = agent.findings && Object.keys(agent.findings).length > 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`
        relative rounded-xl border border-line bg-bg-elev
        ${agent.status === "running" ? "shadow-[var(--shadow-elev)] ring-1 ring-running/20" : "shadow-[var(--shadow-card)]"}
        transition-shadow
      `}
    >
      {/* Left status bar — thin coloured stripe */}
      <span
        className={`
          absolute left-0 top-0 h-full w-1 rounded-l-xl
          ${agent.status === "running" ? "bg-running" :
            agent.status === "done"    ? "bg-success" :
            agent.status === "error"   ? "bg-danger" : "bg-line"}
        `}
      />

      <div className="flex items-start gap-4 p-4">
        <div className={`
          flex h-9 w-9 shrink-0 items-center justify-center rounded-lg
          ${agent.status === "running" ? "bg-running/10 text-running" :
            agent.status === "done"    ? "bg-success/10 text-success" :
            agent.status === "error"   ? "bg-danger/10 text-danger" :
            "bg-bg-subtle text-fg-muted"}
        `}>
          <Icon size={17} strokeWidth={2} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span className="font-display text-sm font-semibold tracking-tight text-fg">{label}</span>
            <StatusDot status={agent.status} />
            <StatusLabel status={agent.status} />
          </div>
          <p className="mt-0.5 text-xs text-fg-muted">{tagline}</p>

          {/* Live progress line — what the agent is currently doing */}
          {agent.currentMessage && agent.status === "running" && (
            <p className="mt-2 font-mono text-xs text-running live-cursor">
              {agent.currentMessage}
            </p>
          )}
          {agent.currentMessage && agent.status === "done" && (
            <p className="mt-2 font-mono text-xs text-fg-muted">
              {agent.currentMessage}
            </p>
          )}

          {/* Expandable sections */}
          <div className="mt-3 flex flex-wrap gap-2">
            {hasProgress && (
              <ExpandableChip
                open={openProgress}
                setOpen={setOpenProgress}
                count={agent.progress.length}
                label="Activity"
              />
            )}
            {hasThinking && (
              <ExpandableChip
                open={openThinking}
                setOpen={setOpenThinking}
                label="Thinking"
              />
            )}
            {hasFindings && (
              <ExpandableChip
                open={openFindings}
                setOpen={setOpenFindings}
                label="Findings"
              />
            )}
          </div>

          {/* Bodies */}
          <Collapsible.Root open={openProgress} onOpenChange={setOpenProgress}>
            <Collapsible.Content>
              <ActivityLog progress={agent.progress} />
            </Collapsible.Content>
          </Collapsible.Root>

          <Collapsible.Root open={openThinking} onOpenChange={setOpenThinking}>
            <Collapsible.Content>
              <BodyBlock>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-fg">
                  {agent.thinkingProcess}
                </p>
              </BodyBlock>
            </Collapsible.Content>
          </Collapsible.Root>

          <Collapsible.Root open={openFindings} onOpenChange={setOpenFindings}>
            <Collapsible.Content>
              <BodyBlock>
                <FindingsView findings={agent.findings ?? {}} />
              </BodyBlock>
            </Collapsible.Content>
          </Collapsible.Root>
        </div>
      </div>
    </motion.div>
  );
}

function ExpandableChip({
  open, setOpen, count, label,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  count?: number;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className={`
        inline-flex items-center gap-1 rounded-md border border-line
        px-2 py-1 text-[11px] font-medium text-fg-muted
        transition-colors hover:bg-bg-subtle hover:text-fg
      `}
    >
      {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      {label}
      {count != null && (
        <span className="ml-1 rounded bg-bg-subtle px-1 font-mono text-[10px] text-fg-muted">
          {count}
        </span>
      )}
    </button>
  );
}

function BodyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-md border border-line bg-bg-subtle p-3">
      {children}
    </div>
  );
}

function ActivityLog({
  progress,
}: {
  progress: AgentState["progress"];
}) {
  return (
    <div className="mt-3 max-h-64 overflow-y-auto rounded-md border border-line bg-bg-subtle">
      <ol className="divide-y divide-line">
        <AnimatePresence initial={false}>
          {progress.map((p, i) => (
            <motion.li
              key={p.at + "-" + i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-start gap-3 px-3 py-2 text-xs"
            >
              <span className="font-mono text-[10px] text-fg-subtle min-w-[44px]">
                {fmtRelative(p.at)}
              </span>
              <span className="font-mono text-[10px] uppercase text-fg-muted min-w-[100px] truncate">
                {p.phase}
              </span>
              <span className="text-fg flex-1">
                {p.message ?? <span className="text-fg-subtle italic">—</span>}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  );
}

function fmtRelative(at: number): string {
  const sec = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (sec < 60) return `${sec}s ago`;
  return `${Math.round(sec / 60)}m ago`;
}

function FindingsView({ findings }: { findings: Record<string, unknown> }) {
  const entries = Object.entries(findings).filter(([k]) => k !== "thinking_process");
  if (entries.length === 0) {
    return <p className="text-xs italic text-fg-subtle">No structured findings yet.</p>;
  }
  return (
    <dl className="grid grid-cols-1 gap-2 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-1">
          <dt className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
            {k}
          </dt>
          <dd className="text-fg">
            {renderValue(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function renderValue(v: unknown): React.ReactNode {
  if (v == null) return <span className="text-fg-subtle italic">null</span>;
  if (typeof v === "string") return v;
  if (typeof v === "number") return v.toString();
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="text-fg-subtle italic">[]</span>;
    return (
      <ul className="list-disc pl-5">
        {v.map((item, i) => (
          <li key={i}>{renderValue(item)}</li>
        ))}
      </ul>
    );
  }
  if (typeof v === "object") {
    return (
      <pre className="overflow-x-auto rounded bg-bg p-2 font-mono text-[10px]">
        {JSON.stringify(v, null, 2)}
      </pre>
    );
  }
  return String(v);
}
