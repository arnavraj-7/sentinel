"use client";

import { motion } from "framer-motion";
import { ArrowRight, Brain, ListChecks, Wrench } from "lucide-react";

import { SectionHeader } from "./SectionHeader";

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
    chips: ["executor", "code_patch sub-graph", "sandbox_verifier", "promote", "post_mortem"],
  },
];

export function HowItWorks() {
  return (
    <section className="space-y-8">
      <SectionHeader
        index="02"
        eyebrow="How it works"
        title="Three phases, sixteen nodes"
        description="Every step is a discrete graph node with its own thinking, findings, and visible streaming progress."
      />

      <ol className="grid grid-cols-1 gap-5 lg:grid-cols-3 lg:items-stretch">
        {STEPS.map((step, i) => (
          <motion.li
            key={step.n}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: i * 0.08 }}
            className="
              lift relative flex flex-col gap-4 overflow-hidden
              rounded-xl border border-line bg-bg-elev p-6
              shadow-[var(--shadow-card)]
            "
          >
            {/* Decorative giant numeral — adds editorial polish */}
            <span
              aria-hidden
              className="
                pointer-events-none absolute right-4 top-0 select-none
                font-display text-[120px] font-bold leading-none text-fg
                opacity-[0.04]
              "
            >
              {step.n}
            </span>

            {/* Connector arrow between cards on lg screens */}
            {i < STEPS.length - 1 && (
              <span
                aria-hidden
                className="
                  pointer-events-none absolute -right-4 top-1/2
                  hidden -translate-y-1/2 text-line-strong
                  lg:flex
                "
              >
                <ArrowRight size={20} strokeWidth={1.5} />
              </span>
            )}

            <div className="relative flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <step.Icon size={18} strokeWidth={2} />
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-fg-subtle">
                Phase {step.n} / 3
              </span>
            </div>

            <div className="relative">
              <h3 className="font-display text-2xl font-semibold tracking-tight">
                {step.title}
              </h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-fg-muted">
                {step.body}
              </p>
            </div>

            <div className="relative mt-auto flex flex-wrap gap-1.5">
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
