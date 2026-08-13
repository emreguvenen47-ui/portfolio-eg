"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Collapsible research section.
 *
 * The ticker page carries ten research panels now; rendering all of them open
 * would bury the price and chart. Content is always mounted and only hidden,
 * so collapsing costs nothing and browser find-in-page still works.
 */
export function Section({
  title,
  subtitle,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="panel flex min-w-0 flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="panel-head flex w-full items-center gap-2 text-left hover:bg-[var(--panel-2)]"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-[var(--ink-3)] transition-transform",
            open && "rotate-90",
          )}
          strokeWidth={2}
        />
        <span className="panel-title">{title}</span>
        {subtitle && (
          <span className="truncate text-[10px] text-[var(--ink-3)]">{subtitle}</span>
        )}
        <span className="ml-auto shrink-0">{badge}</span>
      </button>
      <div className={cn("min-w-0 flex-1", !open && "hidden")}>{children}</div>
    </section>
  );
}
