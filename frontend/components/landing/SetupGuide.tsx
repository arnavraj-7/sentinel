"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, ExternalLink } from "lucide-react";

import { GITHUB_URL } from "@/lib/config";
import { SectionHeader } from "./SectionHeader";

type OS = "windows" | "unix";

type Step = {
  title: string;
  description: string;
  code: Record<OS, string>;
  /** Inline note rendered under the code block */
  note?: string;
};

const STEPS: Step[] = [
  {
    title: "Clone the repos",
    description:
      "Sentinel itself + the example target service it'll patch. Both are public on GitHub.",
    code: {
      windows:
        "git clone https://github.com/arnavraj-7/sentinel\n" +
        "git clone https://github.com/arnavraj-7/codefix-testrepo",
      unix:
        "git clone https://github.com/arnavraj-7/sentinel\n" +
        "git clone https://github.com/arnavraj-7/codefix-testrepo",
    },
  },
  {
    title: "Install Python dependencies",
    description: "Create a virtualenv, activate it, install Sentinel + deps.",
    code: {
      windows:
        "cd sentinel\n" +
        "python -m venv .venv\n" +
        ".venv\\Scripts\\activate\n" +
        "pip install -e .",
      unix:
        "cd sentinel\n" +
        "python -m venv .venv\n" +
        "source .venv/bin/activate\n" +
        "pip install -e .",
    },
    note: "Requires Python 3.13+.",
  },
  {
    title: "Install frontend dependencies",
    description: "Next.js 16 + Tailwind v4. Standard npm install.",
    code: {
      windows: "cd frontend\nnpm install",
      unix: "cd frontend\nnpm install",
    },
    note: "Requires Node 22+.",
  },
  {
    title: "Authenticate Claude Code",
    description:
      "Sentinel's code-patch sub-graph uses the Claude Code CLI. Install it globally and log in once.",
    code: {
      windows: "npm install -g @anthropic-ai/claude-code\nclaude login",
      unix: "npm install -g @anthropic-ai/claude-code\nclaude login",
    },
    note: "Opens a browser to anthropic.com to authenticate.",
  },
  {
    title: "Set Gemini credentials",
    description:
      "Sentinel's reasoning agents (triager, RCA, planner, scribe) run on Gemini 2.5 Flash. Either set a key or use Vertex ADC.",
    code: {
      windows:
        '# Option A — direct API key:\n' +
        '$env:GOOGLE_API_KEY = "your_key_here"\n' +
        "\n" +
        "# Option B — Vertex AI (no key needed):\n" +
        "gcloud auth application-default login",
      unix:
        "# Option A — direct API key:\n" +
        "export GOOGLE_API_KEY=your_key_here\n" +
        "\n" +
        "# Option B — Vertex AI (no key needed):\n" +
        "gcloud auth application-default login",
    },
  },
  {
    title: "Start the backend",
    description:
      "Programmatic launcher — handles the Windows asyncio policy fix automatically. Leaves uvicorn running on localhost:8000.",
    code: {
      windows: "python run_server.py",
      unix: "python run_server.py",
    },
    note:
      "On Windows: --reload is intentionally disabled (uvicorn's reload supervisor breaks the Proactor loop the code-patch sub-graph needs).",
  },
  {
    title: "Start the frontend",
    description: "Open a second shell, leave it running on localhost:3000.",
    code: {
      windows: "cd frontend\nnpm run dev",
      unix: "cd frontend\nnpm run dev",
    },
  },
  {
    title: "Open the dashboard",
    description:
      "Click any scenario tile, watch the agents stream in real time. Code Defect is the headline demo — it fires the full sub-graph with a live Claude Code SDK call.",
    code: {
      windows: "http://localhost:3000/demo",
      unix: "http://localhost:3000/demo",
    },
  },
];

