import "@/lib/providers/register";
import Link from "next/link";
import { Chip, Empty, Kpi, Note, Panel } from "@/components/shell/ui";
import { TickerChart } from "@/components/charts/ticker-chart";
import { QuoteLine } from "@/components/shell/quote-line";
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
import { Fundamentals } from "@/components/ticker/fundamentals";
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
import { AltDataPanel } from "@/components/research/alt-data-panel";
import { PeerPanel } from "@/components/research/peer-panel";
import { currencySymbol } from "@/lib/format-currency";
import { ConfidenceBadge } from "@/components/research/confidence-badge";
import { PANEL_CONFIDENCE } from "@/lib/research/confidence";
import { getContracts, getHiring } from "@/lib/research/alt-data";
import { nowcast as runNowcast } from "@/lib/research/alt-data";
import { getYahooStatements } from "@/lib/providers/yahoo-fundamentals";
import {
  getAnnualFinancials,
  getEarnings,
  getFinancials,
  getInsiders,
  getMetrics,
  getRecommendations,
} from "@/lib/providers/fundamentals";
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
 * Ticker detail — works for any symbol, held or not.
 *
 * Prices and history come from the same provider chain the rest of the app
 * uses, so a ticker added by hand to a saved AI portfolio charts exactly like
 * a workbook holding. Nothing here calls a model.
 */
