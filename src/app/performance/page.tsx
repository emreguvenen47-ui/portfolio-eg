import { getContext } from "@/lib/server/context";
import { SampleBanner } from "@/components/shell/sample-banner";
import { Kpi, Note, Panel } from "@/components/shell/ui";
import { PerformanceChart } from "@/components/charts/performance-chart";
import { cumulative, maxDrawdown, toReturns } from "@/lib/finance/stats";
import { fmtPct, fmtPctPoints, fmtUsd, fmtUsdCompact, signClass } from "@/lib/format";
import { getPortfolio, listPortfolios, allTickers } from "@/lib/server/ai-portfolios";
import { computeAiPortfolioPerformance } from "@/lib/ai/portfolio-performance";
import { getHistories, getQuotes } from "@/lib/providers";
import { PortfolioSelector } from "@/components/performance/portfolio-selector";
import { AiPerformance } from "@/components/performance/ai-performance";
import { BenchmarkTable } from "@/components/performance/benchmark-table";
import { compareToBenchmark, rebase, BENCHMARKS } from "@/lib/portfolio/benchmark";
import { getVirtual, listVirtual } from "@/lib/server/virtual-portfolios";
import { valueVirtual, virtualSeries } from "@/lib/portfolio/virtual-analytics";
import { Chip } from "@/components/shell/ui";
import { signClass as sign } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Calendar-month returns from a daily index series. */
function monthlyReturns(points: { date: string; close: number }[]) {
  const byMonth = new Map<string, { first: number; last: number }>();
  for (const p of points) {
    const key = p.date.slice(0, 7);
    const cur = byMonth.get(key);
    if (!cur) byMonth.set(key, { first: p.close, last: p.close });
    else cur.last = p.close;
  }
  const keys = [...byMonth.keys()].sort();
  const out: { month: string; ret: number }[] = [];
  for (let i = 0; i < keys.length; i++) {
    const cur = byMonth.get(keys[i])!;
    const prevClose = i > 0 ? byMonth.get(keys[i - 1])!.last : cur.first;
    if (prevClose > 0) out.push({ month: keys[i], ret: cur.last / prevClose - 1 });
  }
  return out;
}

