"use client";

import { motion } from "framer-motion";
import {
  Network,
  ScrollText,
  ShieldCheck,
  UserCheck,
  Wrench,
  Zap,
} from "lucide-react";

const FEATURES = [
  { Icon: Network,     label: "Multi-agent diagnosis" },
  { Icon: Wrench,      label: "Claude Code patch sub-graph" },
  { Icon: ShieldCheck, label: "Differential test gate" },
  { Icon: UserCheck,   label: "Human-in-the-loop gates" },
  { Icon: ScrollText,  label: "Prompt-injection defense" },
  { Icon: Zap,         label: "Live streaming UI" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-line bg-bg-elev px-8 py-10 shadow-[var(--shadow-card)]">
      {/* Decorative gradient orbs */}
      <div
        aria-hidden
        className="absolute -right-32 -top-32 h-72 w-72 rounded-full opacity-30 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, var(--accent), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute -bottom-32 -left-32 h-72 w-72 rounded-full opacity-25 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, var(--info), transparent 70%)",
        }}
      />
      <div aria-hidden className="absolute inset-0 grid-backdrop opacity-[0.35]" />

      <div className="relative">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg/60 px-3 py-1 backdrop-blur"
        >
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-success pulse-ring" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Live demo · Phase 17
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="
            mt-4 max-w-3xl font-display text-4xl font-bold tracking-tight text-fg
            sm:text-5xl
          "
        >
          Watch an AI SRE{" "}
          <span className="bg-gradient-to-r from-accent to-info bg-clip-text text-transparent">
            diagnose, patch, and verify
          </span>{" "}
          a production incident — live.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mt-4 max-w-2xl text-sm leading-relaxed text-fg-muted sm:text-base"
        >
          Sentinel is a multi-agent LangGraph system. It ingests an alert,
          parallel-investigates, synthesises a root cause, plans remediation,
          and — when the defect is in code — dispatches a sub-graph that uses
          Claude Code to write and verify a patch with a deterministic
          differential test gate. Every step streams to this dashboard.
        </motion.p>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mt-6 flex flex-wrap gap-2"
        >
          {FEATURES.map(({ Icon, label }) => (
            <span
              key={label}
              className="
                inline-flex items-center gap-1.5 rounded-full border border-line
                bg-bg/70 px-2.5 py-1 backdrop-blur
                text-[11px] font-medium text-fg-muted
              "
            >
              <Icon size={11} strokeWidth={2} className="text-accent" />
              {label}
            </span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
