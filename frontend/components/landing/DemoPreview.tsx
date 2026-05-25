"use client";

// Inline animated demo — a 24-second loop showing Sentinel handling the
// `code_defect` scenario end-to-end. Portrait layout to fit the landing
// right column. Fixed total height + fixed trail height so the layout
// NEVER jumps when new events arrive (the previous implementation had
// the trail height growing with content, pushing everything around).
//
// Visual rules:
//   - Idle nodes: outlined, faded
//   - Running nodes: SOLID blue fill, white icon + label
//   - Done nodes: SOLID green fill, white icon + label
//   - Edges: solid colored line when active/done (no traveling dot — that
//     was distracting; the node-fill alone reads as "this one is on now")

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { AGENT_ICONS, AGENT_LABELS, FALLBACK_ICON } from "@/components/icons";

type NodeId =
  | "triager" | "log_detective" | "metric_analyst" | "topology_mapper"
  | "root_cause_analyst" | "planner" | "code_patch" | "post_mortem";

type Status = "idle" | "running" | "done";

const NODES: Array<{ id: NodeId; x: number; y: number; w?: number }> = [
  { id: "triager",            x: 250, y:  35, w: 150 },
  { id: "log_detective",      x:  90, y: 130, w: 130 },
  { id: "metric_analyst",     x: 250, y: 130, w: 130 },
  { id: "topology_mapper",    x: 410, y: 130, w: 130 },
  { id: "root_cause_analyst", x: 250, y: 225, w: 170 },
  { id: "planner",            x: 250, y: 295, w: 150 },
  { id: "code_patch",         x: 250, y: 365, w: 150 },
  { id: "post_mortem",        x: 250, y: 430, w: 150 },
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

type Scene = {
  at: number;
  status?: Partial<Record<NodeId, Status>>;
  msg?: { agent: NodeId; phase: string; message: string };
};

const SCRIPT: Scene[] = [
  { at: 0.5,  status: { triager: "running" },
              msg: { agent: "triager", phase: "classifying", message: "Reading alert + metrics" } },
  { at: 2.0,  status: { triager: "done", log_detective: "running", metric_analyst: "running", topology_mapper: "running" },
              msg: { agent: "triager", phase: "classified", message: "surge_5xx (98% conf)" } },
  { at: 3.2,  msg: { agent: "log_detective", phase: "found",
                     message: "UnboundLocalError discounts.py:11" } },
  { at: 4.4,  msg: { agent: "metric_analyst", phase: "analyzed",
                     message: "CPU 95% · errors 47% · p95 959ms" } },
  { at: 5.6,  msg: { agent: "topology_mapper", phase: "mapped",
                     message: "Blast radius: checkout, orders" } },
  { at: 6.8,  status: { log_detective: "done", metric_analyst: "done", topology_mapper: "done", root_cause_analyst: "running" },
              msg: { agent: "root_cause_analyst", phase: "synthesizing", message: "Cross-referencing evidence" } },
  { at: 8.6,  status: { root_cause_analyst: "done", planner: "running" },
              msg: { agent: "root_cause_analyst", phase: "diagnosed", message: "Missing tier branch (95% conf)" } },
  { at: 10.0, status: { planner: "done", code_patch: "running" },
              msg: { agent: "planner", phase: "planned", message: "Plan: apply_code_patch + verify" } },
  { at: 11.0, msg: { agent: "code_patch", phase: "cc.tool", message: "CC: Read(discounts.py)" } },
  { at: 12.2, msg: { agent: "code_patch", phase: "cc.tool", message: "CC: Grep('apply_tier_discount')" } },
  { at: 13.4, msg: { agent: "code_patch", phase: "cc.tool", message: "CC: Edit — added else branch" } },
  { at: 14.8, msg: { agent: "code_patch", phase: "cc.tool", message: "CC: pytest -q · 15 passed" } },
  { at: 16.0, msg: { agent: "code_patch", phase: "diff-gate", message: "pass-on-fix ✓ · fail-on-parent ✓" } },
  { at: 17.4, status: { code_patch: "done", post_mortem: "running" },
              msg: { agent: "code_patch", phase: "verified", message: "VERIFIED · commit 58c8711" } },
  { at: 19.6, status: { post_mortem: "done" },
              msg: { agent: "post_mortem", phase: "written", message: "Post-mortem written" } },
];

const CYCLE_SECONDS = 24;
const MAX_TRAIL = 4;

export function DemoPreview() {
  const [t, setT] = useState(0);
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

  const trail = useMemo(() => {
    const events = SCRIPT.filter(s => s.msg && s.at <= t)
      .map(s => ({ at: s.at, ...s.msg! }));
    return events.slice(-MAX_TRAIL);
  }, [t]);

  const progress = (t / CYCLE_SECONDS) * 100;

  return (
    // FIXED height — children sized to fit; trail is fixed-height with
    // overflow hidden so new events don't push the layout around.
    <div className="
      relative flex h-[580px] flex-col overflow-hidden
      rounded-2xl border border-line bg-bg-elev
      shadow-[var(--shadow-card)]
    ">
      {/* Chrome strip */}
      <div className="flex items-center justify-between border-b border-line bg-bg-subtle px-4 py-2">
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

      <div className="relative h-[2px] w-full bg-line/40">
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-info to-accent transition-[width] duration-150"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Graph — flex-1 so it owns the middle */}
      <div className="flex flex-1 items-center justify-center px-4 py-2 overflow-hidden">
        <svg
          viewBox="0 0 500 460"
          className="h-full w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {EDGES.map(([s, e]) => (
            <EdgeLine
              key={`${s}->${e}`}
              from={NODES.find(n => n.id === s)!}
              to={NODES.find(n => n.id === e)!}
              sourceStatus={statuses[s]}
              targetStatus={statuses[e]}
            />
          ))}
          {NODES.map(n => (
            <NodeBadge key={n.id} node={n} status={statuses[n.id]} />
          ))}
        </svg>
      </div>

      {/* Trail — FIXED height, items truncated to single line, overflow hidden */}
      <div className="border-t border-line bg-bg-subtle px-4 py-3">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-running" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Live trail
          </span>
        </div>
        <ul className="h-[5rem] space-y-1 overflow-hidden">
          <AnimatePresence initial={false}>
            {trail.map(e => (
              <motion.li
                key={`${e.at}-${e.agent}-${e.phase}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex h-[18px] items-center gap-2"
              >
                <TrailIcon name={e.agent} />
                <span className="font-mono text-[9px] uppercase text-fg-subtle min-w-[88px] truncate">
                  {AGENT_LABELS[e.agent] ?? e.agent}
                </span>
                <span className="flex-1 truncate text-[11px] text-fg">{e.message}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  );
}

// ── SVG sub-components ──────────────────────────────────────────────────────

function NodeBadge({
  node,
  status,
}: {
  node: { id: NodeId; x: number; y: number; w?: number };
  status: Status;
}) {
  const Icon = AGENT_ICONS[node.id] ?? FALLBACK_ICON;
  const label = AGENT_LABELS[node.id] ?? node.id;
  const w = node.w ?? 140;
  const h = 36;
  const rx = node.x - w / 2;
  const ry = node.y - h / 2;

  // SOLID FILL when running/done. White text + icon. The fill IS the cue —
  // no more travelling dot needed.
  const fill =
    status === "running" ? "var(--running)" :
    status === "done"    ? "var(--success)" :
                           "var(--bg-elev)";
  const stroke =
    status === "idle"    ? "var(--line)" :
                           "transparent";
  const textColor =
    status === "idle"    ? "var(--fg)" :
                           "#ffffff";
  const iconColor =
    status === "idle"    ? "var(--fg-subtle)" :
                           "#ffffff";

  return (
    <motion.g
      animate={{ opacity: status === "idle" ? 0.7 : 1 }}
      initial={{ opacity: 0.6 }}
      transition={{ duration: 0.4 }}
    >
      <rect
        x={rx} y={ry} width={w} height={h} rx={8}
        fill={fill} stroke={stroke} strokeWidth={1.5}
      />
      <foreignObject x={rx + 12} y={ry + 8} width={20} height={20}>
        <div style={{
          color: iconColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 20,
        }}>
          <Icon size={14} strokeWidth={2.2} />
        </div>
      </foreignObject>
      <text
        x={rx + 38}
        y={node.y + 4}
        fill={textColor}
        fontSize={12}
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
  const dy = to.y - from.y;
  const c1 = { x: from.x, y: from.y + dy * 0.5 };
  const c2 = { x: to.x,   y: from.y + dy * 0.5 };
  const path = `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;

  const active = targetStatus === "running";
  const done   = sourceStatus === "done" && targetStatus === "done";

  // Edges keep their colour, but NO travelling dot (the user wanted that
  // removed). The line colour alone communicates "this path is live."
  const stroke =
    active ? "var(--running)" :
    done   ? "var(--success)" :
             "var(--line-strong)";

  const dash = active || done ? "0" : "4 4";

  return (
    <path
      d={path}
      fill="none"
      stroke={stroke}
      strokeWidth={active ? 2 : 1.25}
      strokeDasharray={dash}
      opacity={active || done ? 1 : 0.5}
    />
  );
}

function TrailIcon({ name }: { name: NodeId }) {
  const Icon = AGENT_ICONS[name] ?? FALLBACK_ICON;
  return (
    <span className="
      flex h-4 w-4 shrink-0 items-center justify-center rounded
      bg-bg-elev text-accent
    ">
      <Icon size={9} strokeWidth={2.5} />
    </span>
  );
}
