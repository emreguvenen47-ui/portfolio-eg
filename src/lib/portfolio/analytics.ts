import type {
  Candle,
  DataStatus,
  Portfolio,
  Position,
  PositionValuation,
  Quote,
  RegimeAssessment,
  RegimeSignal,
  RiskMetrics,
  StressResult,
  StressScenario,
} from "@/lib/types";
import type { AppSettings } from "./settings";
import { RISK_FREE_RATE, TRADING_DAYS } from "./config";
import {
  alignSeries,
  annualiseReturn,
  annualiseVol,
  beta as olsBeta,
  correlationMatrix,
  covarianceMatrix,
  cumulative,
  expectedShortfall,
  historicalVaR,
  maxDrawdown,
  portfolioReturns,
  portfolioVolatility,
  riskContributions,
  sharpe as sharpeOf,
  sma,
  stdev,
  toReturns,
  weightedAverageVolatility,
} from "@/lib/finance/stats";

export type Point = { date: string; close: number };

export interface MarketBundle {
  quotes: Record<string, Quote>;
  histories: Record<string, Candle[]>;
  status: DataStatus;
  usdTryRate: number;
  usdTryChangePct: number;
}

// ---------------------------------------------------------------- USD series

/**
 * Builds one USD-denominated index series per position.
 *
 * Currency handling is explicit rather than assumed:
 *  - US-listed ETFs are already USD.
 *  - BIST tracks XU100, which is quoted in TRY, so it is divided by USD/TRY.
 *  - PPF has no quote at all: it accrues at the TL yield and is then divided
 *    by USD/TRY, which is exactly why it carries FX risk in USD terms.
 */
export function buildUsdSeries(
  portfolio: Portfolio,
  bundle: MarketBundle,
  settings: AppSettings,
): { code: string; points: Point[] }[] {
  const fx = bundle.histories["USD/TRY"] ?? [];
  const fxByDate = new Map(fx.map((c) => [c.date, c.close]));
  const fxDates = fx.map((c) => c.date);

  return portfolio.positions.map((pos) => {
    if (pos.kind === "cash_fund") {
      // TL accrual index, then translated to USD.
      const daily = (1 + settings.ppfTlYield) ** (1 / TRADING_DAYS) - 1;
      const points: Point[] = [];
      let tl = 1;
      for (const d of fxDates) {
        const rate = fxByDate.get(d);
        if (!rate) continue;
        points.push({ date: d, close: tl / rate });
        tl *= 1 + daily;
      }
      return { code: pos.code, points };
    }

    const candles = pos.symbol ? (bundle.histories[pos.symbol] ?? []) : [];
    if (candles.length === 0) return { code: pos.code, points: [] };

    const quotedInTry = pos.kind === "index_proxy" && pos.currencyCode === "TRY";
    if (!quotedInTry) {
      return { code: pos.code, points: candles.map((c) => ({ date: c.date, close: c.close })) };
    }
    const points: Point[] = [];
    for (const c of candles) {
      const rate = fxByDate.get(c.date);
      if (rate) points.push({ date: c.date, close: c.close / rate });
    }
    return { code: pos.code, points };
  });
}

const findAtOrAfter = (points: Point[], date: string): Point | null =>
  points.find((p) => p.date >= date) ?? null;

const pctBetween = (from: number | undefined, to: number | undefined): number | null =>
  from && to && from > 0 ? to / from - 1 : null;

// ---------------------------------------------------------------- valuation

