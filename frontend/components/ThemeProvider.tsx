"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { type ComponentProps } from "react";

// Thin re-export so layout.tsx (a server component) doesn't have to
// directly import next-themes (a client lib). next-themes manages the
// `class` attribute on <html> — globals.css's `.dark { ... }` block
// reacts to it.
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