export default async function TickerPage(props: PageProps<"/ticker/[symbol]">) {
  const { symbol: raw } = await props.params;
  const symbol = decodeURIComponent(raw).toUpperCase();

  /**
   * A deadline per source, so one slow provider cannot hold the page.
   *
   * Measured: most cold ticker pages land in three to four seconds, but a
   * provider that times out and retries took one to twenty-six. A panel whose
   * source did not answer in time reads N/A — which is what it already reads
   * when a source has no data — rather than making everything else wait for it.
   *
   * The price and the filings get longer, because a page without them is not
   * worth rendering. Everything else is a side panel.
   */
  const within = <T,>(ms: number, p: Promise<T>, fallback: T): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);

  const CORE_MS = 12_000;
  const PANEL_MS = 5_000;

  /**
   * One wave, not five.
   *
   * These sources are independent of each other, and awaiting them in groups
   * meant the page took the sum of the slowest in each group rather than the
   * slowest overall — measured at 2.2s to 7.4s on a warm cache. Only the
   * Yahoo statement fallback genuinely depends on an earlier result, so it is
   * the one thing left in a second wave.
   *
   * `getContext()` is deliberately absent. It builds the whole portfolio
   * market bundle — quotes and history for every position, plus the risk
   * report — and this page used it to answer one question: do I hold this?
   * That question is answered below from the holdings list alone, and the
   * bundle is only built when the answer is yes.
   */
  const [
    quotes,
    history,
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
    getHistoricalPrices(symbol, 1300),
    within(PANEL_MS, listPortfolios().catch(() => []), []),
    within(PANEL_MS, peekPortfolioForCaller().catch(() => null), null),
    // Fundamentals are cached for a day in the provider layer, so this costs
    // nothing on a repeat view and never rides the quote clock.
    within(CORE_MS, getMetrics(symbol).catch(() => null), null),
    within(CORE_MS, getFinancials(symbol).catch(() => null), null),
    within(CORE_MS, getAnnualFinancials(symbol).catch(() => null), null),
    within(PANEL_MS, getRecommendations(symbol).catch(() => null), null),
    within(PANEL_MS, getEarnings(symbol).catch(() => null), null),
    within(PANEL_MS, getInsiders(symbol).catch(() => null), null),
    within(PANEL_MS, getGuidance(symbol).catch(() => null), null),
    within(PANEL_MS, getOwnership(symbol).catch(() => null), null),
    // The reverse lookup only scans funds we would have holdings for; with no
    // source registered it short-circuits and the panel says N/A.
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

  // Symbols the SEC feed does not cover — BIST above all — get their filed
  // statements from Yahoo instead. Those quarters are already discrete, so the
  // de-cumulation the SEC path needs is deliberately not applied.
  const altStatements = financials?.length
    ? null
    : await within(PANEL_MS, getYahooStatements(symbol).catch(() => null), null);

  /**
   * The valuation panel needs the full context, so build it — but only for a
   * symbol actually in the book. For every other ticker that work produced a
   * `find` that returned undefined.
   */
  const isHeld = (heldPortfolio?.positions ?? []).some(
    (p) =>
      p.code.toUpperCase() === symbol || (p.symbol ?? "").toUpperCase() === symbol,
  );
  const ctx = isHeld ? await getContext({ markets: false }).catch(() => null) : null;

  const quote = quotes[symbol] ?? null;
  const candles = history.candles;
  const last = candles.at(-1)?.close ?? quote?.price ?? null;

  // 52-week extremes from the daily series — the quote endpoints do not carry
  // them consistently across providers, and the candles already do.
  const yearCandles = candles.slice(-253);
  const high52 = yearCandles.length ? Math.max(...yearCandles.map((c) => c.high || c.close)) : null;
  const low52 = yearCandles.length ? Math.min(...yearCandles.map((c) => c.low || c.close)) : null;

  const tech = technicalState(candles, last);

  // ------------------------------------------------------------- research
  // All of this is arithmetic over cached provider data. No model is called
  // anywhere on this page.
  const periods = ordered(altStatements?.quarterly ?? financials ?? [], 8);
  const annualPeriods = ordered(altStatements?.annual ?? annualFinancials ?? [], 8);
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

  /**
   * The rows worth a third opinion.
   *
   * Only the ratios that already have two derivations and can be answered by
   * Google's financials. Anything else would spend a credit for a column the
   * third source cannot fill.
   */
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
          // A confirmed row reports one number both sources reached; a
          // disputed one carries both in its note.
          filed: m ? Number(m[1]) : i.value,
          reported: m ? Number(m[2]) : i.value,
          from,
          unit: (i.format === "x" ? "x" : "pct") as "pct" | "x",
        },
      ];
    });
  const keyMetrics = buildKeyMetrics({ metrics, periods, price: last, analysts: analystReport, symbol });

  // Valuation verdict for Smart Money: the median of the rows that have data,
  // so one missing multiple cannot swing the label.
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
  const delayed = isBistSymbol(symbol);

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
  // Statements are filed in the issuer's own currency; the panels must not
  // stamp a dollar sign on a Turkish filer's lira.
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

  // Held in the real book?
  const row = ctx?.rows.find(
    (r) =>
      r.position.code.toUpperCase() === symbol ||
      (r.position.symbol ?? "").toUpperCase() === symbol,
  );

  // Held in any saved AI portfolio?
  const inAi = saved
    .map((p) => {
      const alloc = currentAllocation(p);
      const pos = alloc.positions.find((x) => x.ticker.toUpperCase() === symbol);
      return pos ? { portfolio: p, pos } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/positions" className="text-[11px] text-[var(--ink-3)] hover:text-[var(--amber)]">
          ← Positions
        </Link>
        <h1 className="text-[16px] font-semibold">{symbol}</h1>
        {delayed && (
          <Chip tone="warn" title="Borsa İstanbul prices reach this app through Yahoo and are delayed, not realtime.">
            BIST · DELAYED
          </Chip>
        )}
        <div className="ml-auto">
          <QuoteLine quote={quote} decimals={last && last > 500 ? 2 : 4} currency="" />
        </div>
      </div>

      {!quote && (
        <Note tone="warn">
          <span>
            <strong>DATA UNAVAILABLE.</strong> No configured provider returned a real quote for{" "}
            {symbol}.
          </span>
        </Note>
      )}

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

      <Panel title="Price History" bodyClassName="p-0">
        <TickerChart symbol={symbol} />
      </Panel>

      {tech && (
        <Panel
          title="Technical State"
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

      <Panel
        title="Catalyst Timeline"
        subtitle="company events plus the macro releases that move this sleeve"
        bodyClassName="p-0"
      >
        {catalysts.length === 0 ? (
          <Empty>
            No dated catalyst available for {symbol}. Dividends and investor days are N/A on
            the configured data plan.
          </Empty>
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

      {/* ----------------------------------------------------------- research */}
      <Panel
        title="Key Company Metrics"
        subtitle="the ten-second read — arrows use metric-specific rules, not the sign of the number"
        bodyClassName="p-0"
      >
        <KeyMetricsPanel items={keyMetrics} />
      </Panel>

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
        title="EARNINGS TREND"
        subtitle="up to eight reported quarters, de-cumulated from the filings"
      >
        <TrendPanel trend={trends} freq="QUARTERLY" sym={moneySym} />
      </Section>

      <Section
        title="FINANCIALS"
        subtitle="overview, statements and ratios"
        badge={
          <ConfidenceBadge
            report={PANEL_CONFIDENCE.financials(statementAsOf, periods.length, 8)}
            source={altStatements ? altStatements.source : "SEC filings"}
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
            // Google keys quotes by venue. The listing knows which one, and
            // NASDAQ is the fallback rather than a guess dressed as fact —
            // a wrong venue returns no financials rather than another
            // company's.
            exchange={universeRow?.exchange ?? "NASDAQ"}
            readings={verifiable}
          />
        )}
      </Section>

      <Section
        title="EARNINGS QUALITY"
        subtitle="reported profit against the cash actually generated"
        badge={<Chip tone={quality.verdict === "HIGH QUALITY" ? "pos" : quality.verdict === "WATCH" ? "warn" : "neutral"}>{quality.verdict}</Chip>}
      >
        <EarningsQualityPanel q={quality} sym={moneySym} />
      </Section>

      <Section
        title="ANALYSTS"
        subtitle="consensus and how it has shifted"
        badge={<Chip tone={analystReport.momentum === "IMPROVING" ? "pos" : analystReport.momentum === "DETERIORATING" ? "neg" : "neutral"}>{analystReport.label}</Chip>}
      >
        <AnalystPanel report={analystReport} price={last} />
      </Section>

      <Section
        title="INSIDERS"
        subtitle="open-market decisions separated from mechanical filings"
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

      <Section
        title="GUIDANCE"
        subtitle="management's own forecasts"
        badge={<Chip tone="neutral">{guidanceReport.trend}</Chip>}
      >
        <GuidancePanel report={guidanceReport} />
      </Section>

      <Section
        title="OWNERSHIP"
        subtitle="institutions, funds and insiders — delayed filing data"
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

      <Section
        title="ALTERNATIVE DATA"
        subtitle="federal awards and the experimental activity nowcast"
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

      <Section title="VALUATION & EARNINGS SURPRISES" subtitle="multiples and reported beats or misses">
        <Fundamentals
          symbol={symbol}
          metrics={metrics}
          financials={financials}
          recommendations={recommendations}
          earnings={earnings}
          insiders={insiders}
          lastPrice={last}
        />
      </Section>

      {/* -------------------------------------------------- portfolio context */}
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
          <Empty>{symbol} is not held in the real book or any saved AI portfolio.</Empty>
        </Panel>
      )}
    </div>
  );
}
