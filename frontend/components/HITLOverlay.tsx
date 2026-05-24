"use client";

import { motion } from "framer-motion";
import { Check, X, UserCheck, ListChecks, Brain, ShieldAlert } from "lucide-react";

import type { PausedPayload, RemediationStep } from "@/lib/types";

type Props = {
  paused: PausedPayload;
  onDecision: (approved: boolean) => void;
  busy?: boolean;
};

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

export function HITLOverlay({ paused, onDecision, busy }: Props) {
  const isRCA = paused.stage === "root_cause";
  const Icon = isRCA ? Brain : ListChecks;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="
        rounded-xl border border-warning/40 bg-warning/5
        shadow-[var(--shadow-elev)] overflow-hidden
      "
    >
      <div className="flex items-center justify-between border-b border-warning/30 bg-warning/10 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <UserCheck size={16} className="text-warning" strokeWidth={2.5} />
          <span className="font-display text-sm font-semibold tracking-tight text-warning">
            Operator approval required
          </span>
          <span className="rounded-full bg-warning/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-warning">
            {isRCA ? "Stage: Root Cause" : "Stage: Plan"}
          </span>
        </div>
        <ShieldAlert size={14} className="text-warning/60" />
      </div>

      <div className="p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
            <Icon size={17} strokeWidth={2} />
          </div>
          <p className="text-sm leading-relaxed text-fg">
            {isRCA
              ? "Review the diagnosed root cause before allowing the system to plan a remediation."
              : "Review the remediation plan — one or more steps will mutate production state."}
          </p>
        </div>

        {isRCA && (
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
        )}

        {!isRCA && (
          <div className="space-y-2">
            <p className="text-[11px] font-mono uppercase tracking-wider text-fg-subtle">
              Proposed steps
            </p>
            {(paused.all_steps ?? []).map((step, idx) => (
              <StepLine key={idx} step={step} index={idx + 1} />
            ))}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecision(false)}
            className="
              inline-flex items-center gap-1.5 rounded-md border border-line bg-bg-elev px-3 py-1.5
              text-xs font-medium text-fg-muted
              transition-colors hover:bg-bg-subtle hover:text-danger hover:border-danger/40
              disabled:cursor-not-allowed disabled:opacity-50
            "
          >
            <X size={13} strokeWidth={2.5} />
            Reject
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecision(true)}
            className="
              inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5
              text-xs font-semibold text-accent-fg
              transition-colors hover:opacity-90
              disabled:cursor-not-allowed disabled:opacity-50
            "
          >
            <Check size={13} strokeWidth={3} />
            {busy ? "Sending…" : "Approve & continue"}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-wider text-fg-subtle">
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
      <span className="
        font-mono text-[10px] text-fg-subtle pt-0.5 min-w-[18px]
      ">
        {index.toString().padStart(2, "0")}.
      </span>
      <span className={`
        rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider
        ${colour}
      `}>
        {step.remediation_action}
      </span>
      {step.critical && (
        <span className="rounded border border-danger/30 bg-danger/5 px-1.5 py-0.5 font-mono text-[10px] text-danger uppercase tracking-wider">
          critical
        </span>
      )}
      <p className="flex-1 text-xs text-fg leading-relaxed">{step.description}</p>
    </div>
  );
}
