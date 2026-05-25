"use client";

// Inline animated demo of the live dashboard — a 24-second loop that
// shows Sentinel handling the `code_defect` scenario end-to-end:
//   triager → 3 parallel investigators → RCA → planner → code_patch
//   → post_mortem
//
// Pure CSS/SVG, no backend. Drives node statuses + trail events from a
// time-based scene script. requestAnimationFrame ticks the clock; the
// component derives current state from the scenes whose `at <= now`.
//
// This is what goes ON the landing page instead of a recorded demo video —
// loads instantly, stays in sync with the real product, renders in the
// user's theme.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Play } from "lucide-react";

import { AGENT_ICONS, AGENT_LABELS, FALLBACK_ICON } from "@/components/icons";

// ── Graph layout (SVG coordinates) ──────────────────────────────────────────

type NodeId =
  | "triager" | "log_detective" | "metric_analyst" | "topology_mapper"
  | "root_cause_analyst" | "planner" | "code_patch" | "post_mortem";

type Status = "idle" | "running" | "done";

const NODES: Array<{ id: NodeId; x: number; y: number }> = [
  { id: "triager",            x:  60, y: 130 },
  { id: "log_detective",      x: 240, y:  60 },
  { id: "metric_analyst",     x: 240, y: 130 },
  { id: "topology_mapper",    x: 240, y: 200 },
  { id: "root_cause_analyst", x: 420, y: 130 },
  { id: "planner",            x: 580, y: 130 },
  { id: "code_patch",         x: 720, y: 130 },
  { id: "post_mortem",        x: 860, y: 130 },
];

const EDGES: Array<[NodeId, NodeId]> = [
  ["triager", "log_detective"],
  ["triager", "metric_analyst"],
  ["triager", "topology_mapper"],
  ["log_detective",   "root_cause_analyst"],
  ["metric_analyst",  "root_cause_analyst"],
  ["topology_mapper", "root_cause_analyst"],
  ["root_cause_analyst", "planner"],
  ["planner", "code_patch"],
  ["code_patch", "post_mortem"],
];

// ── Scene script — time-keyed status + trail events ─────────────────────────

type Scene = {
  at: number;                                  // seconds from cycle start
  status?: Partial<Record<NodeId, Status>>;
  msg?: { agent: NodeId; phase: string; message: string };
};

const SCRIPT: Scene[] = [
  { at: 0.5,  status: { triager: "running" },
              msg: { agent: "triager", phase: "classifying", message: "Reading alert + metrics" } },
  { at: 2.0,  status: { triager: "done", log_detective: "running", metric_analyst: "running", topology_mapper: "running" },
              msg: { agent: "triager", phase: "classified", message: "Category: surge_5xx (98% conf)" } },
  { at: 3.2,  msg: { agent: "log_detective", phase: "found",
                     message: "UnboundLocalError /app/services/discounts.py:11" } },
  { at: 4.4,  msg: { agent: "metric_analyst", phase: "analyzed",
                     message: "CPU 95% · errors 47% · p95 latency 959ms" } },
  { at: 5.6,  msg: { agent: "topology_mapper", phase: "mapped",
                     message: "Blast radius: payment-service (root) → checkout, orders" } },
  { at: 6.8,  status: { log_detective: "done", metric_analyst: "done", topology_mapper: "done", root_cause_analyst: "running" },
              msg: { agent: "root_cause_analyst", phase: "synthesizing", message: "Cross-referencing evidence" } },
  { at: 8.6,  status: { root_cause_analyst: "done", planner: "running" },
              msg: { agent: "root_cause_analyst", phase: "diagnosed", message: "Missing tier branch in apply_tier_discount (95%)" } },
  { at: 10.0, status: { planner: "done", code_patch: "running" },
              msg: { agent: "planner", phase: "planned", message: "Plan: apply_code_patch → verify_health → verify_metrics" } },
  { at: 11.0, msg: { agent: "code_patch", phase: "cc.tool", message: "CC: Read(services/discounts.py)" } },
  { at: 12.2, msg: { agent: "code_patch", phase: "cc.tool", message: "CC: Grep('apply_tier_discount')" } },
  { at: 13.4, msg: { agent: "code_patch", phase: "cc.tool", message: "CC: Edit(services/discounts.py) — added else branch" } },
  { at: 14.8, msg: { agent: "code_patch", phase: "cc.tool", message: "CC: Bash('pytest -q') — 15 passed" } },
  { at: 16.0, msg: { agent: "code_patch", phase: "diff-gate", message: "pass-on-fix ✓ · fail-on-parent ✓" } },
  { at: 17.4, status: { code_patch: "done", post_mortem: "running" },
              msg: { agent: "code_patch", phase: "verified", message: "VERIFIED — commit 58c8711" } },
  { at: 19.6, status: { post_mortem: "done" },
              msg: { agent: "post_mortem", phase: "written", message: "Post-mortem written: payment-service.md" } },
];