export function valuePositions(
  portfolio: Portfolio,
  bundle: MarketBundle,
  settings: AppSettings,
  usdSeries: { code: string; points: Point[] }[],
): PositionValuation[] {
  const byCode = new Map(usdSeries.map((s) => [s.code, s.points]));
  const ytdStart = `${new Date().getUTCFullYear()}-01-01`;
  const totalCost = portfolio.positions.reduce((s, p) => s + p.amount, 0);

  const rows = portfolio.positions.map((pos) => {
    const points = byCode.get(pos.code) ?? [];
    const last = points.at(-1);
    const prev = points.at(-2);
    const inception = findAtOrAfter(points, settings.inceptionDate) ?? points[0];
    const ytdRef = findAtOrAfter(points, ytdStart) ?? inception;

    const costBasis = pos.amount;
    const growth = inception && last && inception.close > 0 ? last.close / inception.close : 1;
    const value = costBasis * growth;
    const dailyPct = prev && last && prev.close > 0 ? last.close / prev.close - 1 : 0;

    return {
      position: pos,
      quote: pos.symbol ? (bundle.quotes[pos.symbol] ?? null) : null,
      value,
      costBasis,
      unrealizedPnl: value - costBasis,
      unrealizedPnlPct: costBasis > 0 ? value / costBasis - 1 : 0,
      dailyPnl: value * dailyPct,
      dailyPct,
      ytdPct: pctBetween(ytdRef?.close, last?.close),
      currentWeight: 0,
      targetWeight: pos.targetWeight,
      drift: 0,
      contributionToReturn: totalCost > 0 ? (value - costBasis) / totalCost : 0,
    } satisfies PositionValuation;
  });

  const total = rows.reduce((s, r) => s + r.value, 0);
  for (const r of rows) {
    r.currentWeight = total > 0 ? r.value / total : 0;
    r.drift = r.currentWeight - r.targetWeight;
  }
  return rows;
}

export interface PortfolioTotals {
  value: number;
  costBasis: number;
  dailyPnl: number;
  dailyPct: number;
  totalPnl: number;
  totalPct: number;
  ytdPct: number;
  tryValue: number;
  ytdPctTry: number;
  cashPct: number;
  equityPct: number;
  commodityPct: number;
  turkeyPct: number;
  usdExposurePct: number;
  tryExposurePct: number;
}

export function portfolioTotals(
  rows: PositionValuation[],
  bundle: MarketBundle,
  portfolioSeries: Point[],
): PortfolioTotals {
  const value = rows.reduce((s, r) => s + r.value, 0);
  const costBasis = rows.reduce((s, r) => s + r.costBasis, 0);
  const dailyPnl = rows.reduce((s, r) => s + r.dailyPnl, 0);

  const ytdStart = `${new Date().getUTCFullYear()}-01-01`;
  const ytdRef = findAtOrAfter(portfolioSeries, ytdStart) ?? portfolioSeries[0];
  const last = portfolioSeries.at(-1);
  const ytdPct = pctBetween(ytdRef?.close, last?.close) ?? 0;

  const shareOf = (pred: (p: Position) => boolean) =>
    value > 0 ? rows.filter((r) => pred(r.position)).reduce((s, r) => s + r.value, 0) / value : 0;

  // A USD-basis return, re-expressed in TRY: (1+r_usd)(1+Δusdtry)-1
  const fxYtd = (() => {
    const fx = bundle.histories["USD/TRY"] ?? [];
    const ref = fx.find((c) => c.date >= ytdStart);
    const now = fx.at(-1);
    return ref && now && ref.close > 0 ? now.close / ref.close - 1 : 0;
  })();

  return {
    value,
    costBasis,
    dailyPnl,
    dailyPct: value - dailyPnl > 0 ? dailyPnl / (value - dailyPnl) : 0,
    totalPnl: value - costBasis,
    totalPct: costBasis > 0 ? value / costBasis - 1 : 0,
    ytdPct,
    tryValue: value * bundle.usdTryRate,
    ytdPctTry: (1 + ytdPct) * (1 + fxYtd) - 1,
    cashPct: shareOf((p) => p.assetClass === "Cash" || p.assetClass === "Unallocated"),
    equityPct: shareOf((p) => p.assetClass === "Equity"),
    commodityPct: shareOf((p) => p.assetClass === "Commodity"),
    turkeyPct: shareOf((p) => p.region === "Turkey"),
    usdExposurePct: shareOf((p) => p.currencyCode === "USD"),
    tryExposurePct: shareOf((p) => p.currencyCode === "TRY"),
  };
}

