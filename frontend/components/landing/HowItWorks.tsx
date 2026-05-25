"use client";

import { motion } from "framer-motion";
import { Brain, ListChecks, Wrench } from "lucide-react";

const STEPS = [
  {
    n: 1,
    Icon: Brain,
    title: "Diagnose",
    body:
      "An alert lands. The triager classifies it. Three investigators " +
      "(logs, metrics, topology) fan out in parallel and feed a root-cause " +
      "analyst with a critic in a bounded reflection loop. The human " +
      "operator reviews the diagnosis before anything mutates.",
    chips: ["triager", "log_detective", "metric_analyst", "topology_mapper", "root_cause_analyst", "critic"],
  },
  {
    n: 2,
    Icon: ListChecks,
    title: "Decide",
    body:
      "A planner produces an ordered remediation runbook. Dangerous " +
      "actions (heal, restart, rollback, scale, code-patch) require a " +
      "second human approval; safe actions (verify_health, verify_metrics) " +
      "run unattended. Each plan is a separate decision.",
    chips: ["planner", "Safe / Dangerous classifier", "HITL · plan gate"],
  },
  {
    n: 3,
    Icon: Wrench,
    title: "Remediate",
    body:
      "The executor processes one step at a time. Code-patch steps " +
      "dispatch to a self-contained sub-graph where Claude Code writes a " +
      "fix, then a deterministic differential test gate (pass-on-fix AND " +
      "fail-on-parent) verifies it's a real regression test, not a fake.",
    chips: ["executor", "code_patch sub-graph", "sandbox_verifier", "prod verifier", "post_mortem"],
  },
];

export function HowItWorks() {
  return (
    <section className="space-y-6">
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">
          How it works
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-fg-muted sm:text-base">
          Three phases, sixteen nodes. Every step is a discrete graph node
          with its own thinking, findings, and visible streaming progress.
        </p>
      </div>

      <ol className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {STEPS.map((step, i) => (
          <motion.li
            key={step.n}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: i * 0.08 }}
            className="
              relative flex flex-col gap-4 rounded-xl border border-line
              bg-bg-elev p-6 shadow-[var(--shadow-card)]
            "
          >
            <div className="flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <step.Icon size={18} strokeWidth={2} />
              </div>
              <span className="font-mono text-xs text-fg-subtle">
                step {step.n} of 3
              </span>
            </div>

            <div>
              <h3 className="font-display text-xl font-semibold tracking-tight">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">
                {step.body}
              </p>
            </div>

            <div className="mt-auto flex flex-wrap gap-1.5">
              {step.chips.map(c => (
                <span
                  key={c}
                  className="
                    inline-flex items-center rounded border border-line
                    bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px]
                    text-fg-muted
                  "
                >
                  {c}
                </span>
              ))}
            </div>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}
