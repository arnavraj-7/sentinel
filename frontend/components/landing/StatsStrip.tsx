"use client";

import { motion } from "framer-motion";

const STATS = [
  { value: "16", label: "Graph nodes",           accent: "from-accent to-info" },
  { value: "5",  label: "Demo scenarios",        accent: "from-info to-accent" },
  { value: "3",  label: "Parallel investigators", accent: "from-accent to-info" },
  { value: "2",  label: "HITL gates",            accent: "from-info to-accent" },
  { value: "0",  label: "LLMs in the verify loop", accent: "from-accent to-info" },
];

export function StatsStrip() {
  return (
    <section className="
      grid grid-cols-2 overflow-hidden rounded-xl border border-line
      bg-bg-elev sm:grid-cols-3 lg:grid-cols-5
    ">
      {STATS.map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.35, delay: i * 0.05 }}
          className={`
            group relative px-6 py-7
            ${i > 0 ? "border-t border-line sm:border-t-0 sm:border-l" : ""}
            ${i === 2 ? "sm:border-t lg:border-t-0" : ""}
            ${i === 3 || i === 4 ? "sm:border-t lg:border-t-0" : ""}
          `}
        >
          {/* Top-edge gradient accent — appears on hover */}
          <span
            aria-hidden
            className={`
              absolute inset-x-0 top-0 h-px bg-gradient-to-r ${s.accent}
              opacity-30 transition-opacity duration-300
              group-hover:opacity-100
            `}
          />
          <div className="
            font-display text-4xl font-bold tracking-tight text-fg
            transition-colors group-hover:text-accent
          ">
            {s.value}
          </div>
          <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-fg-subtle">
            {s.label}
          </div>
        </motion.div>
      ))}
    </section>
  );
}
