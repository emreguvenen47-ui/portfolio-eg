import Link from "next/link";
import { getContext } from "@/lib/server/context";
import { SampleBanner } from "@/components/shell/sample-banner";
import { getHistories } from "@/lib/providers";
import { Chip, Kpi, Note, Panel } from "@/components/shell/ui";
import { fmtPct, fmtPctPoints, fmtUsd, fmtUsdCompact, signClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CRISES, runCrisis } from "@/lib/portfolio/crisis";
import { buildCalendar } from "@/lib/events/calendar";
import { evaluateAlerts } from "@/lib/portfolio/alert-engine";
import { listRules, listEvents } from "@/lib/server/alert-store";
import { buildXray } from "@/lib/portfolio/xray";
import { IcBrief } from "@/components/committee/ic-brief";

export const dynamic = "force-dynamic";
export const metadata = { title: "Investment Committee" };

/**
 * One page to run a portfolio review from.
 *
 * Everything is assembled from analytics that already exist elsewhere in the
 * app — this is a view, not a new engine. No model runs on load; the brief
 * button is the only AI path.
 */
export default async function CommitteePage() {
  const ctx = await getContext({ markets: true });
  if (ctx.error)
    return (
      <Panel title="Error">
        <Note tone="warn">{ctx.error}</Note>
      </Panel>
    );

  const { rows, totals, risk, settings, series, usdSeries, bundle } = ctx;

  const quotable = rows.filter((r) => r.position.symbol);
  const symbols = [...new Set(quotable.map((r) => r.position.symbol!))];
  const benchmark: string = settings.benchmark || "SPY";

  const [histories, rules, alertLog] = await Promise.all([
    getHistories([...symbols, benchmark], 5000).catch(
      () => ({}) as Awaited<ReturnType<typeof getHistories>>,
    ),
    listRules().catch(() => []),
    listEvents(10).catch(() => []),
  ]);

  const candleMap: Record<string, import("@/lib/types").Candle[]> = Object.fromEntries(
    Object.entries(histories).map(([k, v]) => [k, v.candles]),
  );

  // --- crisis sensitivity, on the two windows with the widest coverage
  const positions = quotable.map((r) => ({
    symbol: r.position.symbol!,
    weight: r.currentWeight,
    candles: histories[r.position.symbol!]?.candles ?? [],
  }));
  const crises = CRISES.map((c) => runCrisis(c, positions, histories[benchmark]?.candles ?? []))
    .filter((r) => r.coverage >= 0.5)
    .sort((a, b) => (a.maxDrawdown ?? 0) - (b.maxDrawdown ?? 0))
    .slice(0, 4);

  // --- concentration and exposure
  const xray = buildXray(rows);
  const sorted = [...rows].sort((a, b) => b.currentWeight - a.currentWeight);
  const top5 = sorted.slice(0, 5).reduce((s, r) => s + r.currentWeight, 0);
  const cash = rows
    .filter((r) => r.position.assetClass === "Cash" || r.position.assetClass === "Unallocated")
    .reduce((s, r) => s + r.currentWeight, 0);

  // --- alerts
  const hits = evaluateAlerts(rules, {
    rows,
    quotes: bundle?.quotes ?? {},
    histories: candleMap,
    totals,
    portfolioSeries: series,
  }).filter((h) => h.triggered);

  // --- events in the next 30 days
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const upcoming = buildCalendar(0, 2)
    .filter((e) => e.date >= today && e.date <= horizon)
    .slice(0, 8);

  // --- positions needing review: biggest drift and biggest drawdown
  const drifted = [...rows]
    .filter((r) => Math.abs(r.drift) > 0.02)
    .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
    .slice(0, 5);

  const rcSorted = [...risk.riskContributions].sort((a, b) => b.pctRc - a.pctRc);
  const riskHogs = rcSorted.filter((r) => r.weight > 0 && r.pctRc / r.weight > 1.25).slice(0, 4);

  const benchSeries = histories[benchmark]?.candles ?? [];
  const portfolioReturn =
    series.length >= 2 ? (series.at(-1)!.close / series[0].close - 1) * 100 : null;
  const benchReturn =
    benchSeries.length >= 2
      ? (benchSeries.at(-1)!.close / benchSeries[0].close - 1) * 100
      : null;
  const relative =
    portfolioReturn !== null && benchReturn !== null ? portfolioReturn - benchReturn : null;

  return (
    <div className="flex flex-col gap-3">
      <SampleBanner portfolio={ctx.portfolio} />
      <Note>
        Everything below is computed from real prices, filings and your own book. No model runs
        when this page loads — the brief button at the bottom is the only AI call.
      </Note>

      <Panel bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Portfolio Value" value={fmtUsd(totals.value)} />
          <Kpi
            label="Return"
            value={portfolioReturn === null ? "N/A" : fmtPctPoints(portfolioReturn)}
            tone={(portfolioReturn ?? 0) >= 0 ? "pos" : "neg"}
          />
          <Kpi
            label={`vs ${benchmark}`}
            value={relative === null ? "N/A" : fmtPctPoints(relative)}
            tone={(relative ?? 0) >= 0 ? "pos" : "neg"}
            sub={benchReturn === null ? undefined : `benchmark ${fmtPctPoints(benchReturn)}`}
          />
          <Kpi label="Volatility" value={fmtPct(risk.annualVolatility, 1)} tone="amber" />
          <Kpi label="Top 5 Weight" value={fmtPct(top5, 1)} tone={top5 > 0.5 ? "neg" : undefined} />
          <Kpi label="Cash & Equivalents" value={fmtPct(cash, 1)} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Top Risks" subtitle="positions consuming more risk than capital" bodyClassName="p-0">
          {riskHogs.length === 0 ? (
            <div className="p-3 text-[11px] text-[var(--ink-3)]">
              No position consumes materially more risk than its weight.
            </div>
          ) : (
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Code</th>
                  <th>Weight</th>
                  <th>% of Risk</th>
                  <th>Risk / Weight</th>
                </tr>
              </thead>
              <tbody>
                {riskHogs.map((r) => (
                  <tr key={r.code}>
                    <td className="tl font-semibold">{r.code}</td>
                    <td className="tabular-nums text-[var(--ink-3)]">{fmtPct(r.weight, 1)}</td>
                    <td className="tabular-nums">{fmtPct(r.pctRc, 1)}</td>
                    <td className="tabular-nums neg">{(r.pctRc / r.weight).toFixed(2)}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Positions Requiring Review" subtitle="drift beyond 2 points from target" bodyClassName="p-0">
          {drifted.length === 0 ? (
            <div className="p-3 text-[11px] text-[var(--ink-3)]">
              Every position is within 2 points of its target weight.
            </div>
          ) : (
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Code</th>
                  <th>Target</th>
                  <th>Current</th>
                  <th>Drift</th>
                </tr>
              </thead>
              <tbody>
                {drifted.map((r) => (
                  <tr key={r.position.code}>
                    <td className="tl font-semibold">{r.position.code}</td>
                    <td className="tabular-nums text-[var(--ink-3)]">{fmtPct(r.position.targetWeight, 1)}</td>
                    <td className="tabular-nums">{fmtPct(r.currentWeight, 1)}</td>
                    <td className={cn("tabular-nums", signClass(r.drift))}>{fmtPctPoints(r.drift * 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Crisis Sensitivity" subtitle="today's weights through real historical closes" bodyClassName="p-0">
          {crises.length === 0 ? (
            <div className="p-3 text-[11px] text-[var(--ink-3)]">
              No crisis window has enough price coverage across the book.{" "}
              <Link href="/crisis" className="text-[var(--amber)]">
                See detail
              </Link>
            </div>
          ) : (
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Episode</th>
                  <th>Coverage</th>
                  <th>Return</th>
                  <th>Max DD</th>
                </tr>
              </thead>
              <tbody>
                {crises.map((c) => (
                  <tr key={c.crisis.id}>
                    <td className="tl">
                      <Link href="/crisis" className="hover:text-[var(--amber)]">
                        {c.crisis.name}
                      </Link>
                    </td>
                    <td className="tabular-nums text-[var(--ink-3)]">{(c.coverage * 100).toFixed(0)}%</td>
                    <td className={cn("tabular-nums", signClass(c.totalReturn))}>
                      {c.totalReturn === null ? "N/A" : fmtPctPoints(c.totalReturn)}
                    </td>
                    <td className="tabular-nums neg">
                      {c.maxDrawdown === null ? "N/A" : fmtPctPoints(c.maxDrawdown)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Triggered Alerts" subtitle="evaluated on this render" bodyClassName="p-0">
          {hits.length === 0 ? (
            <div className="p-3 text-[11px] text-[var(--ink-3)]">Nothing is triggered.</div>
          ) : (
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Subject</th>
                  <th className="tl">Rule</th>
                  <th className="tl">Detail</th>
                </tr>
              </thead>
              <tbody>
                {hits.slice(0, 8).map((h) => (
                  <tr key={h.ruleId}>
                    <td className="tl font-semibold">{h.subject}</td>
                    <td className="tl text-[10px] text-[var(--ink-3)]">{h.kind.replace(/_/g, " ")}</td>
                    <td className="tl text-[10px]">{h.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {alertLog.length > 0 && (
            <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
              {alertLog.length} fire{alertLog.length === 1 ? "" : "s"} logged recently ·{" "}
              <Link href="/alerts" className="text-[var(--amber)]">
                history
              </Link>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Upcoming Events" subtitle="next 30 days" bodyClassName="p-0">
          {upcoming.length === 0 ? (
            <div className="p-3 text-[11px] text-[var(--ink-3)]">Nothing scheduled.</div>
          ) : (
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Date</th>
                  <th className="tl">Event</th>
                  <th className="tl">Importance</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((e) => (
                  <tr key={e.id}>
                    <td className="tl tabular-nums">{e.date}</td>
                    <td className="tl">
                      <Link href={`/events/${e.id}`} className="hover:text-[var(--amber)]">
                        {e.title}
                      </Link>
                    </td>
                    <td className="tl">
                      <Chip tone={e.importance === "HIGH" ? "neg" : "neutral"}>{e.importance}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Concentration" subtitle="largest exposures across the book" bodyClassName="p-0">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Exposure</th>
                <th>Weight</th>
              </tr>
            </thead>
            <tbody>
              {xray.effective.slice(0, 4).map((e) => (
                <tr key={e.label}>
                  <td className="tl">{e.label}</td>
                  <td className="tabular-nums">{fmtPct(e.weight, 1)}</td>
                </tr>
              ))}
              {sorted.slice(0, 4).map((r) => (
                <tr key={r.position.code}>
                  <td className="tl text-[var(--ink-2)]">{r.position.code}</td>
                  <td className="tabular-nums">{fmtPct(r.currentWeight, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
            Sleeve-level only — fund look-through is unavailable.{" "}
            <Link href="/xray" className="text-[var(--amber)]">
              X-Ray
            </Link>
          </div>
        </Panel>
      </div>

      <Panel title="IC Brief" subtitle="the only AI call on this page" bodyClassName="p-0">
        <IcBrief />
      </Panel>
    </div>
  );
}
