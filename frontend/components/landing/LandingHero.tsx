"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";

import { GithubIcon } from "@/components/GithubIcon";
import { GITHUB_URL } from "@/lib/config";

// Left-side hero (paired with DemoPreview on the right at the landing
// top). Left-aligned, narrower than the centered version because it
// occupies one column of a 2-col grid on lg+ screens.

export function LandingHero() {
  return (
    <section className="relative h-full overflow-hidden rounded-3xl border border-line bg-bg-elev px-8 py-12 shadow-[var(--shadow-card)] sm:px-10 sm:py-14">
      {/* Decorative gradient orbs for depth */}
      <div
        aria-hidden
        className="absolute -right-32 -top-32 h-80 w-80 rounded-full opacity-35 blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--accent), transparent 70%)" }}
      />
      <div
        aria-hidden
        className="absolute -bottom-32 -left-32 h-80 w-80 rounded-full opacity-25 blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--info), transparent 70%)" }}
      />
      <div aria-hidden className="absolute inset-0 grid-backdrop opacity-25" />

      <div className="relative flex h-full flex-col">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="inline-flex items-center gap-1.5 self-start rounded-full border border-line bg-bg/60 px-3 py-1 backdrop-blur"
        >
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-success pulse-ring" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Multi-agent · LangGraph · Live demo
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.06 }}
          className="
            mt-6 font-display text-3xl font-bold leading-[1.05] tracking-tight text-fg
            sm:text-4xl xl:text-5xl
          "
        >
          An AI SRE that{" "}
          <span className="bg-gradient-to-r from-accent to-info bg-clip-text text-transparent">
            diagnoses, patches, and verifies
          </span>{" "}
          production incidents.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.12 }}
          className="mt-5 max-w-xl text-sm leading-relaxed text-fg-muted sm:text-base"
        >
          Sentinel ingests a symptom-level alert, fans out three investigators
          in parallel, synthesises a root cause with reflective critique,
          gates dangerous actions on human approval, and — when the defect is
          in code — dispatches Claude Code to write a patch that survives a
          deterministic differential test gate.
        </motion.p>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.18 }}
          className="mt-8 flex flex-wrap items-center gap-3"
        >
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
            Run the live demo
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
            View source
          </a>
        </motion.div>
      </div>
    </section>
  );
}
