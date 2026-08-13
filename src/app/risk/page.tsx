import { getContext } from "@/lib/server/context";
import { SampleBanner } from "@/components/shell/sample-banner";
import { Kpi, Note, Panel } from "@/components/shell/ui";
import { CorrelationMatrix } from "@/components/risk/correlation-matrix";
import { exposureBy, rollingCorrelations } from "@/lib/portfolio/analytics";
import { fmtPct, fmtUsd, fmtUsdCompact } from "@/lib/format";

export const dynamic = "force-dynamic";

const WINDOWS = [
  { key: "30D", days: 30 },
  { key: "90D", days: 90 },
  { key: "1Y", days: 252 },
  { key: "3Y", days: 756 },
] as const;

export default async function RiskPage() {
  const ctx = await getContext();
  if (ctx.error) return <Panel title="Error"><Note tone="warn">{ctx.error}</Note></Panel>;

  const { risk, rows, totals, usdSeries, settings } = ctx;

  const matrices = WINDOWS.map((w) => ({
    key: w.key,
    ...rollingCorrelations(usdSeries, w.days),
  }));

  const dims = [
    { title: "Country / Region", data: exposureBy(rows, (p) => p.region) },
    { title: "Currency", data: exposureBy(rows, (p) => p.currencyCode) },
    { title: "Asset Class", data: exposureBy(rows, (p) => p.assetClass) },
    {
      title: "Theme",
      data: exposureBy(rows, (p) => (p.themes.length ? p.themes : ["Untagged"])),
    },
  ];

  const rcSorted = [...risk.riskContributions].sort((a, b) => b.pctRc - a.pctRc);
  const var95Usd = risk.var95 * totals.value;
  const var99Usd = risk.var99 * totals.value;
  const esUsd = risk.expectedShortfall95 * totals.value;

  return (
    <div className="flex flex-col gap-3">
      <SampleBanner portfolio={ctx.portfolio} />
      {risk.method === "model" && (
        <Note tone="warn">
          Not enough overlapping price history to build a covariance matrix — falling back to
          the workbook&apos;s own volatility assumptions. Correlation-based figures are
          unavailable in this mode.
        </Note>
      )}

      <Panel bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
          <Kpi
            label="Annualised Volatility"
            value={fmtPct(risk.annualVolatility, 2)}
            sub="√(wᵀΣw) — covariance based"
            tone="amber"
          />
          <Kpi
            label="Naive Weighted Vol"
            value={fmtPct(risk.weightedAvgVolatility, 2)}
            sub="Σ wᵢσᵢ — shown for contrast"
          />
          <Kpi
            label="Diversification Benefit"
            value={fmtPct(risk.diversificationBenefit, 2)}
            sub="the gap correlation buys you"
            tone="pos"
          />
          <Kpi
            label="Expected Return"
            value={fmtPct(risk.expectedReturn, 2)}
            sub="weighted, from Excel"
          />
          <Kpi
            label="Sharpe"
            value={risk.sharpe.toFixed(2)}
            sub={`vs ${fmtPct(settings.riskFreeRate, 1)} cash`}
          />
          <Kpi
            label="Beta"
            value={risk.beta === null ? "—" : risk.beta.toFixed(2)}
            sub={`vs ${settings.benchmark}`}
          />
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-t border-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
          <Kpi
            label="Max Drawdown"
            value={fmtPct(risk.maxDrawdown, 2)}
            sub="peak to trough, sample"
            tone="neg"
          />
          <Kpi
            label="VaR 95% (1d)"
            value={fmtPct(risk.var95, 2)}
            sub={fmtUsdCompact(var95Usd)}
            tone="neg"
          />
          <Kpi
            label="VaR 99% (1d)"
            value={fmtPct(risk.var99, 2)}
            sub={fmtUsdCompact(var99Usd)}
            tone="neg"
          />
          <Kpi
            label="Expected Shortfall 95%"
            value={fmtPct(risk.expectedShortfall95, 2)}
            sub={fmtUsdCompact(esUsd)}
            tone="neg"
          />
          <Kpi
            label="Observations"
            value={String(risk.observations)}
            sub={`${risk.method} method`}
          />
          <Kpi label="Portfolio Value" value={fmtUsd(totals.value)} />
        </div>
      </Panel>

      <Note>
        VaR and expected shortfall are <strong>historical</strong>, computed from the
        empirical distribution of daily portfolio returns at fixed current weights — no
        normality assumption. They describe the sample, not the future.
      </Note>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel
          title="Contribution to Risk"
          subtitle="Euler decomposition — sums to portfolio volatility"
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Code</th>
                  <th>Weight</th>
                  <th>Risk Contrib.</th>
                  <th>% of Risk</th>
                  <th>Risk / Weight</th>
                </tr>
              </thead>
              <tbody>
                {rcSorted.map((r) => {
                  const ratio = r.weight > 0 ? r.pctRc / r.weight : 0;
                  return (
                    <tr key={r.code}>
                      <td className="tl font-semibold">{r.code}</td>
                      <td className="text-[var(--ink-3)]">{fmtPct(r.weight, 2)}</td>
                      <td>{fmtPct(r.rc, 2)}</td>
                      <td className="font-semibold">{fmtPct(r.pctRc, 2)}</td>
                      <td
                        className={
                          ratio > 1.25 ? "neg" : ratio < 0.75 ? "pos" : "flat"
                        }
                        title="Above 1.0 means the position consumes more risk than capital."
                      >
                        {ratio.toFixed(2)}×
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
            Risk contribution is <strong>not</strong> allocation weight. A small position in a
            high-volatility, highly-correlated asset can carry a far larger share of portfolio
            risk than its capital weight suggests — the last column makes that explicit.
          </div>
        </Panel>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {dims.map((d) => (
            <Panel key={d.title} title={d.title} bodyClassName="p-0">
              <ul className="divide-y divide-[var(--line-soft)]">
                {d.data.map((x) => (
                  <li key={x.label} className="px-3 py-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-[11px]">
                      <span className="truncate text-[var(--ink-2)]" title={x.label}>
                        {x.label}
                      </span>
                      <span className="tnum shrink-0">{fmtPct(x.weight, 1)}</span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-sm bg-[var(--panel-2)]">
                      <div
                        className="h-full bg-[var(--amber)]/70"
                        style={{ width: `${Math.min(100, x.weight * 100).toFixed(2)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      </div>

      <Panel title="Rolling Correlation Matrix" bodyClassName="p-0">
        <CorrelationMatrix windows={matrices} />
      </Panel>
    </div>
  );
}
