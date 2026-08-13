import Link from "next/link";
import { Chip, Empty, Kpi, Note, Panel } from "@/components/shell/ui";
import { PerformanceChart } from "@/components/charts/performance-chart";
import { fmtPctPoints, fmtTime, signClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AiPortfolioPerformance } from "@/lib/ai/portfolio-performance";
import type { SavedPortfolio } from "@/lib/server/ai-portfolios";
import type { Point } from "@/lib/portfolio/analytics";

/**
 * Track record for one saved AI portfolio.
 *
 * Reuses the same `PerformanceChart` the real book uses, so the comparison
 * against My Real Portfolio and the S&P 500 is like-for-like rather than a
 * second charting implementation with its own conventions.
 */
export function AiPerformance({
  portfolio,
  perf,
  realSeries,
  spxSeries,
  benchmarkLabel = "S&P 500",
}: {
  portfolio: SavedPortfolio;
  perf: AiPortfolioPerformance;
  realSeries: Point[];
  spxSeries: Point[];
  benchmarkLabel?: string;
}) {
  const money = (v: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: perf.currency,
      maximumFractionDigits: 0,
    }).format(v);

  const created = portfolio.baseline.at || portfolio.createdAt;

  // Both comparisons are rebased to the AI portfolio's creation date — showing
  // a benchmark's full history next to a two-week-old portfolio would make the
  // portfolio look like it had missed a rally it was never in.
  const from = created.slice(0, 10);
  const rebase = (points: Point[]): Point[] => {
    const window = points.filter((p) => p.date >= from);
    const base = window[0]?.close;
    if (!base) return [];
    return window.map((p) => ({ date: p.date, close: (p.close / base) * perf.startValue }));
  };

  const benchmarks = [
    { key: "REAL", label: "My Real Portfolio", color: "#4f9df7", points: rebase(realSeries) },
    { key: "BM", label: benchmarkLabel, color: "#26c281", points: rebase(spxSeries) },
  ].filter((b) => b.points.length > 1);

  const epochs = portfolio.allocations;

  return (
    <div className="flex flex-col gap-3">
      <Note tone="info">
        <span>
          Modelled portfolio. Performance is computed from real market prices from{" "}
          <strong>{fmtTime(created)}</strong> onward — there is no history before it was
          created, and none is estimated.
        </span>
      </Note>

      {perf.unavailable.length > 0 && (
        <Note tone="warn">
          <span>
            <strong>NO BASELINE:</strong> {perf.unavailable.join(", ")} — no real price was
            available when {perf.unavailable.length > 1 ? "these positions" : "this position"}{" "}
            entered, so {perf.unavailable.length > 1 ? "they are" : "it is"} excluded from every
            figure below ({fmtPctPoints(perf.unpricedWeight * 100)} of target weight).
          </span>
        </Note>
      )}

      <Panel bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
          <Kpi
            label="Estimated Value"
            value={money(perf.value)}
            sub={`from ${money(perf.startValue)}`}
          />
          <Kpi
            label="Total Return"
            value={fmtPctPoints(perf.totalReturnPct)}
            sub={money(perf.totalReturnAbs)}
            tone={perf.totalReturnPct >= 0 ? "pos" : "neg"}
          />
          <Kpi
            label="Daily Change"
            value={fmtPctPoints(perf.dailyChangePct)}
            sub={money(perf.dailyChangeAbs)}
            tone={perf.dailyChangePct >= 0 ? "pos" : "neg"}
          />
          <Kpi
            label="1M"
            value={perf.window.m1 === null ? "—" : fmtPctPoints(perf.window.m1)}
            tone={(perf.window.m1 ?? 0) >= 0 ? "pos" : "neg"}
          />
          <Kpi
            label="3M"
            value={perf.window.m3 === null ? "—" : fmtPctPoints(perf.window.m3)}
            tone={(perf.window.m3 ?? 0) >= 0 ? "pos" : "neg"}
          />
          <Kpi
            label="YTD"
            value={perf.window.ytd === null ? "—" : fmtPctPoints(perf.window.ytd)}
            sub={`since creation ${
              perf.window.sinceCreation === null
                ? "—"
                : fmtPctPoints(perf.window.sinceCreation)
            }`}
            tone={(perf.window.ytd ?? 0) >= 0 ? "pos" : "neg"}
          />
        </div>
      </Panel>

      <Panel
        title="Cumulative Performance"
        subtitle={`AI portfolio vs my real book vs ${benchmarkLabel}, all rebased to the creation date`}
        bodyClassName="p-0"
      >
        {perf.series.length < 2 ? (
          <Empty>
            Not enough real price history since creation to draw a track record yet.
          </Empty>
        ) : (
          <PerformanceChart portfolio={perf.series} benchmarks={benchmarks} height={340} />
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_320px]">
        <Panel
          title="Position Contribution"
          subtitle="entry weight × the position's own return since it entered"
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Ticker</th>
                  <th className="tl">Origin</th>
                  <th>Target</th>
                  <th>Current</th>
                  <th>Drift</th>
                  <th>Return</th>
                  <th>Contribution</th>
                  <th>Value</th>
                  <th className="tl">Share</th>
                </tr>
              </thead>
              <tbody>
                {[...perf.positions]
                  .sort((a, b) => b.contribution - a.contribution)
                  .map((p) => {
                    const share =
                      perf.totalReturnPct !== 0 ? p.contribution / perf.totalReturnPct : 0;
                    return (
                      <tr key={p.ticker}>
                        <td className="tl font-semibold">
                          <Link
                            href={`/ticker/${encodeURIComponent(p.ticker)}`}
                            className="hover:text-[var(--amber)]"
                          >
                            {p.ticker}
                          </Link>
                        </td>
                        <td className="tl">
                          <Chip tone={p.source === "ai" ? "info" : "amber"}>
                            {p.source === "ai" ? "AI" : "MANUAL"}
                          </Chip>
                        </td>
                        <td className="tabular-nums text-[var(--ink-3)]">
                          {(p.targetWeight * 100).toFixed(1)}%
                        </td>
                        <td className="tabular-nums">
                          {p.available ? `${(p.currentWeight * 100).toFixed(1)}%` : "—"}
                        </td>
                        <td className={cn("tabular-nums", signClass(p.drift))}>
                          {p.available ? `${(p.drift * 100).toFixed(1)}pp` : "—"}
                        </td>
                        <td className={cn("tabular-nums", signClass(p.returnPct))}>
                          {p.returnPct === null ? "—" : fmtPctPoints(p.returnPct)}
                        </td>
                        <td className={cn("tabular-nums", signClass(p.contribution))}>
                          {p.available ? fmtPctPoints(p.contribution) : "—"}
                        </td>
                        <td className="tabular-nums">{p.available ? money(p.value) : "—"}</td>
                        <td className="tl">
                          {p.available ? (
                            <div className="h-1.5 w-full overflow-hidden rounded-sm bg-[var(--panel-2)]">
                              <div
                                className={
                                  p.contribution >= 0
                                    ? "h-full bg-[var(--up)]/70"
                                    : "h-full bg-[var(--down)]/70"
                                }
                                style={{ width: `${Math.min(100, Math.abs(share) * 100)}%` }}
                              />
                            </div>
                          ) : (
                            <Chip tone="warn">NO BASELINE</Chip>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel title="Best / Worst" bodyClassName="p-0">
            {!perf.best ? (
              <Empty>No priced position yet.</Empty>
            ) : (
              <ul className="divide-y divide-[var(--line-soft)]">
                {[
                  { label: "Best performer", p: perf.best },
                  { label: "Worst performer", p: perf.worst },
                ]
                  .filter((x) => x.p)
                  .map(({ label, p }) => (
                    <li key={label} className="px-3 py-2">
                      <div className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                        {label}
                      </div>
                      <div className="mt-0.5 flex items-baseline justify-between gap-2">
                        <Link
                          href={`/ticker/${encodeURIComponent(p!.ticker)}`}
                          className="text-[12px] font-semibold hover:text-[var(--amber)]"
                        >
                          {p!.ticker}
                        </Link>
                        <span className={cn("tabular-nums text-[12px]", signClass(p!.returnPct))}>
                          {fmtPctPoints(p!.returnPct ?? 0)}
                        </span>
                      </div>
                      <div className="text-[10px] text-[var(--ink-3)]">{p!.name}</div>
                    </li>
                  ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Allocation History"
            subtitle="each edit starts a new epoch"
            bodyClassName="p-0"
          >
            <ul className="divide-y divide-[var(--line-soft)]">
              {[...epochs].reverse().map((e, i) => (
                <li key={e.at} className="flex items-baseline justify-between gap-2 px-3 py-1.5">
                  <span className="text-[10.5px]">
                    {e.note}
                    {i === 0 && <span className="ml-1 text-[var(--amber)]">· in force</span>}
                  </span>
                  <span className="text-[10px] tabular-nums text-[var(--ink-3)]">
                    {fmtTime(e.at)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel bodyClassName="p-3">
            <Link
              href={`/ai-portfolios/${portfolio.id}`}
              className="block rounded-sm border border-[var(--line)] px-3 py-1.5 text-center text-[10.5px] uppercase tracking-[0.08em] text-[var(--ink-2)] transition-colors hover:border-[var(--amber)] hover:text-[var(--amber)]"
            >
              Open portfolio detail
            </Link>
          </Panel>
        </div>
      </div>
    </div>
  );
}
