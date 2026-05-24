"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // Avoid hydration mismatch — next-themes only knows the theme after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="
        inline-flex h-9 w-9 items-center justify-center rounded-md
        border border-line bg-bg-elev text-fg-muted
        transition-colors hover:text-fg hover:border-line-strong
      "
      aria-label="Toggle theme"
      title={isDark ? "Switch to light" : "Switch to dark"}
    >
      {/* Render both icons to avoid layout shift; CSS hides the inactive one */}
      {mounted ? (
        isDark ? <Sun size={16} strokeWidth={2} /> : <Moon size={16} strokeWidth={2} />
      ) : (
        <span className="size-4" />
      )}
    </button>
  );
}