const CYCLE_SECONDS = 24;

// ── The component ───────────────────────────────────────────────────────────

export function DemoPreview() {
  const [t, setT] = useState(0);

  // RAF clock — wraps every CYCLE_SECONDS
  const startedAtRef = useRef<number | null>(null);
  useEffect(() => {
    let raf = 0;
    const tick = (ts: number) => {
      if (startedAtRef.current == null) startedAtRef.current = ts;
      const elapsed = (ts - startedAtRef.current) / 1000;
      setT(elapsed % CYCLE_SECONDS);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Derive current node statuses from scenes with at <= t
  const statuses = useMemo<Record<NodeId, Status>>(() => {
    const out: Record<NodeId, Status> = {
      triager: "idle", log_detective: "idle", metric_analyst: "idle",
      topology_mapper: "idle", root_cause_analyst: "idle",
      planner: "idle", code_patch: "idle", post_mortem: "idle",
    };
    for (const s of SCRIPT) {
      if (s.at > t) break;
      if (s.status) Object.assign(out, s.status);
    }
    return out;
  }, [t]);

  // Trail: last 5 messages whose at <= t
  const trail = useMemo(() => {
    const events = SCRIPT.filter(s => s.msg && s.at <= t)
      .map(s => ({ at: s.at, ...s.msg! }));
    return events.slice(-5);
  }, [t]);

  return (
    <div className="
      relative overflow-hidden rounded-2xl border border-line bg-bg-elev
      shadow-[var(--shadow-card)]
    ">
      {/* Header strip — looks like a live dashboard chrome */}
      <div className="
        flex items-center justify-between border-b border-line bg-bg-subtle
        px-5 py-2.5
      ">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
          </div>
          <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
            sentinel · /demo · code_defect
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-running pulse-ring" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-running" />
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-running">
            live · auto-loop
          </span>
        </div>
      </div>

      {/* Graph */}
      <div className="px-5 pt-5">
        <svg
          viewBox="0 0 940 260"
          className="w-full"
          preserveAspectRatio="xMidYMid meet"
          style={{ maxHeight: 280 }}
        >
          <defs>
            <filter id="dp-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <linearGradient id="dp-edge-grad" x1="0" x2="1">
              <stop offset="0%"  stopColor="var(--info)" />
              <stop offset="100%" stopColor="var(--accent)" />
            </linearGradient>
          </defs>

          {/* Edges */}
          {EDGES.map(([s, e]) => (
            <EdgeLine
              key={`${s}->${e}`}
              from={NODES.find(n => n.id === s)!}
              to={NODES.find(n => n.id === e)!}
              sourceStatus={statuses[s]}
              targetStatus={statuses[e]}
            />
          ))}

          {/* Nodes */}
          {NODES.map(n => (
            <NodeBadge key={n.id} node={n} status={statuses[n.id]} />
          ))}
        </svg>
      </div>

      {/* Trail */}
      <div className="border-t border-line bg-bg-subtle px-5 py-3">
        <div className="flex items-center gap-2 pb-2">
          <span className="h-1.5 w-1.5 rounded-full bg-running" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Live trail
          </span>
        </div>
        <ul className="space-y-1.5 min-h-[6rem]">
          <AnimatePresence initial={false}>
            {trail.map(e => (
              <motion.li
                key={`${e.at}-${e.agent}-${e.phase}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="flex items-center gap-2.5"
              >
                <TrailIcon name={e.agent} />
                <span className="font-mono text-[10px] uppercase text-fg-subtle min-w-[140px] truncate">
                  {AGENT_LABELS[e.agent] ?? e.agent}
                </span>
                <span className="font-mono text-[10px] uppercase text-fg-muted min-w-[80px] truncate">
                  {e.phase}
                </span>
                <span className="truncate text-[12px] text-fg">{e.message}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>

      {/* CTA strip */}
      <div className="border-t border-line bg-bg-elev px-5 py-3">
        <Link
          href="/demo"
          className="
            group inline-flex items-center gap-1.5 text-sm font-medium text-accent
            transition-colors hover:text-fg
          "
        >
          <Play size={11} fill="currentColor" />
          Run this for real
          <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function NodeBadge({
  node,
  status,
}: {
  node: { id: NodeId; x: number; y: number };
  status: Status;
}) {
  const Icon = AGENT_ICONS[node.id] ?? FALLBACK_ICON;
  const label = AGENT_LABELS[node.id] ?? node.id;
  const w = 130, h = 36;
  const rx = node.x - w / 2;
  const ry = node.y - h / 2;

  const fill =
    status === "running" ? "color-mix(in srgb, var(--running) 8%, var(--bg-elev))" :
    status === "done"    ? "color-mix(in srgb, var(--success) 6%, var(--bg-elev))" :
                           "var(--bg-elev)";
  const stroke =
    status === "running" ? "color-mix(in srgb, var(--running) 70%, transparent)" :
    status === "done"    ? "color-mix(in srgb, var(--success) 55%, transparent)" :
                           "var(--line)";
  const accent =
    status === "running" ? "var(--running)" :
    status === "done"    ? "var(--success)" :
                           "var(--fg-subtle)";

  return (
    <motion.g
      animate={{ opacity: 1, scale: 1 }}
      initial={{ opacity: 0.6, scale: 0.96 }}
      transition={{ duration: 0.4 }}
      style={{ originX: node.x, originY: node.y, transformBox: "fill-box", transformOrigin: "center" }}
    >
      <rect
        x={rx}
        y={ry}
        width={w}
        height={h}
        rx={8}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.5}
      />
      {/* Status dot */}
      <circle cx={rx + 12} cy={node.y} r={3.5} fill={accent}>
        {status === "running" && (
          <animate
            attributeName="opacity"
            values="1;0.3;1"
            dur="1.4s"
            repeatCount="indefinite"
          />
        )}
      </circle>
      {/* Icon (rendered via foreignObject for lucide compatibility — simpler: small icon SVG) */}
      <foreignObject x={rx + 22} y={ry + 8} width={20} height={20}>
        <div style={{ color: accent, display: "flex", alignItems: "center", justifyContent: "center", height: 20 }}>
          <Icon size={14} strokeWidth={2} />
        </div>
      </foreignObject>
      <text
        x={rx + 44}
        y={node.y + 4}
        fill="var(--fg)"
        fontSize={11}
        fontFamily="var(--font-display)"
        fontWeight={600}
      >
        {label}
      </text>
    </motion.g>
  );
}

function EdgeLine({
  from, to, sourceStatus, targetStatus,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  sourceStatus: Status;
  targetStatus: Status;
}) {
  // Bezier curve between two nodes. Control points pulled along x for a
  // gentle S-curve.
  const dx = to.x - from.x;
  const c1 = { x: from.x + dx * 0.5, y: from.y };
  const c2 = { x: from.x + dx * 0.5, y: to.y };
  const path = `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;

  const active = targetStatus === "running";
  const done   = sourceStatus === "done" && targetStatus === "done";

  const stroke =
    active ? "var(--running)" :
    done   ? "var(--success)" :
             "var(--line-strong)";

  const dash =
    active ? "0" :
    done   ? "0" :
             "4 4";

  return (
    <>
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={active ? 2 : 1.25}
        strokeDasharray={dash}
        opacity={active || done ? 1 : 0.5}
      />
      {active && (
        <>
          <circle r={3.5} fill="url(#dp-edge-grad)" filter="url(#dp-glow)">
            <animateMotion dur="1.2s" repeatCount="indefinite" rotate="auto" path={path} />
          </circle>
          <circle r={2} fill="var(--running)" opacity={0.4}>
            <animateMotion dur="1.2s" begin="-0.18s" repeatCount="indefinite" rotate="auto" path={path} />
          </circle>
        </>
      )}
    </>
  );
}

function TrailIcon({ name }: { name: NodeId }) {
  const Icon = AGENT_ICONS[name] ?? FALLBACK_ICON;
  return (
    <span className="
      flex h-5 w-5 shrink-0 items-center justify-center rounded
      bg-bg-elev text-accent
    ">
      <Icon size={10} strokeWidth={2.5} />
    </span>
  );
}
