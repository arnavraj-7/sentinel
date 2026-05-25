"use client";

// Sticky HITL banner — pinned to the top of the dashboard area when the
// graph is paused at an interrupt. Replaces the old in-flow HITLOverlay
// that the user had to scroll deep to find. Collapsible details so the
// banner stays a small bar by default.

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  ListChecks,
  UserCheck,
  X,
} from "lucide-react";

import type { PausedPayload, RemediationStep } from "@/lib/types";

const ACTION_COLORS: Record<string, string> = {
  apply_code_patch:  "text-info bg-info/10 border-info/30",
  rollback:          "text-warning bg-warning/10 border-warning/30",
  heal:              "text-accent bg-accent/10 border-accent/30",
  restart:           "text-accent bg-accent/10 border-accent/30",
  scale_up:          "text-accent bg-accent/10 border-accent/30",
  increase_db_pool:  "text-accent bg-accent/10 border-accent/30",
  verify_health:     "text-fg-muted bg-bg-subtle border-line",
  verify_metrics:    "text-fg-muted bg-bg-subtle border-line",
  escalate:          "text-danger bg-danger/10 border-danger/30",
};

export function StickyHITLBanner({
  paused,
  onDecision,
  busy,
}: {
  paused: PausedPayload;
  onDecision: (approved: boolean) => void;
  busy?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isRCA = paused.stage === "root_cause";
  const Icon = isRCA ? Brain : ListChecks;
  const stepCount = paused.all_steps?.length ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="
        sticky top-14 z-30 rounded-xl border-2 border-warning/40
        bg-warning/[0.04] backdrop-blur-md
        shadow-[var(--shadow-elev)] overflow-hidden
      "
    >
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
          <UserCheck size={16} strokeWidth={2.5} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-display text-sm font-semibold text-warning">
              Operator approval required
            </span>
            <span className="rounded-full bg-warning/20 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-warning">
              <Icon className="-mt-0.5 mr-1 inline" size={10} strokeWidth={2.5} />
              {isRCA ? "Root Cause" : "Plan"}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-fg-muted">
            {isRCA
              ? "Review the diagnosed root cause before remediation is planned"
              : `Plan contains ${stepCount} step${stepCount === 1 ? "" : "s"} — at least one is Dangerous`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="
            inline-flex shrink-0 items-center gap-1 rounded-md
            px-2 py-1 text-xs font-medium text-fg-muted
            transition-colors hover:bg-bg-subtle hover:text-fg
          "
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          Details
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecision(false)}
          className="
            inline-flex shrink-0 items-center gap-1.5 rounded-md
            border border-line bg-bg-elev px-3 py-1.5
            text-xs font-medium text-fg-muted
            transition-colors hover:bg-bg-subtle hover:text-danger hover:border-danger/40
            disabled:cursor-not-allowed disabled:opacity-50
          "
        >
          <X size={12} strokeWidth={2.5} />
          Reject
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecision(true)}
          className="
            inline-flex shrink-0 items-center gap-1.5 rounded-md
            bg-accent px-3 py-1.5
            text-xs font-semibold text-accent-fg
            transition-colors hover:opacity-90
            disabled:cursor-not-allowed disabled:opacity-50
          "
        >
          <Check size={12} strokeWidth={3} />
          {busy ? "Sending…" : "Approve"}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="details"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="border-t border-warning/30 bg-warning/[0.02] px-4 py-3">
              {isRCA
                ? <RCADetails paused={paused} />
                : <PlanDetails paused={paused} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function RCADetails({ paused }: { paused: PausedPayload }) {
  return (
    <div className="space-y-3 text-sm">
      <Field label="Root cause">
        <p className="text-fg">{paused.root_cause}</p>
      </Field>
      <Field label="Recommended fix">
        <p className="text-fg">{paused.recommended_fix}</p>
      </Field>
      {paused.confidence != null && (
        <Field label="Confidence">
          <p className="font-mono text-fg">{(paused.confidence * 100).toFixed(0)}%</p>
        </Field>
      )}
    </div>
  );
}

function PlanDetails({ paused }: { paused: PausedPayload }) {
  return (
    <div className="space-y-2">
      <p className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
        Proposed steps
      </p>
      {(paused.all_steps ?? []).map((step, idx) => (
        <StepLine key={idx} step={step} index={idx + 1} />
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
        {label}
      </p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function StepLine({ step, index }: { step: RemediationStep; index: number }) {
  const colour = ACTION_COLORS[step.remediation_action] ?? "text-fg-muted bg-bg-subtle border-line";
  return (
    <div className="flex items-start gap-3 rounded-md border border-line bg-bg-elev p-3">
      <span className="min-w-[18px] pt-0.5 font-mono text-[10px] text-fg-subtle">
        {index.toString().padStart(2, "0")}.
      </span>
      <span className={`
        shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider
        ${colour}
      `}>
        {step.remediation_action}
      </span>
      {step.critical && (
        <span className="shrink-0 rounded border border-danger/30 bg-danger/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-danger">
          critical
        </span>
      )}
      <p className="flex-1 text-xs leading-relaxed text-fg">{step.description}</p>
    </div>
  );
}