/** Weighted portfolio index, rebased to 100 at the first common date. */
export function buildPortfolioSeries(
  rows: PositionValuation[],
  usdSeries: { code: string; points: Point[] }[],
): Point[] {
  const weightByCode = new Map(rows.map((r) => [r.position.code, r.targetWeight]));
  const aligned = alignSeries(usdSeries.map((s) => ({ key: s.code, points: s.points })));
  if (aligned.dates.length < 2) return [];

  const weights = aligned.keys.map((k) => weightByCode.get(k) ?? 0);
  const wSum = weights.reduce((a, b) => a + b, 0) || 1;
  const norm = weights.map((w) => w / wSum);

  const returns = aligned.prices.map((p) => toReturns(p));
  const pr = portfolioReturns(norm, returns);
  const levels = cumulative(pr);
  // `returns` drops the first observation, so dates are offset by one.
  return levels.map((lvl, i) => ({ date: aligned.dates[i + 1], close: lvl * 100 }));
}

// ---------------------------------------------------------------- risk

export type RiskReport = RiskMetrics & {
  codes: string[];
  corr: number[][];
  realisedAnnualReturn: number;
};

export function computeRisk(
  rows: PositionValuation[],
  usdSeries: { code: string; points: Point[] }[],
  benchmarkCandles: Candle[] | undefined,
  settings: AppSettings,
): RiskReport {
  const aligned = alignSeries(usdSeries.map((s) => ({ key: s.code, points: s.points })));
  const weightByCode = new Map(rows.map((r) => [r.position.code, r.currentWeight]));
  const volByCode = new Map(rows.map((r) => [r.position.code, r.position.volatility]));

  if (aligned.dates.length < 40) {
    // Not enough history: fall back to the workbook's own vol assumptions.
    const codes = rows.map((r) => r.position.code);
    const w = rows.map((r) => r.currentWeight);
    const vols = rows.map((r) => r.position.volatility);
    const naive = weightedAverageVolatility(w, vols);
    return {
      codes,
      corr: codes.map((_, i) => codes.map((__, j) => (i === j ? 1 : 0))),
      annualVolatility: naive,
      weightedAvgVolatility: naive,
      diversificationBenefit: 0,
      expectedReturn: rows.reduce((s, r) => s + r.currentWeight * r.position.expectedReturn, 0),
      sharpe: 0,
      maxDrawdown: 0,
      beta: null,
      var95: 0,
      var99: 0,
      expectedShortfall95: 0,
      riskContributions: [],
      observations: aligned.dates.length,
      method: "model",
      realisedAnnualReturn: 0,
    };
  }

  const codes = aligned.keys;
  const returns = aligned.prices.map((p) => toReturns(p));
  const rawWeights = codes.map((c) => weightByCode.get(c) ?? 0);
  const wSum = rawWeights.reduce((a, b) => a + b, 0) || 1;
  const w = rawWeights.map((x) => x / wSum);

  const covDaily = covarianceMatrix(returns);
  const covAnnual = covDaily.map((row) => row.map((v) => v * TRADING_DAYS));

  const annualVolatility = portfolioVolatility(w, covAnnual);
  const weightedAvg = weightedAverageVolatility(
    w,
    codes.map((c) => volByCode.get(c) ?? 0),
  );

  const { rc, pctRc } = riskContributions(w, covAnnual);
  const pr = portfolioReturns(w, returns);
  const levels = cumulative(pr);

  const expectedReturn = rows.reduce(
    (s, r) => s + r.currentWeight * r.position.expectedReturn,
    0,
  );
  const realisedAnnual = annualiseReturn(pr.reduce((a, b) => a + b, 0) / pr.length);

  let benchBeta: number | null = null;
  if (benchmarkCandles && benchmarkCandles.length > 40) {
    const bByDate = new Map(benchmarkCandles.map((c) => [c.date, c.close]));
    const bPrices = aligned.dates.map((d) => bByDate.get(d)).filter((x): x is number => !!x);
    if (bPrices.length > 40) {
      const bRet = toReturns(bPrices);
      const n = Math.min(bRet.length, pr.length);
      benchBeta = olsBeta(pr.slice(pr.length - n), bRet.slice(bRet.length - n));
    }
  }

  return {
    codes,
    corr: correlationMatrix(returns),
    annualVolatility,
    weightedAvgVolatility: weightedAvg,
    diversificationBenefit: weightedAvg - annualVolatility,
    expectedReturn,
    sharpe: sharpeOf(expectedReturn, annualVolatility, settings.riskFreeRate ?? RISK_FREE_RATE),
    maxDrawdown: maxDrawdown(levels),
    beta: benchBeta,
    var95: historicalVaR(pr, 0.95),
    var99: historicalVaR(pr, 0.99),
    expectedShortfall95: expectedShortfall(pr, 0.95),
    riskContributions: codes.map((c, i) => ({
      code: c,
      weight: w[i],
      rc: rc[i],
      pctRc: pctRc[i],
    })),
    observations: pr.length,
    method: "historical",
    realisedAnnualReturn: Number.isFinite(realisedAnnual) ? realisedAnnual : 0,
  };
}

