import type { ReactNode } from "react";
import type { DataStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { fmtPctPoints, signClass } from "@/lib/format";

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("panel flex min-w-0 flex-col", className)}>
      {(title || actions) && (
        <header className="panel-head">
          <div className="flex min-w-0 items-baseline gap-2">
            {title && <h2 className="panel-title">{title}</h2>}
            {subtitle && (
              <span className="truncate text-[10px] text-[var(--ink-3)]">{subtitle}</span>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cn("min-w-0 flex-1", bodyClassName ?? "p-3")}>{children}</div>
    </section>
  );
}

export function StatusBadge({
  status,
  reason,
}: {
  status: DataStatus;
  reason?: string;
}) {
  const styles: Record<DataStatus, string> = {
    LIVE: "border-emerald-500/50 bg-emerald-500/10 text-emerald-400",
    // A closed venue is a correct, healthy state — not a warning colour.
    MARKET_CLOSED: "border-[var(--line)] bg-[var(--panel-2)] text-[var(--ink-2)]",
    STALE: "border-amber-500/50 bg-amber-500/10 text-amber-400",
    UNAVAILABLE: "border-rose-500/50 bg-rose-500/10 text-rose-400",
  };
  const dot: Record<DataStatus, string> = {
    LIVE: "bg-emerald-400",
    MARKET_CLOSED: "bg-[var(--ink-3)]",
    STALE: "bg-amber-400",
    UNAVAILABLE: "bg-rose-400",
  };
  const label: Record<DataStatus, string> = {
    LIVE: "LIVE",
    MARKET_CLOSED: "MARKET CLOSED",
    STALE: "STALE",
    UNAVAILABLE: "UNAVAILABLE",
  };
  return (
    <span className={cn("chip", styles[status])} title={reason}>
      <span className={cn("h-1.5 w-1.5 rounded-full", dot[status])} />
      {label[status]}
    </span>
  );
}

export function Kpi({
  label,
  value,
  sub,
  tone,
  title,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "pos" | "neg" | "flat" | "amber";
  title?: string;
}) {
  const toneClass =
    tone === "pos"
      ? "text-[var(--up)]"
      : tone === "neg"
        ? "text-[var(--down)]"
        : tone === "amber"
          ? "text-[var(--amber)]"
          : "text-[var(--ink)]";
  return (
    <div className="min-w-0 px-3 py-2" title={title}>
      <div className="kpi-label truncate">{label}</div>
      <div className={cn("kpi-value truncate", toneClass)}>{value}</div>
      {sub !== undefined && (
        <div className="mt-0.5 truncate text-[10px] text-[var(--ink-3)]">{sub}</div>
      )}
    </div>
  );
}

/** Percentage-point delta with directional colour. */
export function Delta({ value, decimals = 2 }: { value: number | null | undefined; decimals?: number }) {
  return <span className={signClass(value)}>{fmtPctPoints(value == null ? null : value * 100, decimals)}</span>;
}

export function Chip({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "pos" | "neg" | "warn" | "info" | "amber";
  title?: string;
}) {
  const tones = {
    neutral: "border-[var(--line)] text-[var(--ink-2)]",
    pos: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    neg: "border-rose-500/40 bg-rose-500/10 text-rose-400",
    warn: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    info: "border-sky-500/40 bg-sky-500/10 text-sky-400",
    amber: "border-[var(--amber)]/40 bg-[rgba(255,160,40,0.1)] text-[var(--amber)]",
  } as const;
  return (
    <span className={cn("chip", tones[tone])} title={title}>
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center p-6 text-center text-[11px] text-[var(--ink-3)]">
      {children}
    </div>
  );
}

/** A one-line caveat rail. Used for data-availability notices and disclaimers. */
export function Note({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warn";
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 border-l-2 px-3 py-2 text-[11px] leading-relaxed",
        tone === "warn"
          ? "border-amber-500/70 bg-amber-500/5 text-amber-200/80"
          : "border-sky-500/70 bg-sky-500/5 text-sky-200/80",
      )}
    >
      {children}
    </div>
  );
}
