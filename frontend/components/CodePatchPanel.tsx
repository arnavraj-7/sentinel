"use client";

import * as Collapsible from "@radix-ui/react-collapsible";
import { motion } from "framer-motion";
import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  GitCommit,
  ShieldCheck,
  ShieldX,
  Wrench,
} from "lucide-react";

import type { CodePatchResult } from "@/lib/types";

const OUTCOME_STYLES: Record<string, { tint: string; Icon: typeof ShieldCheck; label: string }> = {
  verified:   { tint: "text-success border-success/30 bg-success/5",  Icon: ShieldCheck, label: "VERIFIED" },
  exhausted:  { tint: "text-warning border-warning/30 bg-warning/5",  Icon: ShieldX,     label: "EXHAUSTED" },
  fix_failed: { tint: "text-danger border-danger/30 bg-danger/5",     Icon: ShieldX,     label: "FIX FAILED" },
  fake_test:  { tint: "text-danger border-danger/30 bg-danger/5",     Icon: ShieldX,     label: "FAKE TEST" },
  error:      { tint: "text-danger border-danger/30 bg-danger/5",     Icon: ShieldX,     label: "ERROR" },
};

export function CodePatchPanel({ result }: { result: CodePatchResult }) {
  const [openSummary, setOpenSummary] = useState(true);
  const [openVerdict, setOpenVerdict] = useState(false);
  const meta = OUTCOME_STYLES[result.outcome] ?? OUTCOME_STYLES.error;
  const { Icon, tint, label } = meta;
  const report = result.last_report;
  const verif = result.last_verification;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-line bg-bg-elev shadow-[var(--shadow-card)] overflow-hidden"
    >
      <div className="flex items-center justify-between border-b border-line bg-bg-subtle px-5 py-3">
        <div className="flex items-center gap-2.5">
          <Wrench size={15} strokeWidth={2.5} className="text-fg-muted" />
          <span className="font-display text-sm font-semibold tracking-tight">Code Patch</span>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider ${tint}`}>
          <Icon size={11} strokeWidth={3} />
          {label}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
        <Stat label="Attempts" value={result.attempts.toString()} />
        {report?.commit_sha && (
          <Stat
            label="Commit"
            value={
              <span className="flex items-center gap-1.5">
                <GitCommit size={13} className="text-fg-muted" />
                <code className="font-mono text-xs text-fg">{report.commit_sha.slice(0, 10)}</code>
              </span>
            }
          />
        )}
        {report?.files_touched && report.files_touched.length > 0 && (
          <Stat
            label="Files"
            value={
              <ul className="space-y-1">
                {report.files_touched.map(f => (
                  <li key={f} className="flex items-center gap-1.5 font-mono text-xs">
                    <FileText size={11} className="text-fg-subtle" />
                    {f}
                  </li>
                ))}
              </ul>
            }
          />
        )}
      </div>

      {report?.summary && (
        <Collapsible.Root open={openSummary} onOpenChange={setOpenSummary}>
          <Collapsible.Trigger className="
            flex w-full items-center gap-2 border-t border-line bg-bg
            px-5 py-2.5 text-left text-xs font-medium text-fg-muted
            transition-colors hover:bg-bg-subtle hover:text-fg
          ">
            {openSummary ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            CC summary
          </Collapsible.Trigger>
          <Collapsible.Content>
            <div className="border-t border-line bg-bg-subtle px-5 py-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">
                {report.summary}
              </p>
            </div>
          </Collapsible.Content>
        </Collapsible.Root>
      )}

      {verif && (
        <Collapsible.Root open={openVerdict} onOpenChange={setOpenVerdict}>
          <Collapsible.Trigger className="
            flex w-full items-center gap-2 border-t border-line bg-bg
            px-5 py-2.5 text-left text-xs font-medium text-fg-muted
            transition-colors hover:bg-bg-subtle hover:text-fg
          ">
            {openVerdict ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Verifier verdict
            <span className={`
              ml-auto rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide
              ${verif.ok ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger"}
            `}>
              {verif.ok ? "passed" : "failed"}
            </span>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <div className="border-t border-line bg-bg-subtle px-5 py-3">
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-fg">
                {verif.description}
              </pre>
            </div>
          </Collapsible.Content>
        </Collapsible.Root>
      )}
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">{label}</p>
      <div className="text-sm text-fg">{value}</div>
    </div>
  );
}
