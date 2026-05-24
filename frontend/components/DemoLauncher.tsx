"use client";

import { useEffect, useState } from "react";
import { Play, Loader2, AlertOctagon } from "lucide-react";
import { motion } from "framer-motion";

import type { Scenario } from "@/lib/types";
import { API_BASE } from "@/lib/api";

type Props = {
  onRun: (name: string) => void;
  disabled: boolean;
};

// Subtle accent per scenario — colour-coded so the user can tell them apart
// at a glance. The "🛡 prompt_injection" gets a distinct accent because
// it's the differentiator demo.
const SCENARIO_TINT: Record<string, string> = {
  code_defect:        "from-blue-500/15 to-indigo-500/10 border-blue-500/30",
  crash_loop:         "from-red-500/15 to-orange-500/10 border-red-500/30",
  db_pool_exhaustion: "from-amber-500/15 to-yellow-500/10 border-amber-500/30",
  latency_spike:      "from-violet-500/15 to-fuchsia-500/10 border-violet-500/30",
  prompt_injection:   "from-emerald-500/15 to-teal-500/10 border-emerald-500/30",
};

export function DemoLauncher({ onRun, disabled }: Props) {
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
      <div className="flex items-center gap-2 rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">
        <AlertOctagon size={16} />
        Could not load scenarios from {API_BASE}/scenarios — {loadError}.
        Is Sentinel running?
      </div>
    );
  }

  if (!scenarios) {
    return (
      <div className="flex items-center gap-2 text-sm text-fg-muted">
        <Loader2 size={14} className="animate-spin" />
        Loading scenarios…
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {scenarios.map((s, idx) => (
        <motion.button
          key={s.name}
          type="button"
          disabled={disabled}
          onClick={() => onRun(s.name)}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: idx * 0.05 }}
          className={`
            group relative flex flex-col items-start gap-2 overflow-hidden
            rounded-lg border border-line bg-gradient-to-br ${SCENARIO_TINT[s.name] ?? ""}
            p-4 text-left
            transition-all duration-200
            hover:border-line-strong hover:shadow-lg hover:-translate-y-0.5
            disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0
          `}
        >
          <div className="flex w-full items-center justify-between">
            <span className="font-display text-sm font-semibold tracking-tight text-fg">
              {s.title}
            </span>
            <span
              className="
                inline-flex h-6 w-6 items-center justify-center rounded-full
                bg-bg-elev text-fg-muted
                transition-colors group-hover:bg-accent group-hover:text-accent-fg
              "
              aria-hidden
            >
              <Play size={11} fill="currentColor" />
            </span>
          </div>
          <p className="text-xs leading-relaxed text-fg-muted line-clamp-3">
            {s.description}
          </p>
          <div className="mt-1 flex w-full items-center justify-between text-[10px] uppercase tracking-wide text-fg-subtle">
            <span className="font-mono">{s.service}</span>
            <span>{s.severity}</span>
          </div>
        </motion.button>
      ))}
    </div>
  );
}
