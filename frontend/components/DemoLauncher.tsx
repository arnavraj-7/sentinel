"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertOctagon,
  Database,
  Loader2,
  Play,
  ShieldAlert,
  Timer,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { motion } from "framer-motion";

import type { Scenario } from "@/lib/types";
import { API_BASE } from "@/lib/api";

type Props = {
  onRun: (name: string) => void;
  disabled: boolean;
  /** When true, render as a compact horizontal pill row instead of the
   *  full 5-card grid. Used on the /demo page once an incident is
   *  running so the scenario picker doesn't eat half the viewport. */
  compact?: boolean;
};

// Per-scenario visual identity — icon + tint. The prompt_injection one
// gets the shield because it's the differentiator.
const SCENARIO_META: Record<string, { Icon: LucideIcon; tint: string; tag: string }> = {
  code_defect: {
    Icon: Wrench,
    tint: "from-blue-500/20 to-indigo-500/10 border-blue-500/30 [&_.demo-icon]:text-blue-400",
    tag: "Code patch",
  },
  crash_loop: {
    Icon: Activity,
    tint: "from-red-500/20 to-orange-500/10 border-red-500/30 [&_.demo-icon]:text-red-400",
    tag: "Heal / restart",
  },
  db_pool_exhaustion: {
    Icon: Database,
    tint: "from-amber-500/20 to-yellow-500/10 border-amber-500/30 [&_.demo-icon]:text-amber-400",
    tag: "Scale db pool",
  },
  latency_spike: {
    Icon: Timer,
    tint: "from-violet-500/20 to-fuchsia-500/10 border-violet-500/30 [&_.demo-icon]:text-violet-400",
    tag: "Scale up",
  },
  prompt_injection: {
    Icon: ShieldAlert,
    tint: "from-emerald-500/20 to-teal-500/10 border-emerald-500/30 [&_.demo-icon]:text-emerald-400",
    tag: "Defense demo",
  },
};

export function DemoLauncher({ onRun, disabled, compact = false }: Props) {
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`${API_BASE}/scenarios`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data: Scenario[] = await resp.json();
        if (!cancelled) setScenarios(data);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loadError) {
    return (
      <div className="rounded-xl border border-danger/40 bg-danger/5 p-5">
        <div className="flex items-start gap-3">
          <AlertOctagon size={18} className="mt-0.5 shrink-0 text-danger" />
          <div className="space-y-1">
            <p className="font-display text-sm font-semibold text-danger">
              Could not reach Sentinel API
            </p>
            <p className="text-xs text-fg-muted">
              <code className="font-mono">{API_BASE}/scenarios</code> — {loadError}
            </p>
            <p className="mt-2 text-xs text-fg-muted">
              Start the backend from the repo root:
            </p>
            <pre className="mt-1 overflow-x-auto rounded-md border border-line bg-bg-subtle p-3 font-mono text-[11px] text-fg">
{`$env:SENTINEL_GITHUB_PROD_LINK = "D:/projects/codefix-testrepo"
$env:SENTINEL_DATASOURCE       = "lab"
.venv\\Scripts\\python.exe -m uvicorn sentinel.main:app --port 8000`}
            </pre>
          </div>
        </div>
      </div>
    );
  }

  if (!scenarios) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-bg-elev p-5 text-sm text-fg-muted">
        <Loader2 size={14} className="animate-spin" />
        Loading scenarios…
      </div>
    );
  }

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {scenarios.map((s, idx) => {
          const meta = SCENARIO_META[s.name] ?? {
            Icon: Wrench,
            tint: "border-line",
            tag: "Demo",
          };
          const { Icon, tint } = meta;
          return (
            <motion.button
              key={s.name}
              type="button"
              disabled={disabled}
              onClick={() => onRun(s.name)}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: idx * 0.03 }}
              className={`
                inline-flex items-center gap-1.5 rounded-md border
                bg-gradient-to-br ${tint} px-2.5 py-1.5
                text-[12px] font-medium text-fg
                transition-all hover:-translate-y-0.5 hover:shadow
                disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0
              `}
              title={s.description}
            >
              <Icon size={12} strokeWidth={2} className="demo-icon" />
              {s.title.replace(/ — .*/, "")}
            </motion.button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {scenarios.map((s, idx) => {
        const meta = SCENARIO_META[s.name] ?? {
          Icon: Wrench,
          tint: "from-fg/10 to-transparent border-line",
          tag: "Demo",
        };
        const { Icon, tint, tag } = meta;
        return (
          <motion.button
            key={s.name}
            type="button"
            disabled={disabled}
            onClick={() => onRun(s.name)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: idx * 0.05 }}
            className={`
              group relative flex h-full flex-col items-start gap-3 overflow-hidden
              rounded-xl border bg-gradient-to-br ${tint}
              p-5 text-left
              transition-all duration-200
              hover:-translate-y-0.5 hover:shadow-[var(--shadow-elev)]
              disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0
            `}
          >
            {/* Hover glow */}
            <span
              aria-hidden
              className="
                pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300
                group-hover:opacity-100
              "
              style={{
                background:
                  "radial-gradient(circle at 50% 0%, rgba(255,255,255,0.08), transparent 60%)",
              }}
            />

            <div className="relative flex w-full items-start justify-between gap-2">
              <div
                className="
                  flex h-9 w-9 items-center justify-center rounded-lg
                  bg-bg-elev/80 backdrop-blur
                  border border-line/50
                "
              >
                <Icon size={17} strokeWidth={2} className="demo-icon" />
              </div>
              <span
                className="
                  inline-flex items-center gap-1 rounded-full bg-bg-elev/80 px-2 py-0.5
                  backdrop-blur border border-line/50
                  font-mono text-[10px] uppercase tracking-wider text-fg-muted
                "
              >
                {tag}
              </span>
            </div>

            <div className="relative flex-1">
              <h3 className="font-display text-base font-semibold tracking-tight text-fg">
                {s.title}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-fg-muted line-clamp-3">
                {s.description}
              </p>
            </div>

            <div className="relative flex w-full items-center justify-between text-[10px]">
              <span className="font-mono uppercase tracking-wider text-fg-subtle">
                {s.service} · {s.severity}
              </span>
              <span
                className="
                  inline-flex items-center gap-1 rounded-md bg-bg-elev px-2 py-1
                  font-medium text-fg
                  transition-colors group-hover:bg-accent group-hover:text-accent-fg
                "
              >
                <Play size={10} fill="currentColor" />
                Run
              </span>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
