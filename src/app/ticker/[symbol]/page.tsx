import "@/lib/providers/register";
import Link from "next/link";
import { Chip, Empty, Kpi, Note, Panel } from "@/components/shell/ui";
import { TickerChart } from "@/components/charts/ticker-chart";
import { getHistoricalPrices, getQuotes } from "@/lib/providers";
import { getContext } from "@/lib/server/context";
import { ThirdSource } from "@/components/research/third-source";
import { cachedScreenerUniverse } from "@/lib/scanner/screener-universe";

/**
 * Which field of Google's financials answers the same question as one of our
 * rows. A label absent here simply gets no third column.
 */
const THIRD_SOURCE_FIELD: Record<string, "netMargin" | "returnOnAssets" | "priceToBook" | "eps"> = {
  "Net Margin": "netMargin",
  ROA: "returnOnAssets",
  "P/B": "priceToBook",
};
import { peekPortfolioForCaller } from "@/lib/server/user-portfolio";
import { listPortfolios, currentAllocation } from "@/lib/server/ai-portfolios";
import { fmtNum, fmtPct, fmtPctPoints, fmtUsd } from "@/lib/format";
import { technicalState } from "@/lib/portfolio/alert-engine";
import { RelativeStrengthPanel } from "@/components/ticker/relative-strength";
import { getCatalysts } from "@/lib/events/catalysts";
import { Section } from "@/components/research/section";
import { InsiderPanel, InsiderSignalChip } from "@/components/research/insider-panel";
import { FinancialsTabs } from "@/components/research/financials-tabs";
import {
  AnalystPanel,
  CapitalPanel,
  EarningsQualityPanel,
  GuidancePanel,
  HealthPanel,
  KeyMetricsPanel,
  SmartMoneyPanel,
  TrendPanel,
} from "@/components/research/panels";
import { analyseInsiders } from "@/lib/research/insiders";
import { analyseAnalysts } from "@/lib/research/analysts";
import { getGuidance } from "@/lib/research/guidance";
import { buildHealth } from "@/lib/research/health";
import { buildSmartMoney } from "@/lib/research/smart-money";
import { buildKeyMetrics } from "@/lib/research/key-metrics";
import {
  buildTrends,
  capitalAllocation,
  earningsQuality,
  ordered,
  overview,
} from "@/lib/research/statements";
import { valuationRows } from "@/lib/portfolio/quality-score";
import { getOwnership } from "@/lib/providers/ownership";
import { getHoldings, reverseLookup, summarise } from "@/lib/providers/etf-holdings";
import { OwnershipPanel, HoldingsPanel } from "@/components/research/ownership-panel";
import { ExecutiveBrief } from "@/components/research/executive-brief";
import { themesForAsset, chainsForAsset } from "@/lib/events/chains";
import { isBistSymbol } from "@/lib/providers/bist";
import { isBankLike } from "@/lib/research/company-kind";
import { AltDataPanel } from "@/components/research/alt-data-panel";
import { PeerPanel } from "@/components/research/peer-panel";
import { currencySymbol } from "@/lib/format-currency";
import { ConfidenceBadge } from "@/components/research/confidence-badge";
import { PANEL_CONFIDENCE } from "@/lib/research/confidence";
import { getContracts, getHiring } from "@/lib/research/alt-data";
import { nowcast as runNowcast } from "@/lib/research/alt-data";
import {
  getYahooStatements,
  type YahooStatements,
} from "@/lib/providers/yahoo-fundamentals";
import { fillBalanceSheet, getFmpBalanceSheets } from "@/lib/providers/fmp";
import {
  getAnnualFinancials,
  getEarnings,
  getFinancials,
  getInsiders,
  getMetrics,
  getRecommendations,
} from "@/lib/providers/fundamentals";
import { buildEgBundle } from "@/lib/engines/eg-bundle";
import { buildTechnicalDecision } from "@/lib/engines/technical-v3";
import { getClassifiedNews } from "@/lib/data/eodhd/news";
import { macroByAlias } from "@/lib/data/macro-tickers";
import { isMajorEtf } from "@/lib/data/etf-list";
import { getEtfView } from "@/lib/data/eodhd/etf";
import { EtfPage, MacroPage } from "@/components/ticker/instrument-pages";
import { buildStreetView } from "@/lib/engines/street-view";
import { getSnapshotHistory } from "@/lib/data/snapshots";
import {
  toEarningsPoints,
  toFinancialPeriods,
  toKeyMetrics,
  toRecommendations,
} from "@/lib/data/eodhd/legacy-adapter";
import {
  CompanyPlanPanel,
  DecisionBar,
  QuickThesisPanel,
  TabNav,
  TickerHeader,
  normalizeTab,
} from "@/components/ticker/terminal";
import { TechnicalTab } from "@/components/ticker/technical-tab";
import { ValuationTab } from "@/components/ticker/valuation-tab";
import { NewsTab } from "@/components/ticker/news-tab";
import { EarningsTab } from "@/components/ticker/earnings-tab";
import { FinancialsV2 } from "@/components/ticker/financials-v2";
import { Chip as Tone } from "@/components/shell/ui";
import type { Candle } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Return between the close `bars` sessions back and the latest close. */
function changeOver(candles: Candle[], bars: number): number | null {
  if (candles.length < 2) return null;
  const last = candles[candles.length - 1].close;
  const ref = candles[Math.max(0, candles.length - 1 - bars)]?.close;
  return ref && ref > 0 ? (last / ref - 1) * 100 : null;
}

