"use client";

import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import { motion } from "framer-motion";
import { GithubIcon } from "@/components/GithubIcon";
import { GITHUB_URL } from "@/lib/config";

export function CTASection() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4 }}
      className="
        relative overflow-hidden rounded-2xl border border-line bg-bg-elev
        px-8 py-10 text-center shadow-[var(--shadow-card)] sm:px-16 sm:py-14
      "
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-25 blur-3xl"
        style={{
          background:
            "radial-gradient(60% 80% at 50% 0%, var(--accent), transparent 70%)",
        }}
      />

      <div className="relative">
        <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Watch it diagnose, patch, and verify — in 90 seconds.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm text-fg-muted sm:text-base">
          Click any scenario on the live demo. The graph animates, the agents
          stream their reasoning, and (for the code-patch demo) a real Claude
          Code session writes and verifies a fix.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/demo"
            className="
              group inline-flex items-center gap-2 rounded-md
              bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg
              shadow-[var(--shadow-elev)]
              transition-all hover:-translate-y-0.5 hover:shadow-xl
            "
          >
            <Play size={14} fill="currentColor" />
            Open the live demo
            <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="
              inline-flex items-center gap-2 rounded-md
              border border-line bg-bg-elev/80 px-5 py-2.5
              text-sm font-medium text-fg backdrop-blur
              transition-colors hover:bg-bg-subtle hover:border-line-strong
            "
          >
            <GithubIcon size={14} />
            Read the source
          </a>
        </div>
      </div>
    </motion.section>
  );
}
