import type { AssetClass, PositionValuation, Region } from "@/lib/types";

/**
 * Everything about a generated portfolio that is arithmetic rather than
 * judgement: normalisation, dollar allocation, exposures, the quality score,
 * scenarios, and the comparison against the real book.
 *
 * The split is deliberate and load-bearing. A model is good at reading "I'm
 * worried US tech is expensive" and choosing sleeves; it is a poor and
 * expensive calculator, and a number it invents cannot be audited. So the AI
 * returns tickers, weights, roles and reasons — and every figure the user
 * reads is computed here from those.
 */

export type PortfolioRole =
  | "CORE"
  | "GROWTH"
  | "DEFENSIVE"
  | "INCOME"
  | "HEDGE"
  | "DIVERSIFIER"
  | "LIQUIDITY";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

/** What the model is asked to return per position. */
export interface AiPosition {
  ticker: string;
  name: string;
  weight: number;
  assetClass: AssetClass;
  region: Region;
  role: PortfolioRole;
  reason: string;
}

export interface InvestorProfile {
  investorType: string;
  riskScore: number;
  timeHorizon: string;
  liquidityRequirement: "Low" | "Medium" | "High";
  primaryObjective: string;
  keyConcerns: string[];
  suggestedEquityRange: string;
  suggestedDefensiveRange: string;
  suggestedCashRange: string;
}

export interface RiskExplanation {
  expectedRisk: "LOW" | "MODERATE" | "HIGH";
  largestRisk: string;
  mainDrawdownDriver: string;
  inflationProtection: "Low" | "Medium" | "Strong";
  currencyDiversification: "Weak" | "Medium" | "Strong";
  liquidity: "Low" | "Medium" | "High";
  topRisks: string[];
  topStrengths: string[];
  invalidations: string[];
}

/** The raw AI payload, before any validation. */
export interface AiDraft {
  investorProfile: InvestorProfile;
  portfolio: AiPosition[];
  risk: RiskExplanation;
}

// ------------------------------------------------------------- normalisation

/** Per-asset-class annual volatility used for the model-implied risk figure. */
const CLASS_VOL: Record<AssetClass, number> = {
  Equity: 0.17,
  Commodity: 0.2,
  Alternative: 0.12,
  Cash: 0.01,
  Unallocated: 0.01,
};

/** Rough liquidity score by asset class, 0..1. */
const CLASS_LIQUIDITY: Record<AssetClass, number> = {
  Cash: 1,
  Equity: 0.9,
  Commodity: 0.8,
  Alternative: 0.5,
  Unallocated: 1,
};

const RISK_BY_CLASS: Record<AssetClass, RiskLevel> = {
  Cash: "LOW",
  Unallocated: "LOW",
  Alternative: "MEDIUM",
  Equity: "HIGH",
  Commodity: "HIGH",
};

export interface BuiltPosition extends AiPosition {
  /** Normalised weight, 0..1. All positions sum to exactly 1. */
  weight: number;
  dollars: number;
  riskLevel: RiskLevel;
}

export interface Exposures {
  equity: number;
  cash: number;
  commodity: number;
  alternative: number;
  us: number;
  europe: number;
  em: number;
  turkey: number;
  global: number;
  technology: number;
}

export interface QualityScore {
  total: number;
  diversification: number;
  riskBalance: number;
  liquidity: number;
  concentration: number;
  currency: number;
  theme: number;
}

export interface ScenarioResult {
  id: string;
  name: string;
  impactPct: number;
  dollars: number;
  driver: string;
}

export interface BuiltPortfolio {
  positions: BuiltPosition[];
  amount: number;
  currency: string;
  exposures: Exposures;
  /** Model-implied annual volatility from class weights, not price history. */
  impliedVolatility: number;
  score: QualityScore;
  scenarios: ScenarioResult[];
  /** Weights that had to be rescaled, for transparency. */
  normalisedFrom: number | null;
}

/** Tech-flavoured tickers, used for the technology exposure figure. */
const TECH_TICKERS = new Set([
  "QQQ",
  "SMH",
  "SOXX",
  "XLK",
  "VGT",
  "KWEB",
  "IGV",
  "ARKK",
  "SMHX",
]);