/** Rolling correlation matrix over a trailing window of trading days. */
export function rollingCorrelations(
  usdSeries: { code: string; points: Point[] }[],
  windowDays: number,
): { codes: string[]; matrix: number[][]; observations: number } {
  const aligned = alignSeries(usdSeries.map((s) => ({ key: s.code, points: s.points })));
  const returns = aligned.prices.map((p) => toReturns(p));
  const n = returns[0]?.length ?? 0;
  const w = Math.min(windowDays, n);
  if (w < 5) return { codes: aligned.keys, matrix: [], observations: 0 };
  const sliced = returns.map((r) => r.slice(r.length - w));
  return { codes: aligned.keys, matrix: correlationMatrix(sliced), observations: w };
}

// ---------------------------------------------------------------- exposures

export interface ExposureSlice {
  label: string;
  value: number;
  weight: number;
}

export function exposureBy(
  rows: PositionValuation[],
  pick: (p: Position) => string | string[],
): ExposureSlice[] {
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  const map = new Map<string, number>();
  for (const r of rows) {
    const keys = pick(r.position);
    const list = Array.isArray(keys) ? keys : [keys];
    if (list.length === 0) continue;
    // Multi-tag dimensions (themes) split the value evenly across tags.
    const share = r.value / list.length;
    for (const k of list) map.set(k, (map.get(k) ?? 0) + share);
  }
  return [...map.entries()]
    .map(([label, value]) => ({ label, value, weight: value / total }))
    .sort((a, b) => b.value - a.value);
}

// ---------------------------------------------------------------- rebalancing

export interface RebalanceRow {
  code: string;
  name: string;
  currentWeight: number;
  targetWeight: number;
  drift: number;
  currentValue: number;
  targetValue: number;
  action: "BUY" | "SELL" | "HOLD";
  amount: number;
  flag: "OVERWEIGHT" | "UNDERWEIGHT" | "IN LINE";
}

export function rebalancePlan(
  rows: PositionValuation[],
  threshold: number,
): { rows: RebalanceRow[]; totalTurnover: number } {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const out = rows.map((r) => {
    const targetValue = total * r.targetWeight;
    const delta = targetValue - r.value;
    const action: RebalanceRow["action"] =
      Math.abs(r.drift) < threshold ? "HOLD" : delta > 0 ? "BUY" : "SELL";
    return {
      code: r.position.code,
      name: r.position.name,
      currentWeight: r.currentWeight,
      targetWeight: r.targetWeight,
      drift: r.drift,
      currentValue: r.value,
      targetValue,
      action,
      amount: Math.abs(delta),
      flag:
        r.drift > threshold ? "OVERWEIGHT" : r.drift < -threshold ? "UNDERWEIGHT" : "IN LINE",
    } satisfies RebalanceRow;
  });
  const totalTurnover = out
    .filter((r) => r.action !== "HOLD")
    .reduce((s, r) => s + r.amount, 0);
  return { rows: out, totalTurnover };
}

