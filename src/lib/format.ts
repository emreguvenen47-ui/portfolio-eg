const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usd2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const num2 = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const fmtUsd = (v: number, decimals = 0): string =>
  Number.isFinite(v) ? (decimals === 0 ? usd0 : usd2).format(v) : "—";

/** Compact money for tight columns: $3.5M, $250K. */
export function fmtUsdCompact(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1_000_000_000) return `${sign}$${(a / 1_000_000_000).toFixed(2)}B`;
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

/** Ratio (0.0345) -> "3.45%". Pass `signed` for an explicit +. */
export function fmtPct(v: number | null | undefined, decimals = 2, signed = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const p = v * 100;
  const s = signed && p > 0 ? "+" : "";
  return `${s}${p.toFixed(decimals)}%`;
}

/** Already-percent value (3.45) -> "3.45%". */
export function fmtPctPoints(v: number | null | undefined, decimals = 2, signed = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = signed && v > 0 ? "+" : "";
  return `${s}${v.toFixed(decimals)}%`;
}

/** Weight points, e.g. drift of +1.3pp. */
export const fmtPp = (v: number, decimals = 2): string =>
  Number.isFinite(v) ? `${v > 0 ? "+" : ""}${(v * 100).toFixed(decimals)}pp` : "—";

export const fmtNum = (v: number | null | undefined, decimals = 2): string =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "—"
    : new Intl.NumberFormat("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(v);

export const fmt2 = (v: number): string => (Number.isFinite(v) ? num2.format(v) : "—");

export const signClass = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(v) || Math.abs(v) < 1e-12
    ? "flat"
    : v > 0
      ? "pos"
      : "neg";

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";
}

export const fmtDate = (iso: string): string => iso.slice(0, 10);

/** Blue -> red diverging scale for correlation cells. */
export function correlationColor(r: number): string {
  const c = Math.max(-1, Math.min(1, r));
  if (c >= 0) {
    const a = 0.08 + c * 0.5;
    return `rgba(240, 97, 109, ${a.toFixed(3)})`;
  }
  const a = 0.08 + Math.abs(c) * 0.5;
  return `rgba(79, 157, 247, ${a.toFixed(3)})`;
}
