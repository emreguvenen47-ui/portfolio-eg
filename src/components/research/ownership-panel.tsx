import Link from "next/link";
import { Chip } from "@/components/shell/ui";
import { compactUsd } from "./primitives";
import type { OwnershipReport } from "@/lib/providers/ownership";
import { radar } from "@/lib/providers/ownership";
import type { ETFHoldings } from "@/lib/providers/etf-holdings";
import type { InsiderReport } from "@/lib/research/insiders";

/**
 * Ownership: institutions, funds and insiders.
 *
 * The reporting period and filing date are rendered before any position, not
 * after, because a 13F is a snapshot up to 45 days stale and reading it as
 * current positioning is the single most common misuse of the data.
 */
export function OwnershipPanel({
  ownership,
  insiders,
  etfs,
}: {
  ownership: OwnershipReport;
  insiders: InsiderReport | null;
  etfs: { available: boolean; rows: { etf: string; weight: number; rank: number; aum: number | null }[] };
}) {
  const r = radar(ownership.holders);

  return (
    <div>
      <div className="grid grid-cols-3 divide-x divide-[var(--line)] border-b border-[var(--line)]">
        <div className="px-3 py-2">
          <div className="text-[9.5px] uppercase tracking-wide text-[var(--ink-3)]">
            Institutional
          </div>
          <div className="tabular-nums text-[13px] font-semibold">
            {ownership.breakdown.institutional === null
              ? "N/A"
              : `${ownership.breakdown.institutional.toFixed(1)}%`}
          </div>
        </div>
        <div className="px-3 py-2">
          <div className="text-[9.5px] uppercase tracking-wide text-[var(--ink-3)]">ETF</div>
          <div className="tabular-nums text-[13px] font-semibold">
            {ownership.breakdown.etf === null ? "N/A" : `${ownership.breakdown.etf.toFixed(1)}%`}
          </div>
        </div>
        <div className="px-3 py-2">
          <div className="text-[9.5px] uppercase tracking-wide text-[var(--ink-3)]">
            Insider (Form 4)
          </div>
          <div className="tabular-nums text-[13px] font-semibold">
            {insiders ? `${insiders.rows.length} filings` : "N/A"}
          </div>
        </div>
      </div>

      {/* --- reporting vintage, stated before any position --- */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[var(--line)] bg-[var(--panel-2)] px-3 py-1.5 text-[10px]">
        <span className="text-[var(--ink-3)]">
          Reporting period:{" "}
          <span className="text-[var(--ink)]">{ownership.reportingPeriod ?? "N/A"}</span>
        </span>
        <span className="text-[var(--ink-3)]">
          Filing date: <span className="text-[var(--ink)]">{ownership.latestFiling ?? "N/A"}</span>
        </span>
        <Chip tone="warn">DELAYED FILING DATA</Chip>
      </div>

      {!ownership.available ? (
        <div className="px-3 py-3 text-[10.5px] leading-snug text-[var(--ink-3)]">
          {ownership.note}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-2 border-b border-[var(--line)] px-3 py-2">
            <span className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
              Ownership Trend
            </span>
            <Chip
              tone={
                r.trend === "ACCUMULATING" ? "pos" : r.trend === "DISTRIBUTING" ? "neg" : "neutral"
              }
            >
              {r.trend}
            </Chip>
            <span className="min-w-0 flex-1 text-[10px] text-[var(--ink-2)]">{r.why}</span>
          </div>
          <div className="grid grid-cols-4 divide-x divide-[var(--line)] border-b border-[var(--line)] text-center">
            {[
              ["Increased", r.increased],
              ["Reduced", r.reduced],
              ["New", r.newPositions],
              ["Exited", r.exited],
            ].map(([l, v]) => (
              <div key={String(l)} className="px-2 py-1.5">
                <div className="text-[9.5px] text-[var(--ink-3)]">{l}</div>
                <div className="tabular-nums text-[12px]">{v}</div>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Holder</th>
                  <th>Shares</th>
                  <th>Own %</th>
                  <th>Value</th>
                  <th className="tl">Change</th>
                  <th className="tl">As Of</th>
                  <th className="tl">Filed</th>
                </tr>
              </thead>
              <tbody>
                {ownership.holders.slice(0, 25).map((h) => (
                  <tr key={h.name}>
                    <td className="tl">{h.name}</td>
                    <td className="tabular-nums">{h.shares.toLocaleString()}</td>
                    <td className="tabular-nums">
                      {h.ownershipPct === null ? "N/A" : `${h.ownershipPct.toFixed(2)}%`}
                    </td>
                    <td className="tabular-nums">{compactUsd(h.value)}</td>
                    <td className="tl">
                      <Chip
                        tone={
                          h.change === "INCREASED" || h.change === "NEW POSITION"
                            ? "pos"
                            : h.change === "REDUCED" || h.change === "SOLD OUT"
                              ? "neg"
                              : "neutral"
                        }
                      >
                        {h.change}
                      </Chip>
                    </td>
                    <td className="tl tabular-nums text-[10px]">{h.asOf}</td>
                    <td className="tl tabular-nums text-[10px] text-[var(--ink-3)]">{h.filedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] leading-snug text-[var(--ink-3)]">
            {ownership.note}
          </div>
        </>
      )}

      {/* --- reverse ETF lookup --- */}
      <div className="border-t border-[var(--line)] px-3 py-2">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
          Which ETFs own this stock?
        </div>
        {!etfs.available ? (
          <p className="text-[10.5px] leading-snug text-[var(--ink-3)]">
            N/A — no ETF holdings source is configured. This is a gap, not a statement that no
            fund holds the stock.
          </p>
        ) : etfs.rows.length === 0 ? (
          <p className="text-[10.5px] text-[var(--ink-3)]">
            None of the tracked funds list this stock in their published holdings.
          </p>
        ) : (
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">ETF</th>
                <th>Weight</th>
                <th>Rank</th>
                <th>Fund AUM</th>
              </tr>
            </thead>
            <tbody>
              {etfs.rows.map((row) => (
                <tr key={row.etf}>
                  <td className="tl">
                    <Link href={`/ticker/${row.etf}`} className="hover:text-[var(--amber)]">
                      {row.etf}
                    </Link>
                  </td>
                  <td className="tabular-nums">{row.weight.toFixed(2)}%</td>
                  <td className="tabular-nums text-[var(--ink-3)]">#{row.rank}</td>
                  <td className="tabular-nums">{compactUsd(row.aum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** ETF holdings explorer, for fund pages. */
export function HoldingsPanel({ data }: { data: ETFHoldings }) {
  if (!data.available) {
    return (
      <div className="px-3 py-3 text-[10.5px] leading-snug text-[var(--ink-3)]">
        <Chip tone="neutral">N/A</Chip> <span className="ml-1">{data.note}</span>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="grid-table">
        <thead>
          <tr>
            <th className="tl">Ticker</th>
            <th className="tl">Company</th>
            <th>Weight</th>
            <th className="tl">Sector</th>
            <th className="tl">Country</th>
            <th>Value</th>
            <th>Δ Weight</th>
          </tr>
        </thead>
        <tbody>
          {data.holdings.slice(0, 100).map((h) => (
            <tr key={h.ticker}>
              <td className="tl font-semibold">
                <Link href={`/ticker/${h.ticker}`} className="hover:text-[var(--amber)]">
                  {h.ticker}
                </Link>
              </td>
              <td className="tl max-w-[220px] truncate">{h.name}</td>
              <td className="tabular-nums">{h.weight.toFixed(2)}%</td>
              <td className="tl text-[10px] text-[var(--ink-3)]">{h.sector ?? "N/A"}</td>
              <td className="tl text-[10px] text-[var(--ink-3)]">{h.country ?? "N/A"}</td>
              <td className="tabular-nums">{compactUsd(h.value)}</td>
              <td className="tabular-nums text-[var(--ink-3)]">
                {h.weightChange === null ? "N/A" : `${h.weightChange > 0 ? "+" : ""}${h.weightChange.toFixed(2)}pp`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