// ---------------------------------------------------------------- stress

/**
 * Applies scenario shocks. A shock targets either a position code directly or
 * a factor key (USDTRY, SPX, ...) that maps onto positions.
 *
 * Results are scenario arithmetic, not forecasts.
 */
export function runStress(
  scenario: StressScenario,
  rows: PositionValuation[],
): StressResult {
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  const byCode = new Map(scenario.shocks.map((s) => [s.target.toUpperCase(), s.shockPct]));
  const usdTryShock = byCode.get("USDTRY") ?? 0;

  const byPosition = rows.map((r) => {
    const direct = byCode.get(r.position.code.toUpperCase());
    let pct = direct ?? 0;

    // A USD/TRY shock hits TRY-denominated holdings in USD terms, on top of
    // any direct shock: (1+local)/(1+Δfx) - 1
    if (usdTryShock !== 0 && r.position.currencyCode === "TRY") {
      pct = (1 + pct) / (1 + usdTryShock) - 1;
    }
    return { code: r.position.code, pct, dollar: r.value * pct };
  });

  const dollarPnl = byPosition.reduce((s, p) => s + p.dollar, 0);
  const losses = byPosition.filter((p) => p.dollar < 0).sort((a, b) => a.dollar - b.dollar);
  const gains = byPosition.filter((p) => p.dollar > 0).sort((a, b) => b.dollar - a.dollar);

  return {
    scenarioId: scenario.id,
    portfolioPct: dollarPnl / total,
    dollarPnl,
    byPosition,
    largestLoss: losses[0] ? { code: losses[0].code, dollar: losses[0].dollar } : null,
    largestHedge: gains[0] ? { code: gains[0].code, dollar: gains[0].dollar } : null,
  };
}

// ---------------------------------------------------------------- regime

/** Rule-based RISK ON / NEUTRAL / RISK OFF from VIX, equities, USD and rates. */
export function assessRegime(quotes: Record<string, Quote>): RegimeAssessment {
  const signals: RegimeSignal[] = [];
  const q = (k: string) => quotes[k];

  const vix = q("VIX");
  if (vix) {
    const v = vix.price;
    const vote = v < 18 ? "on" : v > 25 ? "off" : "neutral";
    signals.push({
      key: "VIX",
      label: "Volatility",
      value: v.toFixed(2),
      vote,
      detail:
        vote === "on"
          ? "VIX below 18 — options market is calm"
          : vote === "off"
            ? "VIX above 25 — stress is being priced"
            : "VIX between 18 and 25 — no clear signal",
    });
  }

  const spx = q("SPX");
  if (spx) {
    const vote = spx.changePercent > 0.25 ? "on" : spx.changePercent < -0.75 ? "off" : "neutral";
    signals.push({
      key: "SPX",
      label: "US Equities",
      value: `${spx.changePercent >= 0 ? "+" : ""}${spx.changePercent.toFixed(2)}%`,
      vote,
      detail:
        vote === "on"
          ? "S&P advancing on the day"
          : vote === "off"
            ? "S&P down more than 0.75%"
            : "S&P broadly flat",
    });
  }

  const dxy = q("DXY");
  if (dxy) {
    // A softer dollar is the risk-on read for this portfolio (EM + commodities).
    const vote = dxy.changePercent < -0.2 ? "on" : dxy.changePercent > 0.4 ? "off" : "neutral";
    signals.push({
      key: "DXY",
      label: "Dollar",
      value: `${dxy.changePercent >= 0 ? "+" : ""}${dxy.changePercent.toFixed(2)}%`,
      vote,
      detail:
        vote === "on"
          ? "Dollar softening — supportive for EM and commodities"
          : vote === "off"
            ? "Dollar bid — a headwind for EM and commodities"
            : "Dollar little changed",
    });
  }

  const us10 = q("US10Y");
  if (us10) {
    const bp = us10.change * 100;
    const vote = bp > 8 ? "off" : bp < -8 ? "on" : "neutral";
    signals.push({
      key: "US10Y",
      label: "US 10Y",
      value: `${us10.price.toFixed(2)}% (${bp >= 0 ? "+" : ""}${bp.toFixed(0)}bp)`,
      vote,
      detail:
        vote === "off"
          ? "Yields up sharply — pressure on long-duration equity"
          : vote === "on"
            ? "Yields falling — supportive for duration-sensitive assets"
            : "Yields stable",
    });
  }

  const score = signals.reduce((s, x) => s + (x.vote === "on" ? 1 : x.vote === "off" ? -1 : 0), 0);
  const regime: RegimeAssessment["regime"] =
    score >= 2 ? "RISK ON" : score <= -2 ? "RISK OFF" : "NEUTRAL";
  return { regime, score, signals };
}

