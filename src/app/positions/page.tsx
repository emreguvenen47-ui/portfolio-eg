import Link from "next/link";
import { getContext } from "@/lib/server/context";
import { SampleBanner } from "@/components/shell/sample-banner";
import { Chip, Note, Panel } from "@/components/shell/ui";
import { rebalancePlan } from "@/lib/portfolio/analytics";
import {
  fmtNum,
  fmtPct,
  fmtPctPoints,
  fmtPp,
  fmtUsd,
  fmtUsdCompact,
  signClass,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PositionsPage() {
  const ctx = await getContext();
  if (ctx.error) return <Panel title="Error"><Note tone="warn">{ctx.error}</Note></Panel>;

  const { rows, settings, bundle, totals } = ctx;
  const flags = new Map(
    rebalancePlan(rows, settings.driftThreshold).rows.map((r) => [r.code, r.flag]),
  );
  const sorted = [...rows].sort((a, b) => b.value - a.value);

  // Day P&L in dollars per row and portfolio-wide (marked value × daily %).
  const dayPnl = (r: (typeof rows)[number]) => r.value * (r.dailyPct ?? 0);
  const totalDayPnl = rows.reduce((a, r) => a + dayPnl(r), 0);
  const winners = rows.filter((r) => r.unrealizedPnl > 0).length;
  const losers = rows.filter((r) => r.unrealizedPnl < 0).length;
  const bestToday = [...rows].sort((a, b) => dayPnl(b) - dayPnl(a))[0] ?? null;
  const worstToday = [...rows].sort((a, b) => dayPnl(a) - dayPnl(b))[0] ?? null;
  const maxWeight = Math.max(...rows.map((r) => r.currentWeight), 0.0001);

  return (
    <div className="flex flex-col gap-3">
      <SampleBanner portfolio={ctx.portfolio} />
      {bundle.status === "UNAVAILABLE" && (
        <Note tone="warn">
          <span>
            <strong>NO MARKET DATA.</strong> No provider is returning quotes; unpriced rows
            show a dash rather than an estimate.
          </span>
        </Note>
      )}

      {/* USD command strip: the five numbers that matter before the table */}
      <Panel bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Marked value", fmtUsd(totals.value), "", undefined],
            ["Today", fmtUsdCompact(totalDayPnl), fmtPctPoints(totals.value > 0 ? (totalDayPnl / totals.value) * 100 : 0), totalDayPnl >= 0 ? "pos" : "neg"],
            ["Total P&L", fmtUsdCompact(totals.totalPnl), fmtPctPoints(totals.totalPct * 100), totals.totalPnl >= 0 ? "pos" : "neg"],
            ["Winners / losers", `${winners} / ${losers}`, "by total P&L", undefined],
            ["Best today", bestToday ? bestToday.position.code : "—", bestToday ? fmtUsdCompact(dayPnl(bestToday)) : "", "pos"],
            ["Worst today", worstToday ? worstToday.position.code : "—", worstToday ? fmtUsdCompact(dayPnl(worstToday)) : "", "neg"],
          ].map(([k, v, sub, tone]) => (
            <div key={k as string} className="px-3 py-2">
              <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">{k}</div>
              <div className={`text-[14px] font-semibold tabular-nums ${tone === "pos" ? "text-emerald-400" : tone === "neg" ? "text-rose-400" : ""}`}>{v}</div>
              {sub ? <div className="text-[9.5px] tabular-nums text-[var(--ink-3)]">{sub}</div> : null}
            </div>
          ))}
        </div>
        {/* Allocation bar: one glance at concentration, colored by today's move */}
        <div className="flex h-3 overflow-hidden border-t border-[var(--line)]">
          {sorted.slice(0, 20).map((r) => (
            <Link
              key={r.position.code}
              href={`/positions/${encodeURIComponent(r.position.code)}`}
              title={`${r.position.code} · ${fmtPct(r.currentWeight, 1)} · today ${fmtPctPoints((r.dailyPct ?? 0) * 100)}`}
              className="h-full border-r border-black/40"
              style={{
                width: `${(r.currentWeight * 100).toFixed(2)}%`,
                background: (r.dailyPct ?? 0) >= 0 ? "rgba(16,185,129,0.55)" : "rgba(244,63,94,0.55)",
              }}
            />
          ))}
        </div>
      </Panel>

      <Panel
        title="Positions"
        subtitle={`${rows.length} lines · ${fmtUsd(totals.value)} marked · all figures USD`}
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Ticker</th>
                <th className="tl">Asset</th>
                <th>Price</th>
                <th>Daily %</th>
                <th>Day P&amp;L $</th>
                <th>YTD %</th>
                <th>Value</th>
                <th>Cost Basis</th>
                <th>P&amp;L</th>
                <th>P&amp;L %</th>
                <th>Breakeven</th>
                <th>Weight</th>
                <th>Target</th>
                <th>Drift</th>
                <th>Contrib.</th>
                <th className="tl">Flag</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const p = r.position;
                const flag = flags.get(p.code) ?? "IN LINE";
                const priceLabel =
                  p.kind === "cash_fund"
                    ? "accrual"
                    : r.quote
                      ? fmtNum(r.quote.price, r.quote.price > 500 ? 0 : 2)
                      : "—";
                return (
                  <tr key={p.code}>
                    <td className="tl">
                      <Link
                        href={`/positions/${encodeURIComponent(p.code)}`}
                        className="font-semibold text-[var(--ink)] hover:text-[var(--amber)] hover:underline"
                      >
                        {p.code}
                      </Link>
                      {p.isProxy && (
                        <span className="ml-1 text-[9px] text-[var(--ink-3)]" title={p.proxyNote}>
                          proxy
                        </span>
                      )}
                    </td>
                    <td className="tl max-w-[220px] truncate text-[var(--ink-2)]" title={p.name}>
                      {p.name}
                    </td>
                    <td className="text-[var(--ink-2)]">{priceLabel}</td>
                    <td className={signClass(r.dailyPct)}>{fmtPctPoints(r.dailyPct * 100)}</td>
                    <td className={signClass(dayPnl(r))}>{fmtUsdCompact(dayPnl(r))}</td>
                    <td className={signClass(r.ytdPct)}>
                      {r.ytdPct === null ? "—" : fmtPctPoints(r.ytdPct * 100)}
                    </td>
                    <td className="font-semibold">{fmtUsdCompact(r.value)}</td>
                    <td className="text-[var(--ink-3)]">{fmtUsdCompact(r.costBasis)}</td>
                    <td className={signClass(r.unrealizedPnl)}>
                      {fmtUsdCompact(r.unrealizedPnl)}
                    </td>
                    <td className={signClass(r.unrealizedPnlPct)}>
                      {fmtPctPoints(r.unrealizedPnlPct * 100)}
                    </td>
                    <td className="tnum text-[var(--ink-2)]" title="price at which this line returns to cost">
                      {r.quote && 1 + r.unrealizedPnlPct > 0
                        ? fmtNum(r.quote.price / (1 + r.unrealizedPnlPct), r.quote.price > 500 ? 0 : 2)
                        : "—"}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="h-1 w-12 overflow-hidden rounded bg-[var(--panel-2)]">
                          <div className="h-full bg-[var(--amber)]/70" style={{ width: `${Math.min(100, (r.currentWeight / maxWeight) * 100).toFixed(0)}%` }} />
                        </div>
                        <span className="tnum">{fmtPct(r.currentWeight, 2)}</span>
                      </div>
                    </td>
                    <td className="text-[var(--ink-3)]">{fmtPct(r.targetWeight, 2)}</td>
                    <td className={signClass(r.drift)}>{fmtPp(r.drift)}</td>
                    <td className={signClass(r.contributionToReturn)}>
                      {fmtPctPoints(r.contributionToReturn * 100)}
                    </td>
                    <td className="tl">
                      {flag === "IN LINE" ? (
                        <span className="text-[10px] text-[var(--ink-3)]">—</span>
                      ) : (
                        <Chip tone={flag === "OVERWEIGHT" ? "neg" : "info"}>{flag}</Chip>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--line)] bg-[var(--panel-2)] font-semibold">
                <td className="tl px-2 py-1.5">TOTAL</td>
                <td colSpan={5} />
                <td className="px-2 py-1.5 text-right tnum">{fmtUsdCompact(totals.value)}</td>
                <td className="px-2 py-1.5 text-right tnum text-[var(--ink-3)]">
                  {fmtUsdCompact(totals.costBasis)}
                </td>
                <td className={`px-2 py-1.5 text-right tnum ${signClass(totals.totalPnl)}`}>
                  {fmtUsdCompact(totals.totalPnl)}
                </td>
                <td className={`px-2 py-1.5 text-right tnum ${signClass(totals.totalPct)}`}>
                  {fmtPctPoints(totals.totalPct * 100)}
                </td>
                <td />
                <td className="px-2 py-1.5 text-right tnum">100.00%</td>
                <td className="px-2 py-1.5 text-right tnum text-[var(--ink-3)]">100.00%</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
          Cost basis is struck at {settings.inceptionDate}. Weight drift beyond ±
          {(settings.driftThreshold * 100).toFixed(1)}pp is flagged. Contribution is position
          P&amp;L divided by total cost basis, so the column sums to the portfolio return.
        </div>
      </Panel>
    </div>
  );
}