function classify(p: AiPosition): { assetClass: AssetClass; region: Region } {
  return { assetClass: p.assetClass, region: p.region };
}

/**
 * Normalise weights to exactly 100%.
 *
 * The model is asked for weights summing to 100 and usually complies, but
 * "usually" is not a property you can show a user next to a dollar figure. The
 * largest-remainder pass at the end guarantees the displayed integers add up
 * too, so the table never shows 99.9%.
 */
export function normaliseWeights(positions: AiPosition[]): {
  positions: AiPosition[];
  originalTotal: number | null;
} {
  const total = positions.reduce((s, p) => s + (Number.isFinite(p.weight) ? p.weight : 0), 0);
  if (total <= 0) throw new Error("AI returned no usable weights");

  // The model may answer in percent (sums to ~100) or fractions (sums to ~1).
  const scale = total > 2 ? 100 : 1;
  const drifted = Math.abs(total - scale) > scale * 0.005;

  // Rescale to fractions of 1, then fix rounding with largest remainder so the
  // displayed one-decimal percentages also sum to 100.0.
  const raw = positions.map((p) => (p.weight / total) * 1000);
  const floored = raw.map((r) => Math.floor(r));
  let deficit = 1000 - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (deficit <= 0) break;
    floored[i] += 1;
    deficit -= 1;
  }

  return {
    positions: positions.map((p, i) => ({ ...p, weight: floored[i] / 1000 })),
    originalTotal: drifted ? total : null,
  };
}

function computeExposures(positions: BuiltPosition[]): Exposures {
  const sum = (pred: (p: BuiltPosition) => boolean) =>
    positions.filter(pred).reduce((s, p) => s + p.weight, 0);

  return {
    equity: sum((p) => p.assetClass === "Equity"),
    cash: sum((p) => p.assetClass === "Cash" || p.assetClass === "Unallocated"),
    commodity: sum((p) => p.assetClass === "Commodity"),
    alternative: sum((p) => p.assetClass === "Alternative"),
    us: sum((p) => p.region === "US"),
    europe: sum((p) => p.region === "Europe"),
    em: sum((p) => p.region === "EM" || p.region === "China"),
    turkey: sum((p) => p.region === "Turkey"),
    global: sum((p) => p.region === "Global"),
    technology: sum((p) => TECH_TICKERS.has(p.ticker.toUpperCase())),
  };
}

/**
 * Internal quality score.
 *
 * Six sub-scores, equally weighted. Every one is a clamped linear grade
 * between a stated good and bad level, so the number is reproducible and its
 * methodology fits in a tooltip. This is a house heuristic — it is labelled as
 * such in the UI and is not an industry measure.
 */
function scoreQuality(positions: BuiltPosition[], ex: Exposures): QualityScore {
  const grade = (v: number, good: number, bad: number) =>
    Math.round(Math.max(0, Math.min(1, (v - bad) / (good - bad))) * 100);

  const hhi = positions.reduce((s, p) => s + p.weight ** 2, 0);
  const effectiveN = hhi > 0 ? 1 / hhi : 0;
  const largest = positions.reduce((m, p) => Math.max(m, p.weight), 0);

  const regions = new Set(positions.filter((p) => p.weight > 0.02).map((p) => p.region));
  const roles = new Set(positions.filter((p) => p.weight > 0.02).map((p) => p.role));
  const classes = new Set(positions.filter((p) => p.weight > 0.02).map((p) => p.assetClass));

  const liquidity = positions.reduce(
    (s, p) => s + p.weight * (CLASS_LIQUIDITY[p.assetClass] ?? 0.7),
    0,
  );

  // Risk balance rewards a book that is neither all-equity nor all-cash.
  const growth = ex.equity + ex.commodity;
  const riskBalance = grade(1 - Math.abs(growth - 0.7) / 0.7, 1, 0.3);

  // Currency diversification: how far from being entirely one region.
  const nonUs = 1 - ex.us;
  const currency = grade(nonUs, 0.45, 0.05);

  const diversification = Math.round(
    (grade(effectiveN, 8, 2) + grade(classes.size, 4, 1) + grade(regions.size, 4, 1)) / 3,
  );

  const score: Omit<QualityScore, "total"> = {
    diversification,
    riskBalance,
    liquidity: grade(liquidity, 0.95, 0.55),
    concentration: grade(1 - largest, 0.82, 0.55),
    currency,
    theme: grade(roles.size, 5, 1),
  };

  const total = Math.round(
    (score.diversification +
      score.riskBalance +
      score.liquidity +
      score.concentration +
      score.currency +
      score.theme) /
      6,
  );

  return { total, ...score };
}