export default async function PerformancePage(props: PageProps<"/performance">) {
  const { portfolio: selected, benchmark: bm } = await props.searchParams;
  const ctx = await getContext();
  if (ctx.error) return <Panel title="Error"><Note tone="warn">{ctx.error}</Note></Panel>;

  const [saved, virtual] = await Promise.all([listPortfolios(), listVirtual()]);
  const selectedId = typeof selected === "string" ? selected : "real";
  const benchmarkKey =
    typeof bm === "string" && BENCHMARKS.some((b) => b.key === bm) ? bm : "SPX";
  const benchmarkLabel =
    BENCHMARKS.find((b) => b.key === benchmarkKey)?.label ?? benchmarkKey;
  const benchmarkSeries = (ctx.bundle.histories[benchmarkKey] ?? []).map((c) => ({
    date: c.date,
    close: c.close,
  }));

  const selector = (
    <Panel bodyClassName="p-0">
      <PortfolioSelector
        saved={saved.map((p) => ({ id: p.id, name: p.name }))}
        virtual={virtual.map((p) => ({ id: p.id, name: p.name }))}
        active={selectedId}
        benchmark={benchmarkKey}
      />
    </Panel>
  );

  // ------------------------------------------------------- paper portfolio
  if (selectedId.startsWith("v:")) {
    const vp = await getVirtual(selectedId.slice(2));
    if (!vp) {
      return (
        <div className="flex flex-col gap-3">
          {selector}
          <Panel title="Portfolio not found">
            <Note tone="warn">That paper portfolio no longer exists.</Note>
          </Panel>
        </div>
      );
    }

    const tickers = [...new Set(vp.trades.map((t) => t.ticker))];
    const [histories, quotes] = await Promise.all([
      tickers.length
        ? getHistories(tickers, 1300)
        : Promise.resolve({} as Awaited<ReturnType<typeof getHistories>>),
      tickers.length ? getQuotes(tickers) : Promise.resolve({}),
    ]);
    const valuation = valueVirtual(vp, quotes);
    const vSeries = virtualSeries(
      vp,
      Object.fromEntries(Object.entries(histories).map(([k, v]) => [k, v.candles])),
    );
    const report = compareToBenchmark(vSeries, benchmarkSeries);
    const contributors = [...valuation.positions].sort(
      (a, b) => b.unrealizedPnl - a.unrealizedPnl,
    );
    const money = (n: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: valuation.currency,
        maximumFractionDigits: 0,
      }).format(n);

    return (
      <div className="flex flex-col gap-3">
        {selector}
        <Note tone="info">
          <span>
            <strong>Paper portfolio.</strong> Valued at real market prices from the trade ledger;
            nothing is computed before the first trade.
          </span>
        </Note>

        <Panel bodyClassName="p-0">
          <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Total Value" value={money(valuation.totalValue)} sub={`cash ${money(valuation.cash)}`} />
            <Kpi
              label="Total Return"
              value={fmtPctPoints(valuation.returnPct)}
              sub={money(valuation.totalPnl)}
              tone={valuation.totalPnl >= 0 ? "pos" : "neg"}
            />
            <Kpi label="Unrealised" value={money(valuation.unrealizedPnl)} tone={valuation.unrealizedPnl >= 0 ? "pos" : "neg"} />
            <Kpi label="Realised" value={money(valuation.realizedPnl)} sub="FIFO" tone={valuation.realizedPnl >= 0 ? "pos" : "neg"} />
            <Kpi label="Daily" value={fmtPctPoints(valuation.dailyPct)} sub={money(valuation.dailyPnl)} tone={valuation.dailyPnl >= 0 ? "pos" : "neg"} />
            <Kpi label="Max Drawdown" value={`${report.maxDrawdown.toFixed(2)}%`} tone="neg" />
          </div>
        </Panel>

        <Panel title="Cumulative Performance" bodyClassName="p-0">
          {vSeries.length < 2 ? (
            <Note tone="warn">Not enough price history since the first trade to draw a curve.</Note>
          ) : (
            <PerformanceChart
              portfolio={vSeries}
              benchmarks={[
                {
                  key: benchmarkKey,
                  label: benchmarkLabel,
                  color: "#4f9df7",
                  points: rebase(benchmarkSeries, vSeries[0].date, vSeries[0].close),
                },
              ].filter((b) => b.points.length > 1)}
              height={340}
            />
          )}
        </Panel>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <BenchmarkTable report={report} benchmarkLabel={benchmarkLabel} />
          <Panel title="Contribution by Position" bodyClassName="p-0">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Ticker</th>
                  <th>Weight</th>
                  <th>Unrealised</th>
                  <th>Realised</th>
                  <th className="tl">Flag</th>
                </tr>
              </thead>
              <tbody>
                {contributors.map((p, i) => (
                  <tr key={p.ticker}>
                    <td className="tl font-semibold">{p.ticker}</td>
                    <td className="tabular-nums text-[var(--ink-3)]">{(p.weight * 100).toFixed(1)}%</td>
                    <td className={`tabular-nums ${sign(p.unrealizedPnl)}`}>{money(p.unrealizedPnl)}</td>
                    <td className={`tabular-nums ${sign(p.realizedPnl)}`}>
                      {p.realizedPnl === 0 ? "—" : money(p.realizedPnl)}
                    </td>
                    <td className="tl">
                      {i === 0 && contributors.length > 1 && <Chip tone="pos">best</Chip>}
                      {i === contributors.length - 1 && contributors.length > 1 && (
                        <Chip tone="neg">worst</Chip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>
    );
  }

  // A saved AI portfolio gets its own track record, built from the same
  // provider data and rendered with the same chart component as the real book.
  if (selectedId !== "real") {
    const ai = await getPortfolio(selectedId);
    if (!ai) {
      return (
        <div className="flex flex-col gap-3">
          {selector}
          <Panel title="Portfolio not found">
            <Note tone="warn">That saved portfolio no longer exists.</Note>
          </Panel>
        </div>
      );
    }

    const tickers = allTickers(ai);
    const [histories, quotes] = await Promise.all([
      getHistories(tickers, 800),
      getQuotes(tickers),
    ]);
    const perf = computeAiPortfolioPerformance(
      ai,
      Object.fromEntries(Object.entries(histories).map(([k, v]) => [k, v.candles])),
      quotes,
    );

    const report = compareToBenchmark(perf.series, benchmarkSeries);

    return (
      <div className="flex flex-col gap-3">
        {selector}
        <AiPerformance
          portfolio={ai}
          perf={perf}
          realSeries={ctx.series}
          spxSeries={benchmarkSeries}
          benchmarkLabel={benchmarkLabel}
        />
        <BenchmarkTable report={report} benchmarkLabel={benchmarkLabel} />
      </div>
    );
  }

  const { series, totals, risk, bundle, rows } = ctx;
  const closes = series.map((p) => p.close);
  const rets = toReturns(closes);
  const dd = maxDrawdown(cumulative(rets));
  const months = monthlyReturns(series);
  const positive = months.filter((m) => m.ret > 0).length;

  const benchmarks = [
    {
      key: "SPX",
      label: "S&P 500",
      color: "#4f9df7",
      points: (bundle.histories.SPX ?? []).map((c) => ({ date: c.date, close: c.close })),
    },
    {
      key: "XU100",
      label: "BIST 100",
      color: "#26c281",
      points: (bundle.histories.XU100 ?? []).map((c) => ({ date: c.date, close: c.close })),
    },
  ];

  const contributors = [...rows].sort(
    (a, b) => b.contributionToReturn - a.contributionToReturn,
  );

  return (
    <div className="flex flex-col gap-3">
      <SampleBanner portfolio={ctx.portfolio} />
      {selector}

      {bundle.status === "UNAVAILABLE" && (
        <Note tone="warn">
          <strong>NO MARKET DATA.</strong> Without real quotes this track record cannot be
          computed.
        </Note>
      )}

      <Panel bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Value" value={fmtUsd(totals.value)} sub={`cost ${fmtUsdCompact(totals.costBasis)}`} />
          <Kpi
            label="Total Return"
            value={fmtPctPoints(totals.totalPct * 100)}
            sub={fmtUsdCompact(totals.totalPnl)}
            tone={totals.totalPct >= 0 ? "pos" : "neg"}
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
            sub="compounded with USD/TRY"
          />
          <Kpi label="Max Drawdown" value={fmtPct(dd, 2)} tone="neg" />
          <Kpi
            label="Positive Months"
            value={`${positive}/${months.length}`}
            sub={months.length ? fmtPct(positive / months.length, 0) : undefined}
          />
        </div>
      </Panel>

      <Panel title="Cumulative Performance" bodyClassName="p-0">
        <PerformanceChart portfolio={series} benchmarks={benchmarks} height={340} fxHistories={{ usdTry: bundle.histories["USD/TRY"], eurUsd: bundle.histories["EUR/USD"] }} />
      </Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Monthly Returns" bodyClassName="p-0">
          <div className="max-h-[360px] overflow-y-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Month</th>
                  <th>Return</th>
                  <th className="tl">Distribution</th>
                </tr>
              </thead>
              <tbody>
                {[...months].reverse().map((m) => {
                  const pct = m.ret * 100;
                  const w = Math.min(50, Math.abs(pct) * 4);
                  return (
                    <tr key={m.month}>
                      <td className="tl">{m.month}</td>
                      <td className={signClass(m.ret)}>{fmtPctPoints(pct)}</td>
                      <td className="tl">
                        <div className="relative h-2 w-full">
                          <div className="absolute left-1/2 h-full w-px bg-[var(--line)]" />
                          <div
                            className={`absolute top-0 h-full ${
                              m.ret >= 0 ? "bg-[var(--up)]/60" : "bg-[var(--down)]/60"
                            }`}
                            style={
                              m.ret >= 0
                                ? { left: "50%", width: `${w}%` }
                                : { right: "50%", width: `${w}%` }
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Contribution to Return" subtitle="sums to total portfolio return" bodyClassName="p-0">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Code</th>
                <th>Weight</th>
                <th>P&amp;L</th>
                <th>Contribution</th>
                <th className="tl">Share</th>
              </tr>
            </thead>
            <tbody>
              {contributors.map((r) => {
                const share = totals.totalPct !== 0 ? r.contributionToReturn / totals.totalPct : 0;
                return (
                  <tr key={r.position.code}>
                    <td className="tl font-semibold">{r.position.code}</td>
                    <td className="text-[var(--ink-3)]">{fmtPct(r.currentWeight, 1)}</td>
                    <td className={signClass(r.unrealizedPnl)}>{fmtUsdCompact(r.unrealizedPnl)}</td>
                    <td className={signClass(r.contributionToReturn)}>
                      {fmtPctPoints(r.contributionToReturn * 100)}
                    </td>
                    <td className="tl">
                      <div className="h-1.5 w-full overflow-hidden rounded-sm bg-[var(--panel-2)]">
                        <div
                          className={
                            r.contributionToReturn >= 0
                              ? "h-full bg-[var(--up)]/70"
                              : "h-full bg-[var(--down)]/70"
                          }
                          style={{ width: `${Math.min(100, Math.abs(share) * 100)}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--line)] bg-[var(--panel-2)] font-semibold">
                <td className="tl px-2 py-1.5" colSpan={3}>
                  TOTAL
                </td>
                <td className={`px-2 py-1.5 text-right tnum ${signClass(totals.totalPct)}`}>
                  {fmtPctPoints(totals.totalPct * 100)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </Panel>
      </div>

      <Panel title="Risk-Adjusted Summary" bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Volatility" value={fmtPct(risk.annualVolatility, 2)} sub="covariance-based" />
          <Kpi label="Sharpe" value={risk.sharpe.toFixed(2)} />
          <Kpi label="Beta" value={risk.beta === null ? "—" : risk.beta.toFixed(2)} />
          <Kpi label="VaR 95% (1d)" value={fmtPct(risk.var95, 2)} tone="neg" />
          <Kpi label="ES 95% (1d)" value={fmtPct(risk.expectedShortfall95, 2)} tone="neg" />
          <Kpi label="Observations" value={String(risk.observations)} sub={risk.method} />
        </div>
      </Panel>
    </div>
  );
}
