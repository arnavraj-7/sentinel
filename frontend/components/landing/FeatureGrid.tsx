"use client";

import { motion } from "framer-motion";
import {
  Activity,
  Brain,
  CheckCircle2,
  Code2,
  GitBranch,
  Layers,
  Network,
  Radio,
  RefreshCw,
  Scale,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sprout,
  TestTubeDiagonal,
  Timer,
  UserCheck,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

type Feature = { Icon: LucideIcon; title: string; body: string };
type Category = { title: string; subtitle: string; features: Feature[] };

// EVERY notable capability, grouped for scannability. Six categories,
// 4-5 features each. Each card is one paragraph of plain-English value.

const CATEGORIES: Category[] = [
  {
    title: "Multi-Agent Diagnosis",
    subtitle: "Specialists, not a chat loop",
    features: [
      { Icon: Brain, title: "Plan-then-execute",
        body: "Each agent has one job. The planner emits a runbook of typed actions; the executor runs them deterministically. Not a ReAct chat loop." },
      { Icon: Network, title: "Parallel investigators",
        body: "log_detective, metric_analyst, and topology_mapper fan out concurrently from the triager — three independent perspectives feed the root-cause analyst." },
      { Icon: RefreshCw, title: "Reflection loop",
        body: "A critic agent reviews each RCA. If unconvinced, the analyst revises — bounded by a maximum revision count to prevent runaway loops." },
      { Icon: ScrollText, title: "Symptom-level alerts",
        body: "Alerts never name the failure mode. The system DISCOVERS it from the logs the investigators read — like a real on-call engineer." },
    ],
  },
  {
    title: "Code-Patch Sub-Graph",
    subtitle: "Real patches, verified",
    features: [
      { Icon: Wrench, title: "Claude Code in a sandbox",
        body: "Each incident gets an isolated git clone of the prod repo. CC investigates with grep/read/bash, writes the fix, authors tests, commits — all in the sandbox." },
      { Icon: ShieldCheck, title: "Differential test gate",
        body: "Deterministic verification: pass-on-fix AND fail-on-parent. A fake test that passes on broken code is rejected — you don't trust the agent's report, you prove it." },
      { Icon: TestTubeDiagonal, title: "Verdict-fed retry",
        body: "On retry, CC sees the verifier's full output (failing test files, line numbers). The session resumes; the retry is informed, not blind." },
      { Icon: GitBranch, title: "Self-contained sub-graph",
        body: "The retry loop, the per-attempt state, the bounded counter — all live inside the sub-graph. The parent state stays clean; just one cohesive result." },
    ],
  },
  {
    title: "Human-in-the-Loop",
    subtitle: "Operator-gated where it counts",
    features: [
      { Icon: UserCheck, title: "Two HITL gates",
        body: "Root-Cause gate before remediation is planned; Plan gate before any Dangerous action runs. Safe actions (verify_*) execute unattended." },
      { Icon: Scale, title: "Safe / Dangerous split",
        body: "Every RemediationAction is classified at the type level. Mutation-causing actions (heal, restart, rollback, scale, code-patch) trip the gate." },
      { Icon: ScrollText, title: "Operator-attributed post-mortem",
        body: "Rejections are named: the post-mortem says the OPERATOR rejected the [diagnosis | plan] at the [Root-Cause | Plan] gate. No passive 'was rejected'." },
      { Icon: Sparkles, title: "Checkpointer-backed pauses",
        body: "Paused incidents survive process restarts. LangGraph's SQLite checkpointer persists state at every interrupt — resume picks up exactly where it stopped." },
    ],
  },
  {
    title: "Defense in Depth",
    subtitle: "Adversarial-aware by design",
    features: [
      { Icon: ShieldAlert, title: "Prompt-injection isolation",
        body: "Every untrusted input (logs, evidence) is wrapped in <UNTRUSTED_*> markers with a per-run random suffix. Investigators are told these blocks are data, never instructions." },
      { Icon: CheckCircle2, title: "No LLM in the verify loop",
        body: "Asymmetric safety. Verification is deterministic — git, pytest, metrics — not 'ask the LLM if it looks fine.' One non-deterministic agent inside a retry would be catastrophic." },
      { Icon: Timer, title: "Bounded retries everywhere",
        body: "RCA revisions, remediation attempts, patch attempts — each has a hard cap. The graph escalates to a human when bounds are hit, never spins forever." },
      { Icon: RefreshCw, title: "Schema repair + model fallback",
        body: "Pydantic validation failures trigger a self-correction prompt. If the primary model fails repeatedly (rate limit, schema), the chain falls back to a backup model." },
    ],
  },
  {
    title: "Operator Experience",
    subtitle: "Watch the graph think live",
    features: [
      { Icon: Radio, title: "SSE streaming",
        body: "Every node update + every custom writer event streams to the dashboard. No polling, no waiting for completion — the graph progress is visible in real time." },
      { Icon: Zap, title: "Animated edge transitions",
        body: "When control flows from one node to the next, the connecting edge animates a glowing comet trail — the 'ray of light' you can literally see traverse the graph." },
      { Icon: Layers, title: "Click-through per agent",
        body: "Any node opens a drawer showing the LLM's thinking_process, its structured findings, and the full activity log (every tool call CC made, every phase of verification)." },
      { Icon: Code2, title: "Inline post-mortem + diff",
        body: "The scribe's markdown report renders inline. Patch outcome, files touched, commit SHA, and the verifier's verdict are all surfaced before the page is closed." },
    ],
  },
  {
    title: "Reproducible Demo",
    subtitle: "One click → full flow",
    features: [
      { Icon: Sprout, title: "Five canned scenarios",
        body: "Code defect, crash loop, DB-pool exhaustion, latency spike, prompt-injection defense. Each maps to a different remediation path so all branches get exercise." },
      { Icon: Activity, title: "In-process lab",
        body: "A FastAPI lab simulator runs alongside the graph. It exposes injectable failure modes and poison-able log feeds so the demo runs without external dependencies." },
      { Icon: ShieldAlert, title: "Adversarial demo scenario",
        body: "The prompt-injection scenario seeds the logs with attacker text trying to bypass safety gates. The defense is visible in the post-mortem — the AI reports, never obeys." },
      { Icon: ScrollText, title: "Persisted reports",
        body: "Every post-mortem is written to data/post-mortems/<incident>.md so you can review what happened after the demo connection closes." },
    ],
  },
];

export function FeatureGrid() {
  return (
    <section className="space-y-8">
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">
          What&apos;s inside
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-fg-muted sm:text-base">
          Every capability — grouped so you can scan. Click the live demo to
          see most of these fire in 90 seconds.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {CATEGORIES.map((cat, i) => (
          <motion.div
            key={cat.title}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.35, delay: (i % 3) * 0.05 }}
            className="
              flex flex-col gap-4 rounded-xl border border-line
              bg-bg-elev p-6 shadow-[var(--shadow-card)]
            "
          >
            <div>
              <h3 className="font-display text-lg font-semibold tracking-tight">
                {cat.title}
              </h3>
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
                {cat.subtitle}
              </p>
            </div>

            <ul className="space-y-3.5">
              {cat.features.map(f => (
                <li key={f.title} className="flex gap-3">
                  <span
                    className="
                      mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center
                      rounded-md bg-bg-subtle text-accent
                    "
                  >
                    <f.Icon size={13} strokeWidth={2} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-tight text-fg">
                      {f.title}
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-muted">
                      {f.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