/**
 * Rule-based scenarios.
 *
 * Each scenario is a set of shocks by asset class and region; the impact is
 * the weighted sum. Deterministic on purpose — this is arithmetic, and a model
 * asked to "estimate the impact" would produce a plausible number nobody can
 * reproduce. The AI's job is to explain these results, not to compute them.
 */
interface ScenarioDef {
  id: string;
  name: string;
  driver: string;
  byClass?: Partial<Record<AssetClass, number>>;
  byRegion?: Partial<Record<Region, number>>;
  byTicker?: Record<string, number>;
  /** Only run when the portfolio has Turkey exposure. */
  requiresTurkey?: boolean;
}

const SCENARIOS: ScenarioDef[] = [
  {
    id: "us-crash",
    name: "US Equity Crash",
    driver: "S&P 500 −30%, defensives bid",
    byClass: { Equity: -0.22, Commodity: -0.08, Cash: 0.002 },
    byRegion: { US: -0.3, Europe: -0.22, EM: -0.25, China: -0.25, Global: -0.24 },
  },
  {
    id: "ai-correction",
    name: "AI Correction",
    driver: "Semis and mega-cap tech de-rate",
    byClass: { Equity: -0.1 },
    byTicker: { QQQ: -0.28, SMH: -0.38, XLK: -0.26, KWEB: -0.18, SOXX: -0.38, VGT: -0.26 },
  },
  {
    id: "inflation-shock",
    name: "Inflation Shock",
    driver: "CPI reaccelerates, real yields rise",
    byClass: { Equity: -0.12, Commodity: 0.14, Cash: 0.0, Alternative: -0.03 },
    byTicker: { GLDM: 0.12, GLD: 0.12, CPER: 0.16 },
  },
  {
    id: "global-recession",
    name: "Global Recession",
    driver: "Demand contracts worldwide",
    byClass: { Equity: -0.24, Commodity: -0.18, Alternative: -0.06, Cash: 0.005 },
    byTicker: { GLDM: 0.06, GLD: 0.06 },
  },
  {
    id: "usd-weakness",
    name: "USD Weakness",
    driver: "Dollar index −10%",
    byClass: { Commodity: 0.09 },
    byRegion: { US: -0.01, Europe: 0.07, EM: 0.1, China: 0.08, Global: 0.04 },
  },
  {
    id: "turkey-crisis",
    name: "Turkey Crisis",
    driver: "Lira devaluation and BIST drawdown",
    requiresTurkey: true,
    byRegion: { Turkey: -0.35 },
  },
];

function runScenarios(positions: BuiltPosition[], amount: number): ScenarioResult[] {
  const hasTurkey = positions.some((p) => p.region === "Turkey" && p.weight > 0);

  return SCENARIOS.filter((s) => !s.requiresTurkey || hasTurkey).map((s) => {
    let impact = 0;
    for (const p of positions) {
      const ticker = p.ticker.toUpperCase();

      // Region shocks describe EQUITY market moves, so they apply to equity
      // only. Without this a T-bill fund tagged region "US" would fall 30% in
      // an equity crash purely because of where it is domiciled.
      const regionShock = p.assetClass === "Equity" ? s.byRegion?.[p.region] : undefined;

      // Most specific wins: explicit ticker, then the equity-region shock,
      // then the asset-class shock.
      const shock = s.byTicker?.[ticker] ?? regionShock ?? s.byClass?.[p.assetClass] ?? 0;
      impact += p.weight * shock;
    }
    return {
      id: s.id,
      name: s.name,
      impactPct: impact * 100,
      dollars: impact * amount,
      driver: s.driver,
    };
  });
}