export function SetupGuide() {
  const [os, setOs] = useState<OS>(
    typeof navigator !== "undefined" && navigator.platform.includes("Win")
      ? "windows"
      : "unix",
  );

  return (
    <section id="setup" className="space-y-6 scroll-mt-20">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <SectionHeader
          index="04"
          eyebrow="Setup"
          title="Run it locally"
          description="About five minutes from a fresh clone to a running demo — real Gemini, real Claude Code, real differential test gate."
        />
        <div className="inline-flex items-center gap-0.5 rounded-md border border-line bg-bg-elev p-0.5 shrink-0">
          <OSButton current={os} target="windows" onClick={() => setOs("windows")} label="Windows" />
          <OSButton current={os} target="unix"    onClick={() => setOs("unix")}    label="macOS / Linux" />
        </div>
      </div>

      <PrereqsRow />

      <ol className="relative space-y-4">
        {/* Vertical timeline connector */}
        <span
          aria-hidden
          className="absolute left-[19px] top-2 bottom-2 w-px bg-line"
        />
        {STEPS.map((step, i) => (
          <StepRow key={step.title} step={step} index={i} os={os} />
        ))}
      </ol>

      <ClonedNote />
    </section>
  );
}

function OSButton({
  current, target, onClick, label,
}: {
  current: OS;
  target: OS;
  onClick: () => void;
  label: string;
}) {
  const active = current === target;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        rounded-[5px] px-3 py-1.5 text-xs font-medium transition-colors
        ${active
          ? "bg-bg-subtle text-fg ring-1 ring-line-strong"
          : "text-fg-muted hover:text-fg"}
      `}
    >
      {label}
    </button>
  );
}

function PrereqsRow() {
  const items = [
    { name: "Python", v: "3.13+" },
    { name: "Node",   v: "22+"   },
    { name: "Git",    v: "any"   },
    { name: "Claude Code CLI", v: "latest" },
    { name: "Gemini access",   v: "API key or Vertex ADC" },
  ];
  return (
    <div className="
      flex flex-wrap items-center gap-2 rounded-lg border border-line
      bg-bg-elev/50 px-4 py-3
    ">
      <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
        Prerequisites
      </span>
      {items.map(i => (
        <span
          key={i.name}
          className="
            inline-flex items-center gap-1.5 rounded-md border border-line
            bg-bg-elev px-2 py-0.5 text-[11px] text-fg-muted
          "
        >
          <span className="font-medium text-fg">{i.name}</span>
          <span className="font-mono text-[10px] text-fg-subtle">· {i.v}</span>
        </span>
      ))}
    </div>
  );
}

function StepRow({
  step, index, os,
}: { step: Step; index: number; os: OS }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.3, delay: (index % 8) * 0.04 }}
      className="relative flex gap-5"
    >
      {/* Step number badge — sits on the vertical connector */}
      <div className="relative shrink-0">
        <div className="
          relative z-10 flex h-10 w-10 items-center justify-center rounded-full
          border border-line bg-bg-elev font-display text-sm font-semibold text-fg
        ">
          {String(index + 1).padStart(2, "0")}
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-2 pb-2">
        <div>
          <h3 className="font-display text-base font-semibold tracking-tight text-fg">
            {step.title}
          </h3>
          <p className="mt-0.5 text-[13px] text-fg-muted">{step.description}</p>
        </div>
        <CodeBlock code={step.code[os]} />
        {step.note && (
          <p className="text-[11px] text-fg-subtle">↳ {step.note}</p>
        )}
      </div>
    </motion.li>
  );
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard denied — ignore */ }
  };
  return (
    <div className="relative group">
      <pre className="
        overflow-x-auto rounded-md border border-line bg-code-bg
        px-4 py-3 pr-12 font-mono text-[12.5px] leading-relaxed text-fg
      ">{code}</pre>
      <button
        type="button"
        onClick={copy}
        className="
          absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center
          rounded-md border border-line bg-bg-elev/80 text-fg-muted
          opacity-0 transition-opacity group-hover:opacity-100
          hover:text-fg hover:border-line-strong
        "
        title={copied ? "Copied" : "Copy"}
        aria-label={copied ? "Copied" : "Copy to clipboard"}
      >
        {copied ? (
          <Check size={12} className="text-success" strokeWidth={2.5} />
        ) : (
          <Copy size={12} strokeWidth={2} />
        )}
      </button>
    </div>
  );
}

function ClonedNote() {
  return (
    <div className="
      flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line
      bg-bg-elev/50 px-4 py-3
    ">
      <p className="text-xs text-fg-muted">
        Hit something unexpected? Open an issue or check the README.
      </p>
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="
          inline-flex items-center gap-1.5 rounded-md border border-line
          bg-bg-elev px-3 py-1.5 text-xs font-medium text-fg
          transition-colors hover:bg-bg-subtle hover:border-line-strong
        "
      >
        Open repo
        <ExternalLink size={11} />
      </a>
    </div>
  );
}
