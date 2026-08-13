import "server-only";
import "@/lib/providers/register";
import { cache } from "react";
import type { Portfolio } from "@/lib/types";
import { loadPortfolioForCaller } from "./user-portfolio";
import { buildMarketBundle } from "@/lib/portfolio/market";
import {
  buildPortfolioSeries,
  buildUsdSeries,
  computeRisk,
  portfolioTotals,
  valuePositions,
  type MarketBundle,
  type Point,
  type RiskReport,
} from "@/lib/portfolio/analytics";
import { DEFAULT_SETTINGS, type AppSettings } from "@/lib/portfolio/settings";
import { getSettings } from "./settings-store";
import type { PortfolioTotals } from "@/lib/portfolio/analytics";
import type { PositionValuation } from "@/lib/types";

export interface DashboardContext {
  portfolio: Portfolio;
  settings: AppSettings;
  bundle: MarketBundle;
  usdSeries: { code: string; points: Point[] }[];
  rows: PositionValuation[];
  totals: PortfolioTotals;
  series: Point[];
  risk: RiskReport;
  error: string | null;
}

/**
 * Assembles everything a page needs. `cache()` dedupes this across all server
 * components rendered for the same request.
 */
export const getContext = cache(
  async (opts: { markets?: boolean } = {}): Promise<DashboardContext> => {
    const settings = await getSettings();
    let portfolio: Portfolio;
    try {
      portfolio = await loadPortfolioForCaller();
    } catch (e) {
      return {
        portfolio: {
          meta: {
            title: "No portfolio loaded",
            baseCurrency: "USD",
            totalAmount: 0,
            sourceFile: "—",
            parsedAt: new Date().toISOString(),
            summary: {},
            warnings: [],
          },
          positions: [],
        },
        settings,
        bundle: {
          quotes: {},
          histories: {},
          status: "UNAVAILABLE",
          usdTryRate: 0,
          usdTryChangePct: 0,
        },
        usdSeries: [],
        rows: [],
        totals: emptyTotals(),
        series: [],
        risk: emptyRisk(),
        error: e instanceof Error ? e.message : "Failed to load portfolio",
      };
    }

    const bundle = await buildMarketBundle(portfolio, settings, {
      includeMarketMonitor: opts.markets ?? true,
      history: true,
    });
    const usdSeries = buildUsdSeries(portfolio, bundle, settings);
    const rows = valuePositions(portfolio, bundle, settings, usdSeries);
    const series = buildPortfolioSeries(rows, usdSeries);
    const totals = portfolioTotals(rows, bundle, series);

    const benchSymbol = settings.benchmark === "XU100" ? "XU100" : "SPX";
    const risk = computeRisk(rows, usdSeries, bundle.histories[benchSymbol], settings);

    return { portfolio, settings, bundle, usdSeries, rows, totals, series, risk, error: null };
  },
);

function emptyTotals(): PortfolioTotals {
  return {
    value: 0,
    costBasis: 0,
    dailyPnl: 0,
    dailyPct: 0,
    totalPnl: 0,
    totalPct: 0,
    ytdPct: 0,
    tryValue: 0,
    ytdPctTry: 0,
    cashPct: 0,
    equityPct: 0,
    commodityPct: 0,
    turkeyPct: 0,
    usdExposurePct: 0,
    tryExposurePct: 0,
  };
}

function emptyRisk(): RiskReport {
  return {
    codes: [],
    corr: [],
    annualVolatility: 0,
    weightedAvgVolatility: 0,
    diversificationBenefit: 0,
    expectedReturn: 0,
    sharpe: 0,
    maxDrawdown: 0,
    beta: null,
    var95: 0,
    var99: 0,
    expectedShortfall95: 0,
    riskContributions: [],
    observations: 0,
    method: "model",
    realisedAnnualReturn: 0,
  };
}

export { DEFAULT_SETTINGS };
