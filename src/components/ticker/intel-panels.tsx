import Link from "next/link";
import { Panel } from "@/components/shell/ui";
import type { CompanySnapshot } from "@/lib/data/normalize/company";
import type { OpportunitySnapshot } from "@/lib/data/opportunities";
import type { RiskProfile } from "@/lib/engines/risk-metrics";

/**
 * COMPANY INTEL — the PitchBook-style, non-price/non-statement layer:
 * management, corporate facts, who owns it (and whether they were adding or
 * trimming last quarter), and the comparable set. Every row is provider data
 * (EODHD fundamentals General/Holders) or the app's own precomputed universe —
 * nothing scraped, nothing guessed.
 */

const pct = (v: number | null, d = 2) => (v === null ? "—" : `${v.toFixed(d)}%`);

export function CompanyIntelPanel({
  snapshot,
  peers,
}: {
  snapshot: CompanySnapshot;
  peers: OpportunitySnapshot[];
}) {
  const it = snapshot.intel;
  const facts: Array<[string, string | null]> = [
    ["Headquarters", it.hq],
    ["IPO date", it.ipoDate],
    ["Fiscal year end", it.fiscalYearEnd],
    ["Employees", snapshot.identity.employees !== null ? snapshot.identity.employees.toLocaleString() : null],
    ["Insider ownership", snapshot.insiderOwnershipPct !== null ? `${snapshot.insiderOwnershipPct.toFixed(2)}%` : null],
    ["Institutional ownership", snapshot.institutionalOwnershipPct !== null ? `${snapshot.institutionalOwnershipPct.toFixed(1)}%` : null],
  ];

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {/* Management + corporate facts */}
      <Panel title="Management & Corporate Facts" subtitle="key people and the company card — EODHD filings data" bodyClassName="p-0">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-b border-[var(--line)] p-3 text-[10.5px] sm:grid-cols-3">
          {facts.map(([k, v]) => (
            <div key={k}>
              <div className="text-[8.5px] uppercase tracking-wider text-[var(--ink-3)]">{k}</div>
              <div className="font-medium">{v ?? "N/A"}</div>
            </div>
          ))}
          {it.webUrl && (
            <div>
              <div className="text-[8.5px] uppercase tracking-wider text-[var(--ink-3)]">Website</div>
              <a href={it.webUrl} target="_blank" rel="noreferrer" className="font-medium text-cyan-300 hover:underline">
                {it.webUrl.replace(/^https?:\/\/(www\.)?/, "")}
              </a>
            </div>
          )}
        </div>
        {it.officers.length ? (
          <ul className="divide-y divide-[var(--line-soft,var(--line))]">
            {it.officers.slice(0, 8).map((o) => (
              <li key={o.name} className="flex items-baseline gap-2 px-3 py-1.5 text-[11px]">
                <span className="font-medium">{o.name}</span>
                <span className="min-w-0 flex-1 truncate text-right text-[10px] text-[var(--ink-3)]">
                  {o.title}
                  {o.yearBorn ? ` · b. ${o.yearBorn}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-3 text-[10.5px] text-[var(--ink-3)]">No officer data published for this listing.</div>
        )}
      </Panel>

      {/* Institutional holders w/ QoQ change */}
      <Panel
        title="Who Owns It — and What They Did Last Quarter"
        subtitle="top institutional holders with quarter-over-quarter position change"
        bodyClassName="p-0"
      >
        {it.institutions.length ? (
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Holder</th>
                <th>% of shares</th>
                <th>QoQ change</th>
                <th className="tl">Stance</th>
              </tr>
            </thead>
            <tbody>
              {it.institutions.slice(0, 10).map((h) => (
                <tr key={h.name}>
                  <td className="tl">
                    {h.name}
                    {h.asOf ? <span className="ml-1 text-[8.5px] text-[var(--ink-3)]">({h.asOf})</span> : null}
                  </td>
                  <td className="tabular-nums">{pct(h.pctOfShares)}</td>
                  <td className={`tabular-nums ${(h.changePct ?? 0) > 0 ? "text-emerald-400" : (h.changePct ?? 0) < 0 ? "text-rose-400" : ""}`}>
                    {h.changePct === null ? "—" : `${h.changePct > 0 ? "+" : ""}${h.changePct.toFixed(2)}%`}
                  </td>
                  <td className="tl text-[9.5px]">
                    {h.changePct === null ? (
                      <span className="text-[var(--ink-3)]">n/a</span>
                    ) : h.changePct > 1 ? (
                      <span className="text-emerald-400">ACCUMULATING</span>
                    ) : h.changePct < -1 ? (
                      <span className="text-rose-400">TRIMMING</span>
                    ) : (
                      <span className="text-[var(--ink-3)]">holding</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-3 text-[10.5px] text-[var(--ink-3)]">No holder file published for this listing.</div>
        )}
        {it.funds.length > 0 && (
          <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
            Top funds: {it.funds.slice(0, 4).map((f) => `${f.name.slice(0, 32)} (${pct(f.pctOfShares)})`).join(" · ")}
          </div>
        )}
      </Panel>

      {/* Comparable companies */}
      {peers.length > 0 && (
        <Panel
          title="Comparable Companies"
          subtitle={`same industry, ranked by size — from the precomputed universe`}
          bodyClassName="p-0"
          className="xl:col-span-2"
        >
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Company</th>
                <th>Mcap</th>
                <th>P/E</th>
                <th>Rev growth</th>
                <th>Net margin</th>
                <th>Model upside</th>
                <th>Tech score</th>
              </tr>
            </thead>
            <tbody>
              {peers.map((p) => (
                <tr key={p.symbol}>
                  <td className="tl">
                    <Link href={`/ticker/${p.symbol}`} className="font-semibold hover:text-[var(--amber)]">
                      {p.symbol}
                    </Link>
                    <span className="ml-1.5 text-[9.5px] text-[var(--ink-3)]">{(p.name ?? "").slice(0, 28)}</span>
                  </td>
                  <td className="tabular-nums">
                    {p.marketCap === null ? "—" : p.marketCap >= 1e12 ? `$${(p.marketCap / 1e12).toFixed(2)}T` : `$${(p.marketCap / 1e9).toFixed(1)}B`}
                  </td>
                  <td className="tabular-nums">{p.peTtm?.toFixed(1) ?? "—"}</td>
                  <td className={`tabular-nums ${(p.revenueGrowthYoY ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {p.revenueGrowthYoY === null ? "—" : `${(p.revenueGrowthYoY * 100).toFixed(0)}%`}
                  </td>
                  <td className="tabular-nums">{p.netMarginTtm === null ? "—" : `${(p.netMarginTtm * 100).toFixed(0)}%`}</td>
                  <td className={`tabular-nums ${(p.upsidePct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {p.upsidePct === null ? "N/A" : `${p.upsidePct > 0 ? "+" : ""}${p.upsidePct.toFixed(0)}%`}
                  </td>
                  <td className="tabular-nums">{p.technicalScore ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

/** RISK PROFILE — metric set adapted from MIT-licensed stock-analysis-mcp. */
export function RiskProfilePanel({ risk }: { risk: RiskProfile }) {
  const cells: Array<[string, string, string, ("pos" | "neg" | undefined)?]> = [
    ["Realized vol", risk.realizedVolPct !== null ? `${risk.realizedVolPct}%` : "N/A", "annualized, ~2y daily returns"],
    [
      `Beta vs ${risk.betaBenchmark}`,
      risk.beta !== null ? `${risk.beta}` : "N/A",
      risk.correlation !== null ? `correlation ${risk.correlation}` : "date-aligned daily returns",
    ],
    ["Max drawdown", risk.maxDrawdownPct !== null ? `${risk.maxDrawdownPct}%` : "N/A", "deepest peak-to-trough in window", "neg"],
    [
      "Current drawdown",
      risk.currentDrawdownPct !== null ? `${risk.currentDrawdownPct}%` : "N/A",
      "vs the running peak",
      (risk.currentDrawdownPct ?? 0) > -3 ? "pos" : "neg",
    ],
    ["VaR 95% (1d)", risk.var95Pct !== null ? `${risk.var95Pct}%` : "N/A", "historical percentile, not a model", "neg"],
    ["VaR 99% (1d)", risk.var99Pct !== null ? `${risk.var99Pct}%` : "N/A", "tail day in the sample", "neg"],
    [
      "Avg $ volume",
      risk.avgDollarVolume !== null
        ? risk.avgDollarVolume >= 1e9
          ? `$${(risk.avgDollarVolume / 1e9).toFixed(1)}B`
          : `$${(risk.avgDollarVolume / 1e6).toFixed(0)}M`
        : "N/A",
      "20-session average traded value",
    ],
    ["ATR", risk.atrPct !== null ? `${risk.atrPct}%` : "N/A", "14-day average true range vs price"],
  ];
  return (
    <Panel
      title="Risk Profile"
      subtitle={`volatility, beta, drawdown, VaR, liquidity — ${risk.bars} bars to ${risk.asOf} · metric set adapted from stock-analysis-mcp (MIT)`}
      bodyClassName="p-0"
    >
      <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-4">
        {cells.map(([k, v, sub, tone]) => (
          <div key={k} className="px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">{k}</div>
            <div className={`text-[13px] font-semibold tabular-nums ${tone === "pos" ? "text-emerald-400" : tone === "neg" ? "text-rose-400" : ""}`}>
              {v}
            </div>
            <div className="text-[8.5px] text-[var(--ink-3)]">{sub}</div>
          </div>
        ))}
      </div>
      {risk.sizingNote && (
        <div className="border-t border-[var(--line)] px-3 py-1.5 text-[10px] leading-snug text-[var(--ink-2)]">
          <span className="text-[9px] uppercase tracking-wider text-amber-400">Position sizing math · </span>
          {risk.sizingNote}
        </div>
      )}
    </Panel>
  );
}
