"use client";

import { useEffect, useState } from "react";
import { Cable } from "lucide-react";
import { API_BASE } from "@/lib/api";

type Status = "connecting" | "online" | "offline";

export function ConnectionStatus() {
  const [status, setStatus] = useState<Status>("connecting");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const resp = await fetch(`${API_BASE}/health`, { cache: "no-store" });
        if (!cancelled) setStatus(resp.ok ? "online" : "offline");
      } catch {
        if (!cancelled) setStatus("offline");
      }
    };
    check();
    const id = setInterval(check, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const tint: Record<Status, string> = {
    connecting: "text-fg-muted bg-bg-subtle border-line",
    online:     "text-success bg-success/10 border-success/30",
    offline:    "text-danger bg-danger/10 border-danger/30",
  };
  const label: Record<Status, string> = {
    connecting: "Connecting",
    online:     "Online",
    offline:    "Offline",
  };

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5
        font-mono text-[10px] uppercase tracking-wider
        ${tint[status]}
      `}
      title={`API @ ${API_BASE}`}
    >
      <Cable size={10} strokeWidth={2.5} />
      {label[status]}
      <span className="hidden sm:inline text-fg-subtle font-mono normal-case">
        · {API_BASE.replace(/^https?:\/\//, "")}
      </span>
    </span>
  );
}
