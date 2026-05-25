"use client";

import { motion } from "framer-motion";

const STATS = [
  { value: "16",  label: "Graph nodes" },
  { value: "5",   label: "Demo scenarios" },
  { value: "3",   label: "Parallel investigators" },
  { value: "2",   label: "HITL gates" },
  { value: "0",   label: "LLMs in the verify loop" },
];

export function StatsStrip() {
  return (
    <section className="
      grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line
      bg-line sm:grid-cols-3 lg:grid-cols-5
    ">
      {STATS.map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.3, delay: i * 0.05 }}
          className="bg-bg-elev px-5 py-6 text-center"
        >
          <div className="font-display text-3xl font-bold tracking-tight text-fg">
            {s.value}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
            {s.label}
          </div>
        </motion.div>
      ))}
    </section>
  );
}
