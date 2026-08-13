import type { Portfolio, Position } from "@/lib/types";

/**
 * A sample portfolio, shown to an account that has not uploaded one.
 *
 * WHY THIS IS NOT A VIOLATION OF THE NO-FAKE-DATA RULE, and where the line is:
 *
 * Every price, return, correlation and risk figure computed from this is real —
 * the tickers are real instruments and the market data comes from the same
 * providers as anything else. What is invented is the *allocation*: how much of
 * each you hold. That is a worked example, and it is labelled as one in
 * `meta.title`, in `meta.warnings`, and in the banner the pages render.
 *
 * The rule this must not break: a sample must never be mistaken for the user's
 * own position. So it is never written to the database, never counted as an
 * upload, and disappears the moment a real workbook arrives. `isSample` is on
 * the object rather than inferred from a title string, so a page cannot forget
 * to check.
 *
 * The weights are a plain diversified sketch — large-cap equity, some
 * international, bonds, gold, cash. Not advice, and not tuned to anything.
 */

export const SAMPLE_SOURCE = "sample-portfolio";

interface Seed {
  code: string;
  name: string;
  category: string;
  weight: number;
  symbol: string;
  assetClass: Position["assetClass"];
  region: Position["region"];
  kind: Position["kind"];
  /** Long-run assumptions, used only by the model-implied panels. */
  expectedReturn: number;
  volatility: number;
  themes: string[];
  rationale: string;
}

const TOTAL = 100_000;

const SEEDS: Seed[] = [
  {
    code: "SPY",
    name: "S&P 500",
    category: "US Large Cap",
    weight: 0.3,
    symbol: "SPY",
    assetClass: "Equity",
    region: "US",
    kind: "etf",
    expectedReturn: 0.08,
    volatility: 0.16,
    themes: ["core", "us-equity"],
    rationale: "Core US large-cap exposure.",
  },
  {
    code: "QQQ",
    name: "Nasdaq 100",
    category: "US Growth",
    weight: 0.15,
    symbol: "QQQ",
    assetClass: "Equity",
    region: "US",
    kind: "etf",
    expectedReturn: 0.1,
    volatility: 0.22,
    themes: ["growth", "technology"],
    rationale: "Concentrated large-cap technology and growth.",
  },
  {
    code: "AAPL",
    name: "Apple Inc.",
    category: "Single Stock",
    weight: 0.06,
    symbol: "AAPL",
    assetClass: "Equity",
    region: "US",
    kind: "etf",
    expectedReturn: 0.09,
    volatility: 0.26,
    themes: ["technology", "mega-cap"],
    rationale: "Mega-cap single-name exposure.",
  },
  {
    code: "MSFT",
    name: "Microsoft Corp.",
    category: "Single Stock",
    weight: 0.06,
    symbol: "MSFT",
    assetClass: "Equity",
    region: "US",
    kind: "etf",
    expectedReturn: 0.09,
    volatility: 0.25,
    themes: ["technology", "mega-cap"],
    rationale: "Mega-cap single-name exposure.",
  },
  {
    code: "VXUS",
    name: "Total International Stock",
    category: "International Equity",
    weight: 0.12,
    symbol: "VXUS",
    assetClass: "Equity",
    region: "Global",
    kind: "etf",
    expectedReturn: 0.07,
    volatility: 0.17,
    themes: ["international", "diversification"],
    rationale: "Developed and emerging markets outside the US.",
  },
  {
    code: "AGG",
    name: "US Aggregate Bond",
    category: "Fixed Income",
    weight: 0.15,
    symbol: "AGG",
    assetClass: "Alternative",
    region: "US",
    kind: "etf",
    expectedReturn: 0.04,
    volatility: 0.06,
    themes: ["fixed-income", "ballast"],
    rationale: "Investment-grade bonds as a volatility dampener.",
  },
  {
    code: "GLD",
    name: "Gold",
    category: "Commodity",
    weight: 0.08,
    symbol: "GLD",
    assetClass: "Commodity",
    region: "Global",
    kind: "etf",
    expectedReturn: 0.05,
    volatility: 0.15,
    themes: ["commodity", "inflation-hedge"],
    rationale: "Non-correlated store of value.",
  },
  {
    code: "DBC",
    name: "Broad Commodities",
    category: "Commodity",
    weight: 0.04,
    symbol: "DBC",
    assetClass: "Commodity",
    region: "Global",
    kind: "etf",
    expectedReturn: 0.045,
    volatility: 0.18,
    themes: ["commodity", "energy"],
    rationale: "Diversified commodity basket including energy.",
  },
  {
    code: "BIL",
    name: "1–3 Month T-Bill",
    category: "Cash",
    weight: 0.04,
    symbol: "BIL",
    assetClass: "Cash",
    region: "US",
    kind: "etf",
    expectedReturn: 0.045,
    volatility: 0.01,
    themes: ["cash"],
    rationale: "Dry powder in short-dated bills.",
  },
];

export function buildSamplePortfolio(): Portfolio {
  const positions: Position[] = SEEDS.map((s, i) => ({
    index: i,
    code: s.code,
    name: s.name,
    category: s.category,
    weight: s.weight,
    amount: Math.round(TOTAL * s.weight),
    expectedReturn: s.expectedReturn,
    volatility: s.volatility,
    currency: "USD",
    rationale: s.rationale,
    risks: "Sample allocation — not a recommendation.",
    assetClass: s.assetClass,
    region: s.region,
    kind: s.kind,
    symbol: s.symbol,
    isProxy: false,
    themes: s.themes,
    targetWeight: s.weight,
    currencyCode: "USD",
  }));

  return {
    meta: {
      title: "Sample portfolio",
      baseCurrency: "USD",
      totalAmount: TOTAL,
      sourceFile: SAMPLE_SOURCE,
      parsedAt: new Date().toISOString(),
      summary: {},
      warnings: [
        "This is a sample allocation so the analytics have something to work on. " +
          "Prices, returns and risk figures are real; the holdings are not yours. " +
          "Upload your own workbook on Settings to replace it.",
      ],
    },
    positions,
  };
}

/** True when a portfolio is the sample rather than something uploaded. */
export const isSamplePortfolio = (p: Portfolio): boolean =>
  p.meta.sourceFile === SAMPLE_SOURCE;
