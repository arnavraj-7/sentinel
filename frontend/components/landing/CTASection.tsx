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
      transition={{ duration: 0.5 }}
      className="
        relative overflow-hidden rounded-3xl border border-line bg-bg-elev
        px-8 py-14 text-center shadow-[var(--shadow-elev)]
        sm:px-16 sm:py-20
      "
    >
      {/* Layered ambience — radial gradient + grid backdrop */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-30 blur-3xl"
        style={{
          background:
            "radial-gradient(60% 80% at 50% 0%, var(--accent), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-25 blur-3xl"
        style={{
          background:
            "radial-gradient(50% 70% at 50% 100%, var(--info), transparent 70%)",
        }}
      />
      <div aria-hidden className="absolute inset-0 grid-backdrop opacity-[0.25]" />

      <div className="relative">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
          Try it
        </p>
        <h2 className="
          mt-3 mx-auto max-w-3xl font-display text-4xl font-bold leading-[1.1]
          tracking-tight text-fg sm:text-5xl
        ">
          Watch an AI diagnose, patch, and verify —{" "}
          <span className="bg-gradient-to-r from-accent to-info bg-clip-text text-transparent">
            in 90 seconds
          </span>
          .
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-fg-muted sm:text-base">
          Click any scenario on the live demo. The graph animates, the agents
          stream their reasoning, and (for the code-patch demo) a real Claude
          Code session writes and verifies a fix.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/demo"
            className="
              group inline-flex items-center gap-2 rounded-md
              bg-accent px-6 py-3 text-sm font-semibold text-accent-fg
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
              border border-line bg-bg-elev/80 px-6 py-3
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
