import Link from "next/link";
import { getContext } from "@/lib/server/context";
import { SampleBanner } from "@/components/shell/sample-banner";
import { getSessionUser, isAuthConfigured } from "@/lib/server/auth";
import { Landing } from "@/components/landing/landing";
import { Chip, Empty, Kpi, Note, Panel, StatusBadge } from "@/components/shell/ui";
import { PerformanceChart } from "@/components/charts/performance-chart";
import {
  assessRegime,
  exposureBy,
  portfolioImpacts,
  rebalancePlan,
} from "@/lib/portfolio/analytics";
import {
  fmtPct,
  fmtPctPoints,
  fmtPp,
  fmtTime,
  fmtUsd,
  fmtUsdCompact,
  signClass,
} from "@/lib/format";
import { assessHealth, type SignalState } from "@/lib/portfolio/health";
import { detectChanges } from "@/lib/portfolio/changes";
import { buildTheses } from "@/lib/portfolio/theses";
import { isAiConfigured } from "@/lib/ai/client";
import { DailyBrief } from "@/components/dashboard/daily-brief";
import { PortfolioCommentary } from "@/components/dashboard/commentary";
import { NewsHeadlines } from "@/components/news/news-feed";

const HEALTH_TONE: Record<SignalState, "pos" | "neutral" | "warn" | "neg"> = {
  GOOD: "pos",
  NORMAL: "neutral",
  WARNING: "warn",
  ELEVATED: "neg",
};

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  /**
   * The dashboard is somebody's holdings, so it is not what a stranger opening
   * the link should get. With accounts configured and nobody signed in, this
   * is the front door instead. A local instance with no Supabase has no
   * accounts to check and goes straight to the dashboard, as before.
   */
  const user = await getSessionUser();
  if (isAuthConfigured() && !user) return <Landing />;

  const ctx = await getContext({ markets: true });

  if (ctx.error) {
    return (
      <Panel title="Portfolio unavailable">
        <Note tone="warn">{ctx.error}</Note>
      </Panel>
    );
  }

  const { rows, totals, series, bundle, portfolio, risk, settings } = ctx;
  const theses = buildTheses(portfolio);
  const health = assessHealth(rows, risk, bundle.quotes, theses, settings);
  const changes = detectChanges({
    rows,
    totals,
    quotes: bundle.quotes,
    histories: bundle.histories,
    theses,
    usdTryRate: bundle.usdTryRate,
    settings,
    scope: user?.id ?? "local",
  });
  const aiConfigured = isAiConfigured();
  const regime = assessRegime(bundle.quotes);
  const impacts = portfolioImpacts(bundle.quotes, portfolio);
  const { rows: rebal } = rebalancePlan(rows, settings.driftThreshold);
  const drifted = rebal
    .filter((r) => r.flag !== "IN LINE")
    .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));

  const assetMix = exposureBy(rows, (p) => p.assetClass);
  const regionMix = exposureBy(rows, (p) => p.region);

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

  const top = [...rows].sort((a, b) => b.contributionToReturn - a.contributionToReturn);

  return (
    <div className="flex flex-col gap-3">
      <SampleBanner portfolio={ctx.portfolio} />
      {bundle.status === "UNAVAILABLE" && (
        <Note tone="warn">
          <span>
            <strong>NO MARKET DATA.</strong> No configured provider is returning quotes, so
            values below are omitted rather than estimated. Check the provider status in
            Settings.
          </span>
        </Note>
      )}

      {/* ---------------------------------------------------------- KPI rail */}
      <Panel bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
          <Kpi
            label="Total Value"
            value={fmtUsd(totals.value)}
            sub={`Cost ${fmtUsdCompact(totals.costBasis)}`}
          />
          <Kpi
            label="Daily P&L"
            value={fmtUsdCompact(totals.dailyPnl)}
            sub={fmtPctPoints(totals.dailyPct * 100)}
            tone={totals.dailyPnl >= 0 ? "pos" : "neg"}
          />
          <Kpi
            label="YTD Return (USD)"
            value={fmtPctPoints(totals.ytdPct * 100)}
            sub="Base currency"
            tone={totals.ytdPct >= 0 ? "pos" : "neg"}
          />
          <Kpi
            label="YTD Return (TRY)"
            value={fmtPctPoints(totals.ytdPctTry * 100)}
            sub="(1+r_usd)(1+Δusdtry)−1"
            tone={totals.ytdPctTry >= 0 ? "pos" : "neg"}
          />
          <Kpi
            label="Total P&L"
            value={fmtUsdCompact(totals.totalPnl)}
            sub={`${fmtPctPoints(totals.totalPct * 100)} since ${settings.inceptionDate}`}
            tone={totals.totalPnl >= 0 ? "pos" : "neg"}
          />
          <Kpi
            label="Last Update"
            value={
              <span className="text-[12px] font-normal">
                {new Date().toLocaleTimeString("en-GB", { timeZone: "UTC" })}
              </span>
            }
            sub={<StatusBadge status={bundle.status} />}
          />
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-t border-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Cash / PPF" value={fmtPct(totals.cashPct, 1)} sub="incl. unallocated" />
          <Kpi label="Equity" value={fmtPct(totals.equityPct, 1)} />
          <Kpi label="Commodity" value={fmtPct(totals.commodityPct, 1)} />
          <Kpi
            label="Turkey Exposure"
            value={fmtPct(totals.turkeyPct, 1)}
            tone="amber"
            sub="single-country concentration"
          />
          <Kpi
            label="USD / TRY Exposure"
            value={`${fmtPct(totals.usdExposurePct, 0)} / ${fmtPct(totals.tryExposurePct, 0)}`}
            sub={`USDTRY ${bundle.usdTryRate.toFixed(2)}`}
          />
          <Kpi
            label="Portfolio Vol"
            value={fmtPct(risk.annualVolatility, 1)}
            sub={`Sharpe ${risk.sharpe.toFixed(2)} · covariance-based`}
          />
        </div>
      </Panel>

      {/* ------------------------------------------------- chart + regime */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_320px]">
        <Panel title="Portfolio Performance" bodyClassName="p-0">
          <PerformanceChart portfolio={series} benchmarks={benchmarks} height={300} />
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel
            title="Risk Regime"
            actions={
              <Chip
                tone={
                  regime.regime === "RISK ON"
                    ? "pos"
                    : regime.regime === "RISK OFF"
                      ? "neg"
                      : "warn"
                }
              >
                {regime.regime}
              </Chip>
            }
            bodyClassName="p-0"
          >
            {regime.signals.length === 0 ? (
              <Empty>No market signals available.</Empty>
            ) : (
              <ul className="divide-y divide-[var(--line-soft)]">
                {regime.signals.map((s) => (
                  <li key={s.key} className="flex items-start gap-2 px-3 py-1.5">
                    <span
                      className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                        s.vote === "on"
                          ? "bg-[var(--up)]"
                          : s.vote === "off"
                            ? "bg-[var(--down)]"
                            : "bg-[var(--ink-3)]"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[11px] text-[var(--ink)]">{s.label}</span>
                        <span className="tnum text-[11px] text-[var(--ink-2)]">{s.value}</span>
                      </div>
                      <p className="text-[10px] leading-snug text-[var(--ink-3)]">{s.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
              Rule-based score {regime.score >= 0 ? "+" : ""}
              {regime.score} from VIX, equities, the dollar and rates. Not a forecast.
            </div>
          </Panel>

          <Panel title="Portfolio Impact" bodyClassName="p-0">
            {impacts.length === 0 ? (
              <Empty>No market driver moved enough today to flag an impact.</Empty>
            ) : (
              <ul className="divide-y divide-[var(--line-soft)]">
                {impacts.map((i) => (
                  <li key={i.driver} className="px-3 py-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] text-[var(--ink)]">
                        {i.driver}{" "}
                        <span className={i.direction === "up" ? "pos" : "neg"}>
                          {i.direction === "up" ? "↑" : "↓"} {i.move}
                        </span>
                      </span>
                      <Chip tone={i.sentiment === "positive" ? "pos" : "neg"}>
                        {i.sentiment}
                      </Chip>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {i.affected.map((c) => (
                        <Link key={c} href={`/positions/${c}`}>
                          <Chip tone="neutral">{c}</Chip>
                        </Link>
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] leading-snug text-[var(--ink-3)]">{i.note}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {/* --------------------------------------- health + changes + brief */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel
          title="Portfolio Health"
          subtitle={`${health.score} / 100 · rules-based, no model call`}
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-[var(--line-soft)]">
            {health.signals.map((s) => (
              <li
                key={s.key}
                className="flex items-center justify-between gap-2 px-3 py-1.5"
                title={s.detail}
              >
                <span className="text-[11px]">{s.label}</span>
                <span className="flex items-center gap-2">
                  <span className="text-[10px] tabular-nums text-[var(--ink-3)]">{s.value}</span>
                  <Chip tone={HEALTH_TONE[s.state]}>{s.state}</Chip>
                </span>
              </li>
            ))}
          </ul>
          <div className="border-t border-[var(--line)] px-3 py-2 text-[10px] text-[var(--ink-3)]">
            Mean of the five signal scores. Each signal is a clamped linear grade between a
            good and a bad level — see the tooltips. Internal heuristic, not a standard measure.
          </div>
        </Panel>

        <Panel
          title="What Changed"
          subtitle={
            changes.since
              ? `since ${fmtTime(changes.since)}`
              : "first check — baseline recorded"
          }
          bodyClassName="p-0"
        >
          {changes.changes.length === 0 ? (
            <Empty>
              {changes.since
                ? "Nothing crossed a threshold since your last check."
                : "Baseline saved. Changes will appear here on your next visit."}
            </Empty>
          ) : (
            <ul className="divide-y divide-[var(--line-soft)]">
              {changes.changes.map((c) => (
                <li key={c.key} className="flex items-start gap-2 px-3 py-1.5">
                  <Chip tone={c.tone}>·</Chip>
                  <span className="flex-1 text-[10.5px] leading-snug">{c.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Daily Brief" bodyClassName="p-0">
          <DailyBrief aiConfigured={aiConfigured} />
        </Panel>
      </div>

      <Panel
        title="Portfolio Commentator"
        subtitle="on-demand AI read of structure and exposure — never automatic"
        bodyClassName="p-0"
      >
        <PortfolioCommentary aiConfigured={aiConfigured} />
      </Panel>

      {/* ------------------------------------------------------------ news */}
      <Panel
        title="News"
        subtitle="Most relevant headlines for this book"
        actions={
          <Link href="/news" className="text-[10px] text-[var(--ink-3)] hover:text-[var(--amber)]">
            all news →
          </Link>
        }
        bodyClassName="p-0"
      >
        <NewsHeadlines limit={5} />
      </Panel>

      {/* ---------------------------------------------- mixes + drift + top */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel title="Asset Class" bodyClassName="p-0">
          <MixBars data={assetMix} />
        </Panel>
        <Panel title="Region" bodyClassName="p-0">
          <MixBars data={regionMix} />
        </Panel>
        <Panel
          title="Weight Drift"
          subtitle={`threshold ±${(settings.driftThreshold * 100).toFixed(1)}pp`}
          bodyClassName="p-0"
        >
          {drifted.length === 0 ? (
            <Empty>Every position is inside its drift band.</Empty>
          ) : (
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Code</th>
                  <th>Curr</th>
                  <th>Target</th>
                  <th>Drift</th>
                  <th className="tl">Flag</th>
                </tr>
              </thead>
              <tbody>
                {drifted.slice(0, 7).map((r) => (
                  <tr key={r.code}>
                    <td className="tl">
                      <Link href={`/positions/${r.code}`} className="hover:text-[var(--amber)]">
                        {r.code}
                      </Link>
                    </td>
                    <td>{fmtPct(r.currentWeight, 2)}</td>
                    <td className="text-[var(--ink-3)]">{fmtPct(r.targetWeight, 2)}</td>
                    <td className={signClass(r.drift)}>{fmtPp(r.drift)}</td>
                    <td className="tl">
                      <Chip tone={r.flag === "OVERWEIGHT" ? "neg" : "info"}>{r.flag}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <Panel
        title="Contribution to Return"
        subtitle="position P&L as a share of total cost basis"
        actions={
          <Link href="/positions" className="text-[10px] text-[var(--amber)] hover:underline">
            All positions →
          </Link>
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Code</th>
                <th className="tl">Asset</th>
                <th>Weight</th>
                <th>Daily</th>
                <th>YTD</th>
                <th>Value</th>
                <th>P&L</th>
                <th>Contrib.</th>
              </tr>
            </thead>
            <tbody>
              {top.map((r) => (
                <tr key={r.position.code}>
                  <td className="tl">
                    <Link
                      href={`/positions/${r.position.code}`}
                      className="font-semibold text-[var(--ink)] hover:text-[var(--amber)]"
                    >
                      {r.position.code}
                    </Link>
                  </td>
                  <td className="tl max-w-[240px] truncate text-[var(--ink-2)]">
                    {r.position.name}
                  </td>
                  <td>{fmtPct(r.currentWeight, 2)}</td>
                  <td className={signClass(r.dailyPct)}>{fmtPctPoints(r.dailyPct * 100)}</td>
                  <td className={signClass(r.ytdPct)}>
                    {r.ytdPct === null ? "—" : fmtPctPoints(r.ytdPct * 100)}
                  </td>
                  <td>{fmtUsdCompact(r.value)}</td>
                  <td className={signClass(r.unrealizedPnl)}>{fmtUsdCompact(r.unrealizedPnl)}</td>
                  <td className={signClass(r.contributionToReturn)}>
                    {fmtPctPoints(r.contributionToReturn * 100)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
          Source: {portfolio.meta.sourceFile} · parsed {fmtTime(portfolio.meta.parsedAt)} ·{" "}
          {portfolio.positions.length} positions
          {portfolio.meta.warnings.length > 0 && (
            <span className="text-[var(--warn)]"> · {portfolio.meta.warnings.join(" ")}</span>
          )}
        </div>
      </Panel>
    </div>
  );
}

function MixBars({ data }: { data: { label: string; value: number; weight: number }[] }) {
  return (
    <ul className="divide-y divide-[var(--line-soft)]">
      {data.map((d) => (
        <li key={d.label} className="px-3 py-1.5">
          <div className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="truncate text-[var(--ink-2)]">{d.label}</span>
            <span className="tnum shrink-0 text-[var(--ink)]">{fmtPct(d.weight, 1)}</span>
          </div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-sm bg-[var(--panel-2)]">
            <div
              className="h-full bg-[var(--amber)]/70"
              style={{ width: `${Math.min(100, d.weight * 100).toFixed(2)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
