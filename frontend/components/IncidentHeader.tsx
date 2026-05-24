"use client";

import { Activity, AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { IncidentState } from "@/lib/types";

type Props = { incident: IncidentState };

const STATUS_STYLES: Record<string, { Icon: typeof Activity; tint: string; label: string }> = {
  idle:      { Icon: Activity, tint: "text-fg-subtle bg-bg-subtle",        label: "Idle" },
  streaming: { Icon: Loader2,  tint: "text-running bg-running/10",         label: "Streaming" },
  paused:    { Icon: AlertTriangle, tint: "text-warning bg-warning/10",    label: "HITL — Awaiting approval" },
  done:      { Icon: CheckCircle2, tint: "text-success bg-success/10",     label: "Done" },
  error:     { Icon: XCircle,  tint: "text-danger bg-danger/10",           label: "Error" },
};

export function IncidentHeader({ incident }: Props) {
  if (incident.status === "idle") return null;

  const meta = STATUS_STYLES[incident.status] ?? STATUS_STYLES.idle;
  const { Icon, tint, label } = meta;
  const spinning = incident.status === "streaming";

  return (
    <div className="
      flex flex-wrap items-start justify-between gap-4
      rounded-xl border border-line bg-bg-elev px-5 py-4 shadow-[var(--shadow-card)]
    ">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="
            inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5
            text-[11px] font-medium uppercase tracking-wider
          " style={{}}>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 ${tint}`}>
              <Icon size={11} className={spinning ? "animate-spin" : ""} strokeWidth={2.5} />
              {label}
            </span>
          </span>
          {incident.id && (
            <span className="font-mono text-[11px] text-fg-muted">
              {incident.id}
            </span>
          )}
          {incident.outcome && (
            <span className="
              inline-flex items-center rounded-full bg-bg-subtle px-2 py-0.5
              font-mono text-[10px] uppercase tracking-wide text-fg-muted
            ">
              outcome: {incident.outcome}
            </span>
          )}
        </div>
        <h2 className="font-display text-xl font-semibold tracking-tight text-fg">
          {incident.scenarioTitle ?? "Incident"}
        </h2>
      </div>

      {incident.error && (
        <div className="
          flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5
          px-3 py-2 text-xs text-danger
        ">
          <XCircle size={14} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">{incident.error.type}</div>
            <div className="font-mono">{incident.error.message}</div>
          </div>
        </div>
      )}
    </div>
  );
}