// ---------------------------------------------------------------- impacts

export interface PortfolioImpact {
  driver: string;
  direction: "up" | "down" | "flat";
  move: string;
  affected: string[];
  sentiment: "positive" | "negative" | "mixed";
  note: string;
}

/** Maps market moves onto the holdings they plausibly help or hurt. */
export function portfolioImpacts(
  quotes: Record<string, Quote>,
  portfolio: Portfolio,
): PortfolioImpact[] {
  const held = new Set(portfolio.positions.map((p) => p.code.toUpperCase()));
  const only = (codes: string[]) => codes.filter((c) => held.has(c));
  const out: PortfolioImpact[] = [];

  const push = (
    key: string,
    driver: string,
    upCodes: string[],
    downCodes: string[],
    upNote: string,
    downNote: string,
    threshold = 0.15,
  ) => {
    const q = quotes[key];
    if (!q) return;
    const chg = q.changePercent;
    const dir: PortfolioImpact["direction"] =
      chg > threshold ? "up" : chg < -threshold ? "down" : "flat";
    if (dir === "flat") return;
    const affected = only(dir === "up" ? upCodes : downCodes);
    if (affected.length === 0) return;
    out.push({
      driver,
      direction: dir,
      move: `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`,
      affected,
      sentiment: dir === "up" ? "positive" : "negative",
      note: dir === "up" ? upNote : downNote,
    });
  };

  // DXY down -> supportive for EM, China tech and gold.
  const dxy = quotes.DXY;
  if (dxy && Math.abs(dxy.changePercent) > 0.15) {
    const down = dxy.changePercent < 0;
    const affected = only(["EMXC", "KWEB", "GLDM"]);
    if (affected.length) {
      out.push({
        driver: "US Dollar (DXY)",
        direction: down ? "down" : "up",
        move: `${dxy.changePercent >= 0 ? "+" : ""}${dxy.changePercent.toFixed(2)}%`,
        affected,
        sentiment: down ? "positive" : "negative",
        note: down
          ? "A softer dollar is historically supportive for EM equity and gold."
          : "A firmer dollar is a headwind for EM equity and gold.",
      });
    }
  }

  // Rising long yields compress the multiple on long-duration growth.
  const us10 = quotes.US10Y;
  if (us10 && Math.abs(us10.changePercent) > 0.5) {
    const up = us10.changePercent > 0;
    const affected = only(["QQQ", "SMH"]);
    if (affected.length) {
      out.push({
        driver: "US 10Y Yield",
        direction: up ? "up" : "down",
        move: `${us10.changePercent >= 0 ? "+" : ""}${us10.changePercent.toFixed(2)}%`,
        affected,
        sentiment: up ? "negative" : "positive",
        note: up
          ? "Higher long yields compress the multiple on long-duration growth."
          : "Falling long yields support long-duration growth multiples.",
      });
    }
  }

  push(
    "COPPER",
    "Copper",
    ["CPER", "XLI"],
    ["CPER", "XLI"],
    "Copper strength supports the electrification complex.",
    "Copper weakness pressures the electrification complex.",
    0.4,
  );

  const vix = quotes.VIX;
  if (vix && vix.changePercent > 5) {
    const affected = only(["RSP", "QQQ", "SMH", "XLI", "VGK", "KWEB", "EMXC", "BIST"]);
    if (affected.length) {
      out.push({
        driver: "VIX",
        direction: "up",
        move: `+${vix.changePercent.toFixed(2)}%`,
        affected,
        sentiment: "negative",
        note: "A volatility spike raises drawdown risk across every equity sleeve.",
      });
    }
  }

  const fx = quotes["USD/TRY"];
  if (fx && Math.abs(fx.changePercent) > 0.4) {
    const up = fx.changePercent > 0;
    const affected = only(["BIST", "PPF"]);
    if (affected.length) {
      out.push({
        driver: "USD/TRY",
        direction: up ? "up" : "down",
        move: `${fx.changePercent >= 0 ? "+" : ""}${fx.changePercent.toFixed(2)}%`,
        affected,
        sentiment: up ? "negative" : "positive",
        note: up
          ? "A weaker lira reduces the USD value of BIST and PPF, even if TL prices hold."
          : "A firmer lira lifts the USD value of the Turkish sleeve.",
      });
    }
  }

  const gold = quotes["XAU/USD"];
  if (gold && Math.abs(gold.changePercent) > 0.4 && held.has("GLDM")) {
    out.push({
      driver: "Gold",
      direction: gold.changePercent > 0 ? "up" : "down",
      move: `${gold.changePercent >= 0 ? "+" : ""}${gold.changePercent.toFixed(2)}%`,
      affected: ["GLDM"],
      sentiment: gold.changePercent > 0 ? "positive" : "negative",
      note: "Gold is the portfolio's dual inflation and currency-shock hedge.",
    });
  }

  return out;
}