/** Turn a validated AI draft into the fully-costed portfolio the UI renders. */
export function buildPortfolio(
  draft: AiPosition[],
  amount: number,
  currency: string,
): BuiltPortfolio {
  const { positions: normalised, originalTotal } = normaliseWeights(draft);

  const positions: BuiltPosition[] = normalised.map((p) => {
    const { assetClass } = classify(p);
    return {
      ...p,
      dollars: p.weight * amount,
      riskLevel: RISK_BY_CLASS[assetClass] ?? "MEDIUM",
    };
  });

  const exposures = computeExposures(positions);
  const impliedVolatility = Math.sqrt(
    positions.reduce((s, p) => s + (p.weight * (CLASS_VOL[p.assetClass] ?? 0.15)) ** 2, 0) +
      // Cross-correlation term: assume 0.5 average correlation among risk assets.
      2 *
        0.5 *
        positions.reduce((s, p, i) => {
          let acc = 0;
          for (let j = i + 1; j < positions.length; j++) {
            const q = positions[j];
            acc +=
              p.weight *
              q.weight *
              (CLASS_VOL[p.assetClass] ?? 0.15) *
              (CLASS_VOL[q.assetClass] ?? 0.15);
          }
          return s + acc;
        }, 0),
  );

  return {
    positions,
    amount,
    currency,
    exposures,
    impliedVolatility,
    score: scoreQuality(positions, exposures),
    scenarios: runScenarios(positions, amount),
    normalisedFrom: originalTotal,
  };
}

// -------------------------------------------------------------- comparison

export interface ComparisonRow {
  label: string;
  ai: number;
  mine: number;
  /** Absolute gap in percentage points; drives the "major difference" flag. */
  gap: number;
  format: "pct" | "num";
}

/** Exposure breakdown of the REAL book, using the same buckets. */
export function actualExposures(rows: PositionValuation[]): Exposures {
  const sum = (pred: (r: PositionValuation) => boolean) =>
    rows.filter(pred).reduce((s, r) => s + r.currentWeight, 0);

  return {
    equity: sum((r) => r.position.assetClass === "Equity"),
    cash: sum((r) => r.position.assetClass === "Cash" || r.position.assetClass === "Unallocated"),
    commodity: sum((r) => r.position.assetClass === "Commodity"),
    alternative: sum((r) => r.position.assetClass === "Alternative"),
    us: sum((r) => r.position.region === "US"),
    europe: sum((r) => r.position.region === "Europe"),
    em: sum((r) => r.position.region === "EM" || r.position.region === "China"),
    turkey: sum((r) => r.position.region === "Turkey"),
    global: sum((r) => r.position.region === "Global"),
    technology: sum((r) => TECH_TICKERS.has((r.position.symbol ?? r.position.code).toUpperCase())),
  };
}

export function compare(
  built: BuiltPortfolio,
  rows: PositionValuation[],
  actualVolatility: number,
): ComparisonRow[] {
  const mine = actualExposures(rows);
  const ai = built.exposures;

  const hhiOf = (weights: number[]) => weights.reduce((s, w) => s + w * w, 0);
  const aiConc = hhiOf(built.positions.map((p) => p.weight));
  const myConc = hhiOf(rows.map((r) => r.currentWeight));

  const pct = (label: string, a: number, m: number): ComparisonRow => ({
    label,
    ai: a * 100,
    mine: m * 100,
    gap: Math.abs(a - m) * 100,
    format: "pct",
  });

  return [
    pct("Equity", ai.equity, mine.equity),
    pct("Cash", ai.cash, mine.cash),
    pct("Commodities", ai.commodity, mine.commodity),
    pct("US", ai.us, mine.us),
    pct("Europe", ai.europe, mine.europe),
    pct("Emerging Markets", ai.em, mine.em),
    pct("Turkey", ai.turkey, mine.turkey),
    pct("Technology", ai.technology, mine.technology),
    pct("Non-USD region exposure", 1 - ai.us, 1 - mine.us),
    pct("Estimated annual risk", built.impliedVolatility, actualVolatility),
    {
      label: "Concentration (effective positions)",
      ai: aiConc > 0 ? 1 / aiConc : 0,
      mine: myConc > 0 ? 1 / myConc : 0,
      gap: Math.abs((aiConc > 0 ? 1 / aiConc : 0) - (myConc > 0 ? 1 / myConc : 0)),
      format: "num",
    },
  ];
}
