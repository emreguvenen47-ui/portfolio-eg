import { Chip, Empty, Panel } from "@/components/shell/ui";
import { fmtPctPoints, signClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import { scoreQuality, valuationRows } from "@/lib/portfolio/quality-score";
import type {
  EarningsPoint,
  FinancialPeriod,
  InsiderTx,
  KeyMetrics,
  Recommendation,
} from "@/lib/providers/fundamentals";

const compact = (n: number | null): string => {
  if (n === null || !Number.isFinite(n)) return "N/A";
  const abs = Math.abs(n);
  const unit = abs >= 1e9 ? ["B", 1e9] : abs >= 1e6 ? ["M", 1e6] : abs >= 1e3 ? ["K", 1e3] : ["", 1];
  return `${(n / (unit[1] as number)).toFixed(2)}${unit[0]}`;
};

const pctChange = (cur: number | null, prev: number | null): number | null =>
  cur === null || prev === null || prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100;

function Delta({ v }: { v: number | null }) {
  if (v === null) return <span className="text-[var(--ink-3)]">N/A</span>;
  return <span className={cn("tabular-nums", signClass(v))}>{fmtPctPoints(v)}</span>;
}

/**
 * Financials, valuation, analyst consensus, earnings surprises and insider
 * activity for one symbol.
 *
 * Every figure comes from the provider. Anything the free tier does not carry
 * — price targets above all — renders as N/A rather than an estimate.
 */
export function Fundamentals({
  symbol,
  metrics,
  financials,
  recommendations,
  earnings,
  insiders,
  lastPrice,
}: {
  symbol: string;
  metrics: KeyMetrics | null;
  financials: FinancialPeriod[] | null;
  recommendations: Recommendation[] | null;
  earnings: EarningsPoint[] | null;
  insiders: InsiderTx[] | null;
  lastPrice: number | null;
}) {
  const quality = scoreQuality(metrics);
  const valuation = valuationRows(metrics);

  const periods = (financials ?? []).slice(0, 8);
  const cur = periods[0] ?? null;
  const prevQ = periods[1] ?? null;
  // Same quarter a year ago is four reports back, when the series is complete.
  const yoy = periods[4] ?? null;

  const rec = recommendations?.[0] ?? null;
  const recTotal = rec
    ? rec.strongBuy + rec.buy + rec.hold + rec.sell + rec.strongSell
    : 0;

  const rows: { label: string; get: (p: FinancialPeriod) => number | null; money: boolean }[] = [
    { label: "Revenue", get: (p) => p.revenue, money: true },
    { label: "Gross Profit", get: (p) => p.grossProfit, money: true },
    { label: "Operating Income", get: (p) => p.operatingIncome, money: true },
    { label: "Net Income", get: (p) => p.netIncome, money: true },
    { label: "EPS (diluted)", get: (p) => p.eps, money: false },
    { label: "Operating Cash Flow", get: (p) => p.operatingCashFlow, money: true },
    { label: "Free Cash Flow", get: (p) => p.freeCashFlow, money: true },
    { label: "Cash", get: (p) => p.cash, money: true },
    // Total debt now spans the short and long-term lines rather than a single
    // field, so a filer that splits them is not reported as debt-free.
    {
      label: "Debt",
      get: (p) =>
        p.shortTermDebt === null && p.longTermDebt === null
          ? null
          : (p.shortTermDebt ?? 0) + (p.longTermDebt ?? 0),
      money: true,
    },
  ];

  const margin = (p: FinancialPeriod | null, num: (x: FinancialPeriod) => number | null) =>
    p && p.revenue ? ((num(p) ?? 0) / p.revenue) * 100 : null;

  return (
    <div className="flex flex-col gap-3">
      {/* ------------------------------------------------------- financials */}
      <Panel
        title="Financials"
        subtitle={cur ? `latest reported quarter Q${cur.quarter} ${cur.year} · Finnhub` : "Finnhub"}
        bodyClassName="p-0"
      >
        {!cur ? (
          <Empty>No reported financials available for {symbol}.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Line</th>
                  <th>Current</th>
                  <th>Previous Q</th>
                  <th>QoQ</th>
                  <th>Year ago</th>
                  <th>YoY</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <td className="tl">{r.label}</td>
                    <td className="tabular-nums">
                      {r.money ? compact(r.get(cur)) : (r.get(cur)?.toFixed(2) ?? "N/A")}
                    </td>
                    <td className="tabular-nums text-[var(--ink-3)]">
                      {prevQ ? (r.money ? compact(r.get(prevQ)) : (r.get(prevQ)?.toFixed(2) ?? "N/A")) : "N/A"}
                    </td>
                    <td>
                      <Delta v={prevQ ? pctChange(r.get(cur), r.get(prevQ)) : null} />
                    </td>
                    <td className="tabular-nums text-[var(--ink-3)]">
                      {yoy ? (r.money ? compact(r.get(yoy)) : (r.get(yoy)?.toFixed(2) ?? "N/A")) : "N/A"}
                    </td>
                    <td>
                      <Delta v={yoy ? pctChange(r.get(cur), r.get(yoy)) : null} />
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-[var(--line)]">
                  <td className="tl">Gross Margin</td>
                  <td className="tabular-nums">
                    {margin(cur, (p) => p.grossProfit)?.toFixed(1) ?? "N/A"}%
                  </td>
                  <td className="tabular-nums text-[var(--ink-3)]">
                    {margin(prevQ, (p) => p.grossProfit)?.toFixed(1) ?? "N/A"}%
                  </td>
                  <td colSpan={3} />
                </tr>
                <tr>
                  <td className="tl">Operating Margin</td>
                  <td className="tabular-nums">
                    {margin(cur, (p) => p.operatingIncome)?.toFixed(1) ?? "N/A"}%
                  </td>
                  <td className="tabular-nums text-[var(--ink-3)]">
                    {margin(prevQ, (p) => p.operatingIncome)?.toFixed(1) ?? "N/A"}%
                  </td>
                  <td colSpan={3} />
                </tr>
                <tr>
                  <td className="tl">Net Margin</td>
                  <td className="tabular-nums">
                    {margin(cur, (p) => p.netIncome)?.toFixed(1) ?? "N/A"}%
                  </td>
                  <td className="tabular-nums text-[var(--ink-3)]">
                    {margin(prevQ, (p) => p.netIncome)?.toFixed(1) ?? "N/A"}%
                  </td>
                  <td colSpan={3} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        {/* ------------------------------------------------------- quality */}
        <Panel
          title="Financial Quality Score"
          subtitle={quality.total === null ? "N/A" : `${quality.total} / 100 · house heuristic`}
          bodyClassName="p-0"
        >
          <table className="grid-table">
            <tbody>
              {(
                [
                  ["Growth", quality.growth],
                  ["Profitability", quality.profitability],
                  ["Cash Flow", quality.cashFlow],
                  ["Balance Sheet", quality.balanceSheet],
                  ["Efficiency", quality.efficiency],
                ] as const
              ).map(([label, v]) => (
                <tr key={label}>
                  <td className="tl">{label}</td>
                  <td className="tl w-[110px]">
                    <div className="h-1.5 w-full bg-[var(--panel-2)]">
                      <div
                        className={cn(
                          "h-full",
                          (v ?? 0) >= 70
                            ? "bg-emerald-500"
                            : (v ?? 0) >= 45
                              ? "bg-amber-500"
                              : "bg-rose-500",
                        )}
                        style={{ width: `${v ?? 0}%` }}
                      />
                    </div>
                  </td>
                  <td className="tabular-nums">{v ?? "N/A"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div
            className="border-t border-[var(--line)] px-3 py-2 text-[9.5px] leading-snug text-[var(--ink-3)]"
            title="Growth: revenue and EPS YoY. Profitability: net, operating and gross margins. Cash Flow: price to free cash flow per share. Balance Sheet: current ratio and debt/equity. Efficiency: ROE and ROA. Each is a clamped linear grade; components with no data are dropped rather than scored zero."
          >
            Not an industry-standard score. Five equally-weighted components from Finnhub TTM
            metrics — hover for the definitions.
          </div>
        </Panel>

        {/* ----------------------------------------------------- valuation */}
        <Panel title="Valuation" subtitle="absolute thresholds, stated per row" bodyClassName="p-0">
          {valuation.length === 0 ? (
            <Empty>No valuation metrics available.</Empty>
          ) : (
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Metric</th>
                  <th>Value</th>
                  <th className="tl">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {valuation.map((v) => (
                  <tr key={v.label} title={v.rule}>
                    <td className="tl">{v.label}</td>
                    <td className="tabular-nums">{v.value?.toFixed(2) ?? "N/A"}</td>
                    <td className="tl">
                      <Chip
                        tone={
                          v.verdict === "CHEAP"
                            ? "pos"
                            : v.verdict === "EXPENSIVE"
                              ? "neg"
                              : v.verdict === "FAIR"
                                ? "neutral"
                                : "warn"
                        }
                      >
                        {v.verdict}
                      </Chip>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-[var(--line)]">
                  <td className="tl">Dividend yield</td>
                  <td className="tabular-nums">
                    {(metrics?.dividendYieldIndicatedAnnual as number)?.toFixed(2) ?? "N/A"}%
                  </td>
                  <td />
                </tr>
                <tr>
                  <td className="tl">Beta</td>
                  <td className="tabular-nums">
                    {(metrics?.beta as number)?.toFixed(2) ?? "N/A"}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          )}
          <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
            Sector-relative comparison is not available on the configured data plan.
          </div>
        </Panel>

        {/* ---------------------------------------------------- consensus */}
        <Panel
          title="Analyst Consensus"
          subtitle={rec ? `${recTotal} analysts · ${rec.period}` : "N/A"}
          bodyClassName="p-0"
        >
          {!rec ? (
            <Empty>No analyst coverage available for {symbol}.</Empty>
          ) : (
            <>
              <table className="grid-table">
                <tbody>
                  {(
                    [
                      ["Strong Buy", rec.strongBuy, "pos"],
                      ["Buy", rec.buy, "pos"],
                      ["Hold", rec.hold, "neutral"],
                      ["Sell", rec.sell, "neg"],
                      ["Strong Sell", rec.strongSell, "neg"],
                    ] as const
                  ).map(([label, n, tone]) => (
                    <tr key={label}>
                      <td className="tl">{label}</td>
                      <td className="tl w-[110px]">
                        <div className="h-1.5 w-full bg-[var(--panel-2)]">
                          <div
                            className={cn(
                              "h-full",
                              tone === "pos"
                                ? "bg-emerald-500"
                                : tone === "neg"
                                  ? "bg-rose-500"
                                  : "bg-[var(--ink-3)]",
                            )}
                            style={{ width: `${recTotal ? (n / recTotal) * 100 : 0}%` }}
                          />
                        </div>
                      </td>
                      <td className="tabular-nums">{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-[var(--line)] px-3 py-2 text-[10px] text-[var(--ink-3)]">
                Price targets are <strong>N/A</strong> — not available on the configured Finnhub
                plan, so implied upside cannot be computed.
                {lastPrice !== null && ` Last ${lastPrice.toFixed(2)}.`}
              </div>
            </>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {/* ------------------------------------------------------ earnings */}
        <Panel
          title="Earnings Surprises"
          subtitle="reported EPS vs consensus · Finnhub"
          bodyClassName="p-0"
        >
          {!earnings?.length ? (
            <Empty>No earnings history available.</Empty>
          ) : (
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Period</th>
                  <th>Estimate</th>
                  <th>Actual</th>
                  <th>Surprise</th>
                </tr>
              </thead>
              <tbody>
                {earnings.slice(0, 6).map((e) => (
                  <tr key={e.period}>
                    <td className="tl">{e.period}</td>
                    <td className="tabular-nums text-[var(--ink-3)]">
                      {e.estimate?.toFixed(2) ?? "N/A"}
                    </td>
                    <td className="tabular-nums">{e.actual?.toFixed(2) ?? "N/A"}</td>
                    <td className={cn("tabular-nums", signClass(e.surprisePercent))}>
                      {e.surprisePercent === null ? "N/A" : fmtPctPoints(e.surprisePercent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
            Revenue estimates and forward guidance are N/A on the configured plan.
          </div>
        </Panel>

        {/* ------------------------------------------------------- insider */}
        <Panel title="Insider Activity" subtitle="reported filings · Finnhub" bodyClassName="p-0">
          {!insiders?.length ? (
            <Empty>No insider transactions reported.</Empty>
          ) : (
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Insider</th>
                  <th className="tl">Date</th>
                  <th>Change</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                {insiders.map((t, i) => (
                  <tr key={`${t.name}-${t.filingDate}-${i}`}>
                    <td className="tl truncate text-[10.5px]">{t.name}</td>
                    <td className="tl text-[10px] text-[var(--ink-3)]">{t.transactionDate}</td>
                    <td className={cn("tabular-nums", signClass(t.change))}>
                      {t.change > 0 ? "+" : ""}
                      {t.change.toLocaleString("en-US")}
                    </td>
                    <td className="tabular-nums text-[var(--ink-3)]">
                      {t.transactionPrice ? t.transactionPrice.toFixed(2) : "N/A"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