// ---------------------------------------------------------------- indicators

export interface TechnicalSnapshot {
  last: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  distanceFrom200: number | null;
  high52w: number | null;
  low52w: number | null;
  distanceFromHigh: number | null;
  annualVol: number;
  ret1m: number | null;
  ret3m: number | null;
  ret1y: number | null;
  ytd: number | null;
}

export function technicals(points: Point[]): TechnicalSnapshot | null {
  if (points.length < 2) return null;
  const closes = points.map((p) => p.close);
  const last = closes[closes.length - 1];
  const window = closes.slice(-Math.min(252, closes.length));
  const high52w = Math.max(...window);
  const low52w = Math.min(...window);
  const sma200 = sma(closes, 200);
  const back = (n: number) => (closes.length > n ? closes[closes.length - 1 - n] : undefined);
  const ytdRef = findAtOrAfter(points, `${new Date().getUTCFullYear()}-01-01`);

  return {
    last,
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200,
    distanceFrom200: sma200 ? last / sma200 - 1 : null,
    high52w,
    low52w,
    distanceFromHigh: high52w > 0 ? last / high52w - 1 : null,
    annualVol: annualiseVol(stdev(toReturns(closes.slice(-252)))),
    ret1m: pctBetween(back(21), last),
    ret3m: pctBetween(back(63), last),
    ret1y: pctBetween(back(252), last),
    ytd: pctBetween(ytdRef?.close, last),
  };
}

export const RANGE_DAYS: Record<string, number> = {
  "1D": 2,
  "1M": 22,
  "3M": 64,
  YTD: 0, // resolved against the calendar
  "1Y": 253,
  MAX: Number.MAX_SAFE_INTEGER,
};

export function sliceRange(points: Point[], range: string): Point[] {
  if (points.length === 0) return points;
  if (range === "YTD") {
    const start = `${new Date().getUTCFullYear()}-01-01`;
    const i = points.findIndex((p) => p.date >= start);
    return i === -1 ? points : points.slice(Math.max(0, i - 1));
  }
  const n = RANGE_DAYS[range] ?? points.length;
  return points.slice(Math.max(0, points.length - n));
}