function changeYtd(candles: Candle[]): number | null {
  if (candles.length < 2) return null;
  const start = `${new Date().getUTCFullYear()}-01-01`;
  const ref = candles.find((c) => c.date >= start)?.close;
  const last = candles[candles.length - 1].close;
  return ref && ref > 0 ? (last / ref - 1) * 100 : null;
}

function movingAverage(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null;
  const slice = candles.slice(-period);
  return slice.reduce((s, c) => s + c.close, 0) / slice.length;
}

/**
 * Ticker detail — a tabbed professional terminal. Works for ANY symbol, held
 * or not: screener, opportunities, search and watchlist all land here.
 *
 * The tab is a URL param (`?tab=technical`), so every view is linkable and
 * server-rendered; no client recomputation. US symbols run on the validated
 * EODHD snapshot (single source of truth), BIST keeps the legacy providers.
 */
export default async function TickerPage(props: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { symbol: raw } = await props.params;
  const sp = await props.searchParams;
  const symbol = decodeURIComponent(raw).toUpperCase();

  /** A deadline per source, so one slow provider cannot hold the page. */
  const within = <T,>(ms: number, p: Promise<T>, fallback: T): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);

  const CORE_MS = 12_000;
  const PANEL_MS = 5_000;

  // SINGLE SOURCE OF TRUTH (US): fundamentals/statements/earnings/analyst data
  // come from the validated EODHD snapshot, adapted to the panels' shapes.
  // BIST keeps the legacy Yahoo/Finnhub path (EODHD carries no Borsa İstanbul).
  const bist = isBistSymbol(symbol);
  const history = await getHistoricalPrices(symbol, 1300);
  const candles = history.candles;

  // ---------------- instrument-aware branches (a commodity is not a company)
  const macro = macroByAlias(symbol);
  const rawTab = typeof sp.tab === "string" ? sp.tab.toLowerCase() : "overview";
  if (macro) {
    const q = await within(CORE_MS, getQuotes([symbol]), {} as Awaited<ReturnType<typeof getQuotes>>);
    const lastPx = candles.at(-1)?.close ?? q[symbol]?.price ?? null;
    const d = candles.length >= 60 ? buildTechnicalDecision(symbol, candles) : null;
    return <MacroPage macro={macro} candles={candles} quote={q[symbol] ?? null} last={lastPx} decision={d} tab={rawTab} />;
  }
  if (!bist && isMajorEtf(symbol)) {
    const etfView = await within(CORE_MS, getEtfView(symbol), null);
    if (etfView) {
      const q = await within(CORE_MS, getQuotes([symbol]), {} as Awaited<ReturnType<typeof getQuotes>>);
      const lastPx = candles.at(-1)?.close ?? q[symbol]?.price ?? null;
      const d = candles.length >= 60 ? buildTechnicalDecision(symbol, candles) : null;
      const etfNews = await within(PANEL_MS, getClassifiedNews(symbol, 25).catch(() => []), []);
      return (
        <EtfPage view={etfView} symbol={symbol} candles={candles} quote={q[symbol] ?? null} last={lastPx} decision={d} news={etfNews} tab={rawTab} />
      );
    }
  }

  const eg = bist ? null : await within(CORE_MS, buildEgBundle(symbol, null, candles), null);
  const egSnapshot = eg?.snapshot ?? null;
  const useEodhd = egSnapshot !== null;
  // Candle-only V3 decision: the TECHNICAL tab and the decision bar must work
  // even when fundamentals are unavailable (quota, outage, BIST).
  const techDecision = candles.length >= 60 ? buildTechnicalDecision(symbol, candles) : null;
  // News is company-scoped and independent of the fundamentals snapshot: the
  // NEWS tab works even when the snapshot fetch is down (quota/outage).
  const news = eg?.news ?? (bist ? [] : await within(PANEL_MS, getClassifiedNews(symbol, 25).catch(() => []), []));
  const tab = normalizeTab(typeof sp.tab === "string" ? sp.tab : undefined, useEodhd);

  const [
    quotes,
    saved,
    heldPortfolio,
    metrics,
    financials,
    annualFinancials,
    recommendations,
    earnings,
    insiders,
    guidance,
    ownership,
    etfLookup,
    holdings,
    contracts,
    hiring,
    catalysts,
  ] = await Promise.all([
    within(CORE_MS, getQuotes([symbol]), {} as Awaited<ReturnType<typeof getQuotes>>),
    within(PANEL_MS, listPortfolios().catch(() => []), []),
    within(PANEL_MS, peekPortfolioForCaller().catch(() => null), null),
    // US: EODHD-adapted shapes (no provider call — snapshot already fetched).
    // BIST: legacy providers, the explicitly allowed exception.
    useEodhd ? Promise.resolve(toKeyMetrics(egSnapshot)) : bist ? within(CORE_MS, getMetrics(symbol).catch(() => null), null) : Promise.resolve(null),
    useEodhd ? Promise.resolve(toFinancialPeriods(egSnapshot, "quarterly")) : bist ? within(CORE_MS, getFinancials(symbol).catch(() => null), null) : Promise.resolve(null),
    useEodhd ? Promise.resolve(toFinancialPeriods(egSnapshot, "annual")) : bist ? within(CORE_MS, getAnnualFinancials(symbol).catch(() => null), null) : Promise.resolve(null),
    useEodhd ? Promise.resolve(toRecommendations(egSnapshot)) : bist ? within(PANEL_MS, getRecommendations(symbol).catch(() => null), null) : Promise.resolve(null),
    useEodhd ? Promise.resolve(toEarningsPoints(egSnapshot)) : bist ? within(PANEL_MS, getEarnings(symbol).catch(() => null), null) : Promise.resolve(null),
    within(PANEL_MS, getInsiders(symbol).catch(() => null), null),
    bist ? within(PANEL_MS, getGuidance(symbol).catch(() => null), null) : Promise.resolve(null),
    within(PANEL_MS, getOwnership(symbol).catch(() => null), null),
    within(
      PANEL_MS,
      reverseLookup(symbol, ["SPY", "QQQ", "SMH", "XLK", "VGK", "RSP", "XLI", "XLF"]).catch(() => ({
        available: false,
        rows: [] as { etf: string; weight: number; rank: number; aum: number | null }[],
      })),
      { available: false, rows: [] as { etf: string; weight: number; rank: number; aum: number | null }[] },
    ),
    within(PANEL_MS, getHoldings(symbol).catch(() => null), null),
    within(PANEL_MS, getContracts(symbol).catch(() => []), []),
    within(PANEL_MS, getHiring(symbol).catch(() => null), null),
    within(PANEL_MS, getCatalysts(symbol).catch(() => []), []),
  ]);

  // BIST-only fallback: FMP/Yahoo may never contaminate US statements.
  const fmp = bist ? await within(PANEL_MS, getFmpBalanceSheets(symbol).catch(() => null), null) : null;

  const altStatements: YahooStatements | null = !bist
    ? null
    : financials?.length
    ? null
    : (fmp ??
      (await within(PANEL_MS, getYahooStatements(symbol).catch(() => null), null)));

  const fillOpts = { bankLike: isBankLike(symbol) };
  const bsFill = altStatements ? null : fillBalanceSheet(financials ?? [], fmp, fillOpts);
  const annualFill = altStatements
    ? null
    : fillBalanceSheet(annualFinancials ?? [], fmp, fillOpts);

  const isHeld = (heldPortfolio?.positions ?? []).some(
    (p) =>
      p.code.toUpperCase() === symbol || (p.symbol ?? "").toUpperCase() === symbol,
  );
  const ctx = isHeld ? await getContext({ markets: false }).catch(() => null) : null;

  const quote = quotes[symbol] ?? null;
  const last = candles.at(-1)?.close ?? quote?.price ?? null;

  const yearCandles = candles.slice(-253);
  const high52 = yearCandles.length ? Math.max(...yearCandles.map((c) => c.high || c.close)) : null;
  const low52 = yearCandles.length ? Math.min(...yearCandles.map((c) => c.low || c.close)) : null;

  const tech = technicalState(candles, last);

  // ------------------------------------------------------------- research
  const periods = ordered(altStatements?.quarterly ?? bsFill?.periods ?? financials ?? [], 8);
  const annualPeriods = ordered(
    altStatements?.annual ?? annualFill?.periods ?? annualFinancials ?? [],
    8,
  );
  const insiderReport = insiders?.length ? analyseInsiders(insiders) : null;
  const analystReport = analyseAnalysts(recommendations);
  const guidanceReport =
    guidance ?? {
      entries: [],
      trend: "N/A" as const,
      available: false,
      note: "Guidance could not be loaded.",
    };
  const health = buildHealth(metrics, periods, symbol);
  const trends = buildTrends(periods);
  const quality = earningsQuality(periods);
  const capital = capitalAllocation(periods);
  const universeRow = cachedScreenerUniverse().find((r) => r.symbol === symbol);
  const overviewSections = overview(periods, metrics, symbol);

  const verifiable = overviewSections
    .flatMap((sec) => sec.items)
    .filter((i) => i.agreement)
    .flatMap((i) => {
      const from = THIRD_SOURCE_FIELD[i.label];
      if (!from) return [];
      const m = /filings give ([-\d.]+), the provider ([-\d.]+)/.exec(i.hint ?? "");
      return [
        {
          label: i.label,
          filed: m ? Number(m[1]) : i.value,
          reported: m ? Number(m[2]) : i.value,
          from,
          unit: (i.format === "x" ? "x" : "pct") as "pct" | "x",
        },
      ];
    });
  const keyMetrics = buildKeyMetrics({ metrics, periods, price: last, analysts: analystReport, symbol });

  const valRows = valuationRows(metrics).filter((r) => r.verdict !== "N/A");
  const valScore: number[] = valRows.map((r) =>
    r.verdict === "CHEAP" ? -1 : r.verdict === "EXPENSIVE" ? 1 : 0,
  );
  const valSum = valScore.reduce((a, b) => a + b, 0);
  const valuation: "CHEAP" | "FAIR" | "EXPENSIVE" | "N/A" =
    valRows.length === 0
      ? "N/A"
      : valSum >= Math.ceil(valRows.length / 2)
        ? "EXPENSIVE"
        : valSum <= -Math.ceil(valRows.length / 2)
          ? "CHEAP"
          : "FAIR";

  const worldThemes = themesForAsset(symbol);
  const chains = chainsForAsset(symbol);
  const holdingsSummary = holdings ? summarise(holdings) : null;

  const ttmRevenue = (() => {
    const w = periods.slice(-4);
    if (w.length < 4) return null;
    return w.reduce<number | null>(
      (acc, p) => (acc === null || p.revenue === null ? null : acc + p.revenue),
      0,
    );
  })();
  const lastP = periods.at(-1);
  const priorP = periods.length >= 5 ? periods[periods.length - 5] : null;
  const gmBps =
    lastP?.grossProfit != null && lastP.revenue && priorP?.grossProfit != null && priorP.revenue
      ? Math.round(
          ((lastP.grossProfit / lastP.revenue - priorP.grossProfit / priorP.revenue) * 100) * 100,
        )
      : null;
  const activityNowcast = runNowcast({
    hiring,
    pricing: null,
    contracts,
    patents: null,
    analystRevision: analystReport.scoreChange,
    grossMarginChangeBps: gmBps,
    inventoryChangePct:
      lastP?.inventory != null && priorP?.inventory
        ? ((lastP.inventory - priorP.inventory) / Math.abs(priorP.inventory)) * 100
        : null,
  });

  const statementAsOf = periods.at(-1)?.endDate ?? null;
  const moneySym = currencySymbol(altStatements?.currency ?? quote?.currency ?? "USD");

  const smartMoney = buildSmartMoney({
    insiders: insiderReport,
    analysts: analystReport,
    guidance: guidanceReport,
    health,
    metrics,
    technical: tech?.state ?? null,
    valuation,
  });

  const ma50 = movingAverage(candles, 50);
  const ma200 = movingAverage(candles, 200);
  const distTo = (level: number | null) =>
    level && last ? ((last / level - 1) * 100) : null;

  const row = ctx?.rows.find(
    (r) =>
      r.position.code.toUpperCase() === symbol ||
      (r.position.symbol ?? "").toUpperCase() === symbol,
  );

  const inAi = saved
    .map((p) => {
      const alloc = currentAllocation(p);
      const pos = alloc.positions.find((x) => x.ticker.toUpperCase() === symbol);
      return pos ? { portfolio: p, pos } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <div className="flex flex-col gap-3">
      {/* ------------------------------------------------ terminal chrome */}
      <div className="flex items-center gap-2 text-[11px] text-[var(--ink-3)]">
        <Link href="/positions" className="hover:text-[var(--amber)]">← Positions</Link>
        <span>·</span>
        <Link href="/screener" className="hover:text-[var(--amber)]">Screener</Link>
        <span>·</span>
        <Link href="/opportunities" className="hover:text-[var(--amber)]">Opportunities</Link>
      </div>

      <TickerHeader symbol={symbol} eg={eg} quote={quote} last={last} bist={bist} />

      {!quote && (
        <Note tone="warn">
          <span>
            <strong>DATA UNAVAILABLE.</strong> No configured provider returned a real quote for{" "}
            {symbol}.
          </span>
        </Note>
      )}

      {techDecision && <DecisionBar eg={eg} decision={techDecision} />}

      <TabNav symbol={symbol} active={tab} hasEg={useEodhd} />

      {/* ========================================================= OVERVIEW */}
      {tab === "OVERVIEW" && (
        <>
          {eg && <QuickThesisPanel eg={eg} />}
          {eg && <CompanyPlanPanel eg={eg} />}

          {/* EG TIME MACHINE — what EG believed then vs now (daily snapshots, never rewritten) */}
          {eg && (() => {
            const hist = getSnapshotHistory(symbol);
            if (hist.length < 2) return null;
            const today = hist[hist.length - 1]!;
            const pick = (daysBack: number) => {
              const target = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);
              return [...hist].reverse().find((h) => h.date <= target) ?? hist[0]!;
            };
            const ago7 = pick(7);
            const ago30 = pick(30);
            const rows: Array<[string, (s: typeof today) => string]> = [
              ["Price", (x) => (x.price !== null ? `$${x.price.toFixed(2)}` : "—")],
              ["EG fair value", (x) => (x.fairValue !== null ? `$${x.fairValue.toFixed(2)}` : "—")],
              ["Upside", (x) => (x.upsidePct !== null ? `${x.upsidePct > 0 ? "+" : ""}${x.upsidePct.toFixed(0)}%` : "—")],
              ["Technical state", (x) => x.technicalState ?? "—"],
              ["Support", (x) => (x.primarySupport !== null ? `$${x.primarySupport.toFixed(2)}` : "—")],
              ["Revision score", (x) => (x.revisionScore !== null ? `${x.revisionScore}/100` : "—")],
            ];
            return (
              <Panel title="EG Time Machine" subtitle="what this terminal believed on past days — daily snapshots, written once, never rewritten" bodyClassName="p-0">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th className="tl">Belief</th>
                      <th>{ago30.date}</th>
                      <th>{ago7.date}</th>
                      <th>Today ({today.date})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(([label, get]) => (
                      <tr key={label}>
                        <td className="tl text-[var(--ink-3)]">{label}</td>
                        <td className="tabular-nums">{get(ago30)}</td>
                        <td className="tabular-nums">{get(ago7)}</td>
                        <td className="tabular-nums font-semibold">{get(today)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            );
          })()}

          <Panel bodyClassName="p-0">
            <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-4 lg:grid-cols-6">
              <Kpi
                label="Last"
                value={last === null ? "—" : fmtNum(last, last > 500 ? 2 : 4)}
                sub={quote ? quote.provider : "no quote"}
              />
              <Kpi
                label="Daily"
                value={quote ? fmtPctPoints(quote.changePercent) : "—"}
                tone={(quote?.changePercent ?? 0) >= 0 ? "pos" : "neg"}
              />
              <Kpi label="1W" value={fmtPctPoints(changeOver(candles, 5))} />
              <Kpi label="1M" value={fmtPctPoints(changeOver(candles, 22))} />
              <Kpi label="3M" value={fmtPctPoints(changeOver(candles, 64))} />
              <Kpi label="YTD" value={fmtPctPoints(changeYtd(candles))} />
            </div>
            <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-t border-[var(--line)] sm:grid-cols-4 lg:grid-cols-6">
              <Kpi label="1Y" value={fmtPctPoints(changeOver(candles, 253))} />
              <Kpi
                label="3Y"
                value={candles.length > 756 ? fmtPctPoints(changeOver(candles, 756)) : "—"}
                sub={candles.length > 756 ? undefined : "not enough history"}
              />
              <Kpi label="52w High" value={high52 === null ? "—" : fmtNum(high52, 2)} />
              <Kpi label="52w Low" value={low52 === null ? "—" : fmtNum(low52, 2)} />
              <Kpi
                label="vs 50DMA"
                value={distTo(ma50) === null ? "—" : fmtPctPoints(distTo(ma50))}
                tone={(distTo(ma50) ?? 0) >= 0 ? "pos" : "neg"}
                sub={ma50 ? fmtNum(ma50, 2) : undefined}
              />
              <Kpi
                label="vs 200DMA"
                value={distTo(ma200) === null ? "—" : fmtPctPoints(distTo(ma200))}
                tone={(distTo(ma200) ?? 0) >= 0 ? "pos" : "neg"}
                sub={ma200 ? fmtNum(ma200, 2) : undefined}
              />
            </div>
            {high52 !== null && last !== null && (
              <div className="border-t border-[var(--line)] px-3 py-1.5 text-[10px] text-[var(--ink-3)]">
                {fmtPctPoints(((last / high52 - 1) * 100))} from the 52-week high
                {low52 !== null && ` · ${fmtPctPoints((last / low52 - 1) * 100)} above the 52-week low`}
              </div>
            )}
          </Panel>

          <div className="grid gap-3 xl:grid-cols-3">
            <Panel title="Price History" bodyClassName="p-0" className="xl:col-span-2">
              <TickerChart symbol={symbol} />
            </Panel>
            <Panel
              title="Key Company Metrics"
              subtitle="the ten-second read"
              bodyClassName="p-0"
            >
              <KeyMetricsPanel items={keyMetrics} />
            </Panel>
          </div>

          <Section
            title="OPPORTUNITY / PEER POSITION"
            subtitle="sector-relative score, percentiles and model fair value"
            defaultOpen
          >
            <PeerPanel symbol={symbol} />
          </Section>

          <Section
            title="SMART MONEY"
            subtitle="who is positioned how, across every signal with data"
            defaultOpen
            badge={
              <span className="text-[10px] text-[var(--ink-3)]">
                {smartMoney.score === null ? "N/A" : `${smartMoney.score}/100`} · {smartMoney.coverage}/
                {smartMoney.total}
              </span>
            }
          >
            <SmartMoneyPanel data={smartMoney} />
          </Section>

          <Panel
            title="Catalyst Timeline"
            subtitle="company events plus the macro releases that move this sleeve"
            bodyClassName="p-0"
          >
            {catalysts.length === 0 ? (
              (() => {
                const nextEst = eg?.snapshot.forwardEstimates.find((e) => e.periodEnd > new Date().toISOString().slice(0, 10));
                return nextEst ? (
                  <div className="px-3 py-2 text-[11px]">
                    <Chip tone="amber">NEXT REPORT</Chip>
                    <span className="ml-2">
                      Results for the period ending <span className="font-semibold tabular-nums">{nextEst.periodEnd}</span>
                      {nextEst.epsAvg !== null ? ` — street EPS $${nextEst.epsAvg.toFixed(2)}` : ""}
                      {nextEst.analystCount ? ` (${nextEst.analystCount} analysts)` : ""}
                    </span>
                    <span className="ml-2 text-[9.5px] text-[var(--ink-3)]">derived from estimate periods; exact report date not yet published</span>
                  </div>
                ) : (
                  <Empty>
                    No dated catalyst available for {symbol}. Dividends and investor days are N/A on
                    the configured data plan.
                  </Empty>
                );
              })()
            ) : (
              <table className="grid-table">
                <thead>
                  <tr>
                    <th className="tl">Date</th>
                    <th className="tl">In</th>
                    <th className="tl">Type</th>
                    <th className="tl">Event</th>
                    <th className="tl">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {catalysts.map((c) => {
                    const days = Math.round(
                      (Date.parse(`${c.date}T12:00:00Z`) - Date.now()) / 86_400_000,
                    );
                    return (
                      <tr key={`${c.date}-${c.title}`}>
                        <td className="tl tabular-nums">{c.date}</td>
                        <td className="tl text-[10px] text-[var(--ink-3)]">
                          {days <= 0 ? "today" : `${days}d`}
                        </td>
                        <td className="tl">
                          <Chip tone={c.kind === "earnings" ? "amber" : "neutral"}>
                            {c.kind.toUpperCase()}
                          </Chip>
                        </td>
                        <td className="tl font-semibold">{c.title}</td>
                        <td className="tl text-[10px] text-[var(--ink-3)]" title={c.source}>
                          {c.detail}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Panel>

          {(worldThemes.length > 0 || chains.length > 0) && (
            <Section
              title="WORLD EVENTS & TRANSMISSION"
              subtitle="which themes reach this name, and through what"
            >
              <div className="divide-y divide-[var(--line-soft)]">
                {worldThemes.map(({ theme, exposure }) => (
                  <div key={theme.id} className="px-3 py-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[11px] font-semibold">{theme.label}</span>
                      <Chip
                        tone={
                          exposure.kind === "DIRECT" ? "neg" : exposure.kind === "HEDGE" ? "pos" : "neutral"
                        }
                      >
                        {exposure.kind}
                      </Chip>
                      <span className="text-[9.5px] text-[var(--ink-3)]">{theme.category}</span>
                    </div>
                    <p className="mt-0.5 text-[10px] leading-snug text-[var(--ink-3)]">
                      <span className="text-[var(--ink-2)]">Why:</span> {exposure.why}
                    </p>
                  </div>
                ))}
                {chains.map(({ chain, nodes }) => (
                  <div key={chain.id} className="px-3 py-2">
                    <Link href="/chains" className="text-[11px] font-semibold hover:text-[var(--amber)]">
                      {chain.title}
                    </Link>
                    {nodes.map((n) => (
                      <p key={n.id} className="mt-0.5 text-[10px] leading-snug text-[var(--ink-3)]">
                        <span className="text-[var(--ink-2)]">
                          {n.order === 1 ? "1st" : n.order === 2 ? "2nd" : "3rd"} order · {n.label}:
                        </span>{" "}
                        {n.why}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
              <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
                Transmission mechanisms, not forecasts. Each says how an impulse would reach this
                name if the trigger occurs — not that it will.
              </div>
            </Section>
          )}

          {/* -------------------------------------------- portfolio context */}
          {row && (
            <Panel title="In My Real Portfolio" bodyClassName="p-0">
              <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
                <Kpi label="Position Value" value={fmtUsd(row.value)} />
                <Kpi label="Current Weight" value={fmtPct(row.currentWeight, 1)} />
                <Kpi
                  label="Target Weight"
                  value={fmtPct(row.targetWeight, 1)}
                  sub={`drift ${(row.drift * 100).toFixed(1)}pp`}
                />
                <Kpi label="Cost Basis" value={fmtUsd(row.costBasis)} />
                <Kpi
                  label="Unrealised P&L"
                  value={fmtUsd(row.unrealizedPnl)}
                  sub={fmtPctPoints(row.unrealizedPnlPct * 100)}
                  tone={row.unrealizedPnl >= 0 ? "pos" : "neg"}
                />
                <Kpi
                  label="Contribution"
                  value={fmtPctPoints(row.contributionToReturn * 100)}
                  tone={row.contributionToReturn >= 0 ? "pos" : "neg"}
                />
              </div>
            </Panel>
          )}

          {inAi.length > 0 && (
            <Panel
              title="In Saved AI Portfolios"
              subtitle="allocation inside each modelled portfolio"
              bodyClassName="p-0"
            >
              <table className="grid-table">
                <thead>
                  <tr>
                    <th className="tl">Portfolio</th>
                    <th className="tl">Origin</th>
                    <th>Weight</th>
                    <th>Original</th>
                    <th className="tl">Role</th>
                    <th className="tl">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {inAi.map(({ portfolio, pos }) => (
                    <tr key={portfolio.id}>
                      <td className="tl font-semibold">
                        <Link
                          href={`/ai-portfolios/${portfolio.id}`}
                          className="hover:text-[var(--amber)]"
                        >
                          {portfolio.name}
                        </Link>
                      </td>
                      <td className="tl">
                        <Chip tone={pos.source === "ai" ? "info" : "amber"}>
                          {pos.source === "ai" ? "AI" : "MANUAL"}
                        </Chip>
                      </td>
                      <td className="tabular-nums">{(pos.weight * 100).toFixed(1)}%</td>
                      <td className="tabular-nums text-[var(--ink-3)]">
                        {pos.originalWeight === null
                          ? "—"
                          : `${(pos.originalWeight * 100).toFixed(1)}%`}
                      </td>
                      <td className="tl text-[10px]">{pos.role}</td>
                      <td className="tl max-w-[320px] text-[10px] text-[var(--ink-3)]">
                        {pos.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          {!row && inAi.length === 0 && (
            <Panel title="Portfolio Context">
              <Empty>
                {symbol} is not held in the real book or any saved AI portfolio — every tab on this
                page works anyway; holding a name is never required to research it.
              </Empty>
            </Panel>
          )}
        </>
      )}

      {/* ======================================================== TECHNICAL */}
      {tab === "TECHNICAL" && (
        <>
          {techDecision ? (
            <TechnicalTab decision={techDecision} candles={candles} />
          ) : (
            <Panel title="Technical Decision">
              <Empty>Not enough price history for the V3 engine (60+ daily bars needed).</Empty>
            </Panel>
          )}

          {tech && (
            <Panel
              title="Classic Technical State"
              subtitle="rule-based read of trend and momentum — not a prediction"
              actions={
                <Tone
                  tone={
                    tech.state === "BULLISH" ? "pos" : tech.state === "BEARISH" ? "neg" : "neutral"
                  }
                >
                  {tech.state}
                </Tone>
              }
              bodyClassName="p-0"
            >
              <table className="grid-table">
                <thead>
                  <tr>
                    <th className="tl">Signal</th>
                    <th className="tl">Reading</th>
                    <th className="tl">Vote</th>
                  </tr>
                </thead>
                <tbody>
                  {tech.signals.map((s) => (
                    <tr key={s.label}>
                      <td className="tl">{s.label}</td>
                      <td className="tl tabular-nums">{s.value}</td>
                      <td className="tl">
                        <Tone tone={s.vote > 0 ? "pos" : s.vote < 0 ? "neg" : "neutral"}>
                          {s.vote > 0 ? "+1" : s.vote < 0 ? "−1" : "0"}
                        </Tone>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
                Net score {tech.score >= 0 ? "+" : ""}
                {tech.score}. Two net votes flip the classification.
              </div>
            </Panel>
          )}

          <RelativeStrengthPanel symbol={symbol} />
        </>
      )}

      {/* ======================================================== VALUATION */}
      {tab === "VALUATION" && (
        <>
          {eg ? (
            <ValuationTab eg={eg} />
          ) : (
            <Panel title="Valuation">
              <Empty>EG valuation models run on EODHD symbols only.</Empty>
            </Panel>
          )}
          <Section
            title="OPPORTUNITY / PEER POSITION"
            subtitle="sector-relative score, percentiles and model fair value"
            defaultOpen
          >
            <PeerPanel symbol={symbol} />
          </Section>
        </>
      )}

      {/* ======================================================= FINANCIALS */}
      {tab === "FINANCIALS" && (
        <>
          {eg && <FinancialsV2 view={eg.financialsView} />}

          <Section
            title="STATEMENTS & RATIOS"
            subtitle="overview, statements and ratios"
            defaultOpen={!eg}
            badge={
              <ConfidenceBadge
                report={PANEL_CONFIDENCE.financials(statementAsOf, periods.length, 8)}
                source={
                  useEodhd
                    ? "EODHD"
                    : altStatements
                      ? altStatements.source
                      : (bsFill?.filled ?? 0) + (annualFill?.filled ?? 0) > 0
                        ? "SEC filings + Financial Modeling Prep"
                        : "SEC filings"
                }
              />
            }
          >
            <FinancialsTabs
              overviewSections={overviewSections}
              quarterly={periods}
              annual={annualPeriods}
              sym={moneySym}
            />
            {verifiable.length > 0 && (
              <ThirdSource
                symbol={symbol}
                exchange={universeRow?.exchange ?? "NASDAQ"}
                readings={verifiable}
              />
            )}
          </Section>

          <Section
            title="FINANCIAL HEALTH"
            subtitle="quality pillars with the reported figures behind them"
            badge={
              <span className="text-[10px] text-[var(--ink-3)]">
                {health.total === null ? "N/A" : `${health.total}/100`}
              </span>
            }
          >
            <HealthPanel health={health} />
          </Section>

          <Section
            title="EARNINGS QUALITY"
            subtitle="reported profit against the cash actually generated"
            badge={<Chip tone={quality.verdict === "HIGH QUALITY" ? "pos" : quality.verdict === "WATCH" ? "warn" : "neutral"}>{quality.verdict}</Chip>}
          >
            <EarningsQualityPanel q={quality} sym={moneySym} />
          </Section>

          <Section
            title="CAPITAL ALLOCATION"
            subtitle="where management is putting the cash"
            badge={
              <Chip tone={capital.shareVerdict === "NET BUYBACK" ? "pos" : capital.shareVerdict === "DILUTION" ? "neg" : "neutral"}>
                {capital.shareVerdict}
              </Chip>
            }
          >
            <CapitalPanel data={capital} sym={moneySym} />
          </Section>
        </>
      )}

      {/* ========================================================= ANALYSTS */}
      {tab === "ANALYSTS" && (
        <>
          <Section
            title="ANALYSTS"
            subtitle="consensus and how it has shifted"
            defaultOpen
            badge={<Chip tone={analystReport.momentum === "IMPROVING" ? "pos" : analystReport.momentum === "DETERIORATING" ? "neg" : "neutral"}>{analystReport.label}</Chip>}
          >
            <AnalystPanel report={analystReport} price={last} />
          </Section>

          {eg && (() => {
            const sv = buildStreetView(eg.snapshot, eg.news, eg.expectations, eg.price);
            return (
              <Panel title="Why the Street Is Positioned This Way" subtitle="consensus motive reconstructed from filings + the actual analyst headlines — every driver cites its number" bodyClassName="p-0">
                <div className="border-b border-[var(--line)] px-3 py-2 text-[11.5px] leading-snug">{sv.stance}</div>
                <div className="grid grid-cols-1 divide-y divide-[var(--line)] sm:grid-cols-2 sm:divide-y-0 sm:divide-x">
                  <div className="p-3">
                    <div className="text-[9px] uppercase tracking-wider text-emerald-400">What the Buys lean on</div>
                    {sv.bullDrivers.length ? (
                      <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-snug">{sv.bullDrivers.map((b) => <li key={b}>{b}</li>)}</ul>
                    ) : (
                      <div className="mt-1 text-[10.5px] text-[var(--ink-3)]">No fundamental driver cleared the bar.</div>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="text-[9px] uppercase tracking-wider text-rose-400">What the Holds/Sells point at</div>
                    {sv.bearDrivers.length ? (
                      <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-snug">{sv.bearDrivers.map((b) => <li key={b}>{b}</li>)}</ul>
                    ) : (
                      <div className="mt-1 text-[10.5px] text-[var(--ink-3)]">No standing objection in the data.</div>
                    )}
                  </div>
                </div>
                {sv.targetMath && (
                  <div className="border-t border-[var(--line)] px-3 py-1.5 text-[10.5px] text-[var(--ink-2)]">{sv.targetMath}</div>
                )}
                {sv.actions.length > 0 && (
                  <div className="border-t border-[var(--line)] p-3">
                    <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">Latest analyst actions (as reported)</div>
                    <ul className="mt-1 space-y-1 text-[10.5px]">
                      {sv.actions.map((a) => (
                        <li key={a.url}>
                          <span className={a.sentiment === "POSITIVE" ? "text-emerald-400" : a.sentiment === "NEGATIVE" ? "text-rose-400" : "text-[var(--ink-3)]"}>●</span>{" "}
                          <a href={a.url} target="_blank" rel="noreferrer" className="hover:underline">{a.title}</a>
                          <span className="ml-1 text-[9px] text-[var(--ink-3)]">({a.date})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Panel>
            );
          })()}

          {eg && (
            <Panel title="Street vs EG" subtitle="consensus target against the model fan" bodyClassName="p-0">
              <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-4">
                <Kpi label="Street target" value={eg.expectations.consensus.target !== null ? `$${eg.expectations.consensus.target.toFixed(2)}` : "N/A"} />
                <Kpi label="EG fair value" value={eg.decision.fairValue !== null ? `$${eg.decision.fairValue.toFixed(2)}` : "N/A"} />
                <Kpi
                  label="Revision score"
                  value={eg.expectations.revisionScore !== null ? `${eg.expectations.revisionScore}/100` : "N/A"}
                  tone={(eg.expectations.revisionScore ?? 50) >= 50 ? "pos" : "neg"}
                />
                <Kpi
                  label="Expectation gap"
                  value={eg.expectations.expectationGapPct !== null ? `${eg.expectations.expectationGapPct > 0 ? "+" : ""}${eg.expectations.expectationGapPct.toFixed(1)}%` : "N/A"}
                  sub={eg.expectations.gapReading ?? undefined}
                />
              </div>
              {eg.expectations.revisionParts.length > 0 && (
                <div className="border-t border-[var(--line)] px-3 py-1.5 text-[10px] text-[var(--ink-3)]">
                  {eg.expectations.revisionParts.join(" · ")}
                </div>
              )}
            </Panel>
          )}

          {bist && (
            <Section
              title="GUIDANCE"
              subtitle="management's own forecasts"
              badge={<Chip tone="neutral">{guidanceReport.trend}</Chip>}
            >
              <GuidancePanel report={guidanceReport} />
            </Section>
          )}
        </>
      )}

      {/* ============================================================= NEWS */}
      {tab === "NEWS" &&
        (!bist ? (
          <NewsTab news={news} symbol={symbol} />
        ) : (
          <Panel title="News">
            <Empty>Company-specific news via EODHD covers US listings; BIST names have no news feed on this plan.</Empty>
          </Panel>
        ))}

      {/* ======================================================== OWNERSHIP */}
      {tab === "OWNERSHIP" && (
        <>
          <Section
            title="OWNERSHIP"
            subtitle="institutions, funds and insiders — delayed filing data"
            defaultOpen
          >
            <OwnershipPanel
              ownership={
                ownership ?? {
                  holders: [],
                  breakdown: { institutional: null, etf: null, insider: null },
                  reportingPeriod: null,
                  latestFiling: null,
                  available: false,
                  note: "Ownership data could not be loaded.",
                }
              }
              insiders={insiderReport}
              etfs={etfLookup}
            />
          </Section>

          <Section
            title="INSIDERS"
            subtitle="open-market decisions separated from mechanical filings"
            defaultOpen
            badge={
              <span className="flex items-center gap-2">
                <ConfidenceBadge
                  report={PANEL_CONFIDENCE.insiders(insiderReport?.rows[0]?.filingDate ?? null)}
                  source="SEC Form 4"
                />
                <InsiderSignalChip report={insiderReport} />
              </span>
            }
          >
            <InsiderPanel report={insiderReport} />
          </Section>

          {holdings && (holdings.available || holdingsSummary?.holdingsCount !== null) && (
            <Section
              title="ETF HOLDINGS"
              subtitle="what this fund actually owns"
              badge={
                <span className="text-[10px] text-[var(--ink-3)]">
                  {holdingsSummary?.holdingsCount ?? "N/A"} holdings
                </span>
              }
            >
              <HoldingsPanel data={holdings} />
            </Section>
          )}
        </>
      )}

      {/* ========================================================= EARNINGS */}
      {tab === "EARNINGS" && (
        <>
          {eg ? (
            <EarningsTab eg={eg} />
          ) : (
            <Panel title="Earnings">
              <Empty>The earnings desk runs on EODHD symbols; the trend below uses filed statements.</Empty>
            </Panel>
          )}
          <Section
            title="EARNINGS TREND"
            subtitle="up to eight reported quarters, de-cumulated from the filings"
            defaultOpen={!eg}
          >
            <TrendPanel trend={trends} freq="QUARTERLY" sym={moneySym} />
          </Section>
        </>
      )}

      {/* ========================================================= RESEARCH */}
      {tab === "RESEARCH" && (
        <>
          {eg?.snapshot.identity.description && (
            <Panel title="Business" subtitle={`${eg.snapshot.identity.sector ?? ""} · ${eg.snapshot.identity.industry ?? ""} · ${eg.snapshot.identity.country ?? ""}${eg.snapshot.identity.employees ? ` · ${eg.snapshot.identity.employees.toLocaleString()} employees` : ""}`}>
              <p className="max-w-[100ch] text-[11.5px] leading-relaxed text-[var(--ink-2)]">
                {eg.snapshot.identity.description}
              </p>
            </Panel>
          )}

          <Section
            title="ALTERNATIVE DATA"
            subtitle="federal awards and the experimental activity nowcast"
            defaultOpen
            badge={
              <Chip tone={activityNowcast.verdict === "N/A" ? "neutral" : "warn"}>
                {activityNowcast.verdict}
              </Chip>
            }
          >
            <AltDataPanel
              hiring={hiring}
              contracts={contracts}
              nowcast={activityNowcast}
              revenueTtm={ttmRevenue}
            />
          </Section>

          <Section
            title="AI EXECUTIVE BRIEF"
            subtitle="click to generate — the only model call on this page"
          >
            <ExecutiveBrief symbol={symbol} />
          </Section>
        </>
      )}
    </div>
  );
}
