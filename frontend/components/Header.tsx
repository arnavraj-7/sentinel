"use client";

import { Shield } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ConnectionStatus } from "./ConnectionStatus";
import { GithubIcon } from "./GithubIcon";
import { ThemeToggle } from "./ThemeToggle";
import { GITHUB_URL, PROJECT_NAME, PROJECT_TAGLINE } from "@/lib/config";

const NAV = [
  { href: "/",     label: "Overview" },
  { href: "/demo", label: "Live Demo" },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-4 px-6">
        {/* Logo / brand */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div
            className="
              flex h-7 w-7 items-center justify-center rounded-md
              bg-gradient-to-br from-accent to-info text-accent-fg
              shadow-sm transition-shadow group-hover:shadow-md
            "
          >
            <Shield size={15} strokeWidth={2.5} />
          </div>
          <div className="hidden items-baseline gap-2 sm:flex">
            <span className="font-display text-base font-semibold tracking-tight">
              {PROJECT_NAME}
            </span>
            <span className="text-xs text-fg-muted">{PROJECT_TAGLINE}</span>
          </div>
        </Link>

        {/* Nav */}
        <nav className="flex items-center gap-1">
          {NAV.map(item => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  relative inline-flex items-center rounded-md px-3 py-1.5
                  text-[13px] font-medium transition-colors
                  ${active
                    ? "text-fg"
                    : "text-fg-muted hover:text-fg hover:bg-bg-subtle"}
                `}
              >
                {item.label}
                {active && (
                  <span
                    aria-hidden
                    className="
                      absolute inset-x-3 -bottom-[14px] h-[2px] rounded-full
                      bg-gradient-to-r from-accent to-info
                    "
                  />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Right cluster */}
        <div className="flex items-center gap-2">
          <ConnectionStatus />
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="
              inline-flex h-9 items-center gap-1.5 rounded-md
              border border-line bg-bg-elev px-3
              text-xs font-medium text-fg-muted
              transition-colors hover:text-fg hover:border-line-strong
            "
            title="View source on GitHub"
          >
            <GithubIcon size={14} />
            <span className="hidden sm:inline">Source</span>
          </a>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
