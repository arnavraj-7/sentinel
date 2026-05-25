"use client";

import { Shield } from "lucide-react";
import { ConnectionStatus } from "./ConnectionStatus";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <div
            className="
              flex h-7 w-7 items-center justify-center rounded-md
              bg-gradient-to-br from-accent to-info text-accent-fg
              shadow-sm
            "
          >
            <Shield size={15} strokeWidth={2.5} />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-base font-semibold tracking-tight">
              Sentinel
            </span>
            <span className="hidden text-xs text-fg-muted sm:inline">
              AI SRE Copilot
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <ConnectionStatus />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
