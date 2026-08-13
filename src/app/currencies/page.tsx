import { getContext } from "@/lib/server/context";
import { SampleBanner } from "@/components/shell/sample-banner";
import { Kpi, Note, Panel, StatusBadge } from "@/components/shell/ui";
import { PpfCalculator } from "@/components/currency/ppf-calculator";
import { exposureBy } from "@/lib/portfolio/analytics";
import { fmtNum, fmtPct, fmtPctPoints, fmtUsd, signClass } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CurrenciesPage() {
  const ctx = await getContext({ markets: true });
  if (ctx.error) return <Panel title="Error"><Note tone="warn">{ctx.error}</Note></Panel>;

  const { bundle, settings, rows, totals } = ctx;
  const ppfRow = rows.find((r) => r.position.kind === "cash_fund");
  const tryRows = rows.filter((r) => r.position.currencyCode === "TRY");
  const ccyMix = exposureBy(rows, (p) => p.currencyCode);

  const fxPairs = [
    { pair: "USD/TRY", q: bundle.quotes["USD/TRY"], decimals: 4 },
    { pair: "EUR/USD", q: bundle.quotes["EUR/USD"], decimals: 4 },
    { pair: "DXY", q: bundle.quotes.DXY, decimals: 2 },
  ];

  return (
    <div className="flex flex-col gap-3">
      <SampleBanner portfolio={ctx.portfolio} />
      <Panel bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
          <Kpi
            label="USD/TRY"
            value={fmtNum(bundle.usdTryRate, 4)}
            sub={
              settings.usdTryOverride
                ? "manual override"
                : fmtPctPoints(bundle.usdTryChangePct)
            }
            tone="amber"
          />
          <Kpi label="TRY Exposure" value={fmtPct(totals.tryExposurePct, 1)} sub="of portfolio" />
          <Kpi label="USD Exposure" value={fmtPct(totals.usdExposurePct, 1)} />
          <Kpi
            label="Portfolio in TRY"
            value={new Intl.NumberFormat("tr-TR", {
              style: "currency",
              currency: "TRY",
              maximumFractionDigits: 0,
            }).format(totals.tryValue)}
            sub={fmtUsd(totals.value)}
          />
          <Kpi
            label="YTD (USD)"
            value={fmtPctPoints(totals.ytdPct * 100)}
            tone={totals.ytdPct >= 0 ? "pos" : "neg"}
          />
          <Kpi
            label="YTD (TRY)"
            value={fmtPctPoints(totals.ytdPctTry * 100)}
            tone={totals.ytdPctTry >= 0 ? "pos" : "neg"}
            sub="(1+r_usd)(1+Δfx)−1"
          />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_380px]">
        <PpfCalculator
          initialTlYield={settings.ppfTlYield}
          initialUsdTry={bundle.usdTryRate}
          initialExpectedChange={settings.expectedUsdTryChange}
          ppfValue={ppfRow?.value ?? 0}
          ppfWeight={ppfRow?.currentWeight ?? 0}
          ppfCode={ppfRow?.position.code ?? "PPF"}
        />

        <div className="flex flex-col gap-3">
          <Panel
            title="FX Rates"
            actions={<StatusBadge status={bundle.status} />}
            bodyClassName="p-0"
          >
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Pair</th>
                  <th>Rate</th>
                  <th>Daily</th>
                </tr>
              </thead>
              <tbody>
                {fxPairs.map((f) => (
                  <tr key={f.pair}>
                    <td className="tl font-semibold">{f.pair}</td>
                    <td>{f.q ? fmtNum(f.q.price, f.decimals) : "—"}</td>
                    <td className={signClass(f.q?.changePercent)}>
                      {f.q ? fmtPctPoints(f.q.changePercent) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Currency Exposure" bodyClassName="p-0">
            <ul className="divide-y divide-[var(--line-soft)]">
              {ccyMix.map((c) => (
                <li key={c.label} className="px-3 py-1.5">
                  <div className="flex items-baseline justify-between text-[11px]">
                    <span className="text-[var(--ink-2)]">{c.label}</span>
                    <span className="tnum">{fmtPct(c.weight, 1)}</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-sm bg-[var(--panel-2)]">
                    <div
                      className="h-full bg-[var(--amber)]/70"
                      style={{ width: `${(c.weight * 100).toFixed(2)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="TRY-Denominated Holdings" bodyClassName="p-0">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Code</th>
                  <th>Weight</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {tryRows.map((r) => (
                  <tr key={r.position.code}>
                    <td className="tl font-semibold">{r.position.code}</td>
                    <td>{fmtPct(r.currentWeight, 1)}</td>
                    <td>{fmtUsd(r.value)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[var(--panel-2)] font-semibold">
                  <td className="tl px-2 py-1.5">TOTAL</td>
                  <td className="px-2 py-1.5 text-right tnum">
                    {fmtPct(totals.tryExposurePct, 1)}
                  </td>
                  <td className="px-2 py-1.5 text-right tnum">
                    {fmtUsd(tryRows.reduce((s, r) => s + r.value, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
            <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] leading-relaxed text-[var(--ink-3)]">
              Every line here is exposed to lira depreciation in USD terms, even when its local
              price is unchanged. That is the single largest risk factor in this portfolio.
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
