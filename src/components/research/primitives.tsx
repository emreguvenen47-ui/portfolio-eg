import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared building blocks for the research panels. */

/**
 * Compact money, in the reporting currency of the surrounding panel.
 *
 * Statements are filed in the issuer's own currency, so a Turkish filer's
 * figures must not carry a dollar sign — that is a factor-of-forty error, not
 * a cosmetic one.
 */
export const compactMoney = (n: number | null | undefined, symbol = "$"): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "N/A";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${symbol}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${symbol}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${symbol}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${symbol}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${symbol}${abs.toFixed(0)}`;
};

/** Back-compat alias for call sites that are always USD. */
export const compactUsd = (n: number | null | undefined): string => compactMoney(n, "$");

export function fmtValue(
  v: number | null | undefined,
  format: "usd" | "pct" | "num" | "x",
  moneySymbol = "$",
): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "N/A";
  switch (format) {
    case "usd":
      return compactMoney(v, moneySymbol);
    case "pct":
      return `${v.toFixed(1)}%`;
    case "x":
      return `${v.toFixed(2)}×`;
    default:
      return v.toFixed(2);
  }
}

/** Signed change, coloured by whether the move is good — not by its sign. */
export function Change({
  value,
  suffix = "%",
  good,
}: {
  value: number | null;
  suffix?: string;
  /** Direction that counts as an improvement. Omit for neutral colouring. */
  good?: "up" | "down";
}) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="text-[var(--ink-3)]">N/A</span>;
  }
  const improving = good === undefined ? null : good === "up" ? value > 0 : value < 0;
  return (
    <span
      className={cn(
        "tabular-nums",
        improving === null ? "" : improving ? "text-emerald-400" : "text-rose-400",
      )}
    >
      {value > 0 ? "+" : ""}
      {value.toFixed(1)}
      {suffix}
    </span>
  );
}

/** Trend arrow. Direction already encodes good/bad — this only renders it. */
export function Arrow({ direction }: { direction: "up" | "flat" | "down" }) {
  const glyph = direction === "up" ? "↑" : direction === "down" ? "↓" : "→";
  const tone =
    direction === "up"
      ? "text-emerald-400"
      : direction === "down"
        ? "text-rose-400"
        : "text-[var(--ink-3)]";
  const title =
    direction === "up" ? "Improving" : direction === "down" ? "Deteriorating" : "Stable";
  return (
    <span className={cn("text-[11px]", tone)} title={title}>
      {glyph}
    </span>
  );
}

/**
 * Inline sparkline.
 *
 * Nulls break the path rather than being drawn as zero — a missing quarter is
 * a gap in the line, not a collapse to the axis.
 */
export function Spark({
  series,
  width = 72,
  height = 18,
}: {
  series: (number | null)[];
  width?: number;
  height?: number;
}) {
  const pts = series.filter((v): v is number => v !== null && Number.isFinite(v));
  if (pts.length < 2) {
    return <span className="text-[9px] text-[var(--ink-3)]">—</span>;
  }

  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const step = width / Math.max(1, series.length - 1);

  const segments: string[] = [];
  let current: string[] = [];
  series.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      return;
    }
    const x = i * step;
    const y = height - ((v - min) / span) * (height - 2) - 1;
    current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current.join(" "));

  const rising = (pts.at(-1) ?? 0) >= pts[0];

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden>
      {segments.map((s, i) => (
        <polyline
          key={i}
          points={s}
          fill="none"
          strokeWidth={1.25}
          className={rising ? "stroke-emerald-400/80" : "stroke-rose-400/80"}
        />
      ))}
    </svg>
  );
}

/** A compact label/value line, the workhorse of these panels. */
export function Metric({
  label,
  value,
  hint,
  trend,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  trend?: "up" | "flat" | "down";
  tone?: "pos" | "neg" | "flat";
}) {
  return (
    <div
      className="flex items-baseline justify-between gap-2 px-3 py-1 text-[11px]"
      title={hint}
    >
      <span className="truncate text-[var(--ink-2)]">{label}</span>
      <span className="flex shrink-0 items-baseline gap-1">
        <span
          className={cn(
            "tabular-nums font-medium",
            tone === "pos" ? "text-emerald-400" : tone === "neg" ? "text-rose-400" : "",
          )}
        >
          {value}
        </span>
        {trend && <Arrow direction={trend} />}
      </span>
    </div>
  );
}

/** Small 0–100 bar used by the health pillars. */
export function ScoreBar({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="text-[10px] text-[var(--ink-3)]">N/A</span>;
  }
  const tone =
    score >= 65 ? "bg-emerald-400/70" : score <= 40 ? "bg-rose-400/70" : "bg-[var(--amber)]/70";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-16 overflow-hidden rounded-sm bg-[var(--panel-2)]">
        <div className={cn("h-full", tone)} style={{ width: `${score}%` }} />
      </div>
      <span className="w-7 shrink-0 text-right tabular-nums text-[10px]">{score}</span>
    </div>
  );
}
