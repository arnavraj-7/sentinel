"use client";

import * as Collapsible from "@radix-ui/react-collapsible";
import { motion } from "framer-motion";
import { useState } from "react";
import { BookText, ChevronDown, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function PostMortemPanel({ markdown }: { markdown: string }) {
  const [open, setOpen] = useState(true);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-line bg-bg-elev shadow-[var(--shadow-card)] overflow-hidden"
    >
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <Collapsible.Trigger className="
          flex w-full items-center justify-between gap-2 border-b border-line bg-bg-subtle
          px-5 py-3 text-left transition-colors hover:bg-bg
        ">
          <div className="flex items-center gap-2.5">
            <BookText size={15} strokeWidth={2.5} className="text-fg-muted" />
            <span className="font-display text-sm font-semibold tracking-tight">Post-Mortem</span>
          </div>
          {open ? <ChevronDown size={14} className="text-fg-muted" /> : <ChevronRight size={14} className="text-fg-muted" />}
        </Collapsible.Trigger>
        <Collapsible.Content>
          <article className="prose-pm max-w-none px-6 py-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {markdown}
            </ReactMarkdown>
          </article>
        </Collapsible.Content>
      </Collapsible.Root>
    </motion.div>
  );
}
