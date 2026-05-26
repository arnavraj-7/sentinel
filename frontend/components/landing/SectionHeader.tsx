"use client";

import { motion } from "framer-motion";

// Reusable section header — eyebrow + headline + description.
// Anchors visual rhythm across the landing.

export function SectionHeader({
  index,
  eyebrow,
  title,
  description,
  align = "left",
}: {
  /** Two-digit section index, e.g. "02" */
  index?: string;
  /** Small uppercase label above the headline */
  eyebrow: string;
  /** The H2 headline */
  title: React.ReactNode;
  /** Sub-text */
  description?: React.ReactNode;
  align?: "left" | "center";
}) {
  return (
    <header className={`space-y-3 ${align === "center" ? "text-center" : ""}`}>
      <motion.p
        initial={{ opacity: 0, y: 6 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.3 }}
        className={`
          inline-flex items-center gap-2
          font-mono text-[10px] uppercase tracking-[0.2em] text-accent
        `}
      >
        {index && (
          <span className="text-fg-subtle">{index}</span>
        )}
        {index && <span className="text-fg-subtle">·</span>}
        {eyebrow}
      </motion.p>
      <motion.h2
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4, delay: 0.05 }}
        className="
          font-display text-3xl font-bold tracking-tight text-fg
          sm:text-4xl
        "
      >
        {title}
      </motion.h2>
      {description && (
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className={`
            max-w-2xl text-[15px] leading-relaxed text-fg-muted sm:text-base
            ${align === "center" ? "mx-auto" : ""}
          `}
        >
          {description}
        </motion.p>
      )}
    </header>
  );
}
