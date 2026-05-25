"use client";

import type { LucideIcon } from "lucide-react";

export type Tab = {
  id: string;
  label: string;
  Icon: LucideIcon;
  hasContent?: boolean;   // shows a dot indicator when content is available
};

export function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center border-b border-line bg-bg-subtle/40">
      {tabs.map(tab => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`
              relative inline-flex items-center gap-1.5 px-4 py-2.5
              text-[13px] font-medium transition-colors
              ${isActive
                ? "text-fg"
                : "text-fg-muted hover:text-fg hover:bg-bg-subtle"}
            `}
          >
            <tab.Icon size={13} strokeWidth={2} />
            {tab.label}
            {tab.hasContent && !isActive && (
              <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-accent" />
            )}
            {isActive && (
              <span
                aria-hidden
                className="
                  absolute inset-x-3 -bottom-px h-[2px] rounded-full
                  bg-gradient-to-r from-accent to-info
                "
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
