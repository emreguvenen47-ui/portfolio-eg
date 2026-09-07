import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/types";
import { atr, buildTechnicalMap, findPivots } from "./technical";
import { buildTradeCard } from "./trade";
import { classifyNews, dedupeNews } from "./news-classify";
import { computeValuation } from "./valuation";
import { computeExpectations } from "./expectations";
import { buildFinancialStory } from "./financial-story";
import { validateCompanySnapshot } from "@/lib/data/validation/company";
import type { CompanySnapshot, StatementRow } from "@/lib/data/normalize/company";

// ---------------------------------------------------------------- fixtures

/** Deterministic pseudo-random walk with an embedded support at ~100. */
function syntheticCandles(n = 300): Candle[] {
  let price = 100;
  let seed = 42;
  const rnd = () => {
    // xorshift — deterministic across runs (no Math.random in tests).
    seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
    return ((seed >>> 0) % 1000) / 1000;
  };
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const drift = 0.0006;
    const shock = (rnd() - 0.5) * 0.03;
    // Bounce whenever we dip to ~100: manufactures a real support cluster.
    if (price < 100) price = 100 + rnd() * 1.5;
    price = Math.max(60, price * (1 + drift + shock));
    const high = price * (1 + rnd() * 0.012);
    const low = Math.min(price * (1 - rnd() * 0.012), high - 0.01);
    out.push({
      date: new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      open: price * (1 - 0.002 + rnd() * 0.004),
      high,
      low,
      close: price,
      volume: 1_000_000 + Math.floor(rnd() * 500_000),
    });
  }
  return out;
}

function q(date: string, over: Partial<StatementRow> = {}): StatementRow {
  return {
    date, filingDate: null,
    revenue: 100e9, grossProfit: 60e9, operatingIncome: 40e9, ebitda: 45e9, netIncome: 30e9,
    totalAssets: 500e9, totalDebt: 50e9, cash: 80e9, equity: 200e9, sharesOutstanding: 10e9,
    operatingCashFlow: 35e9, capex: 5e9, freeCashFlow: 30e9,
    costOfRevenue: null, rnd: null, sga: null, ebit: null, pretaxIncome: null, taxExpense: null,
    eps: null, currentAssets: null, currentLiabilities: null, inventory: null,
    shortTermDebt: null, longTermDebt: null, depreciation: null, stockComp: null,
    dividendsPaid: null, buybacks: null,
    ...over,
  };
}

const recent = (monthsAgo: number) =>
  new Date(Date.now() - monthsAgo * 30.4 * 86_400_000).toISOString().slice(0, 10);

function snap(over: Partial<CompanySnapshot> = {}): CompanySnapshot {
  const s: CompanySnapshot = {
    identity: {
      symbol: "TEST", name: "Test", exchange: "NASDAQ", currency: "USD",
      sector: "Technology", industry: "Semiconductors", description: null,
      country: "USA", employees: null, companyType: "SEMICONDUCTOR",
    },
    marketCap: 1200e9, sharesOutstanding: 10e9, floatShares: null,
    peTtm: 25, forwardPe: 20, peg: 1.1, priceToSales: 8, priceToBook: 9,
    enterpriseValue: 1180e9, evToEbitda: 18, evToRevenue: 8, fcfYield: 0.03,
    epsTtm: 12, bookValuePerShare: 20, dividendYield: null, payoutRatio: null,
    grossMarginTtm: 0.6, operatingMarginTtm: 0.4, netMarginTtm: 0.3, fcfMargin: 0.3, roe: 0.35, roa: 0.2, roic: 0.25, roce: 0.2,
    revenueTtm: 400e9, netIncomeTtm: 120e9, ebitdaTtm: 180e9,
    operatingCashFlowTtm: 140e9, capexTtm: 20e9, freeCashFlowTtm: 120e9,
    cash: 80e9, totalDebt: 50e9, netDebt: -30e9, equity: 200e9, netDebtToEbitda: null, debtToEquity: 0.25, currentRatio: 1.5, quickRatio: 1.2,
    revenueGrowthYoY: 0.2, epsGrowthYoY: 0.25, revenueCagr3y: 0.15, epsCagr3y: 0.18,
    analystRating: 4.3, analystTargetPrice: 320,
    analystCounts: { strongBuy: 20, buy: 10, hold: 5, sell: 1, strongSell: 0 },
    epsEstimateCurrentYear: 13, epsEstimateNextYear: 16,
    forwardEstimates: [
      { periodEnd: "2027-12-31", epsAvg: 16, epsLow: 13, epsHigh: 19, revenueAvg: 480e9, analystCount: 30 },
    ],
    insiderOwnershipPct: 3, institutionalOwnershipPct: 70,
    intel: { officers: [], hq: null, ipoDate: null, fiscalYearEnd: null, webUrl: null, institutions: [], funds: [] },
    quarterly: [
      q(recent(1), { revenue: 120e9, netIncome: 40e9 }),
      q(recent(4), { revenue: 110e9, netIncome: 35e9 }),
      q(recent(7), { revenue: 100e9, netIncome: 30e9 }),
      q(recent(10), { revenue: 95e9, netIncome: 28e9 }),
      q(recent(13), { revenue: 90e9, netIncome: 25e9 }),
      q(recent(16), { revenue: 85e9, netIncome: 22e9 }),
      q(recent(19), { revenue: 80e9, netIncome: 20e9 }),
      q(recent(22), { revenue: 78e9, netIncome: 19e9 }),
    ],
    annual: [],
    earningsHistory: [
      { reportDate: recent(1), periodEnd: recent(1), epsActual: 4, epsEstimate: 3.8, surprisePct: 5.2 },
      { reportDate: recent(4), periodEnd: recent(4), epsActual: 3.6, epsEstimate: 3.5, surprisePct: 2.8 },
    ],
    meta: {
      source: "eodhd", fetchedAt: new Date().toISOString(),
      period: null, currency: "USD", confidence: "HIGH", issues: [],
      latestStatementPeriod: null, latestReportedPeriod: null, latestReportDate: null, dataDelayed: false,
    },
  };
  return validateCompanySnapshot({ ...s, ...over });
}

// ------------------------------------------------------------------- technical

describe("technical engine", () => {
  const candles = syntheticCandles();

  it("is deterministic: same candles → identical map", () => {
    const a = buildTechnicalMap("TEST", candles);
    const b = buildTechnicalMap("TEST", syntheticCandles());
    expect(a).toEqual(b);
  });

  it("produces canonical levels on the correct side of price", () => {
    const m = buildTechnicalMap("TEST", candles);
    expect(m.state).not.toBe("INSUFFICIENT_DATA");
    if (m.primarySupport !== null) expect(m.primarySupport).toBeLessThan(m.price);
    if (m.primaryResistance !== null) expect(m.primaryResistance).toBeGreaterThan(m.price);
    if (m.invalidation !== null && m.primarySupport !== null) {
      expect(m.invalidation).toBeLessThan(m.primarySupport);
    }
  });

  it("returns INSUFFICIENT_DATA on short history instead of guessing", () => {
    const m = buildTechnicalMap("TEST", candles.slice(0, 30));
    expect(m.state).toBe("INSUFFICIENT_DATA");
    expect(m.primarySupport).toBeNull();
  });

  it("computes a positive ATR", () => {
    expect(atr(candles, 14)).toBeGreaterThan(0);
  });

  it("finds both highs and lows as pivots", () => {
    const p = findPivots(candles);
    expect(p.some((x) => x.kind === "HIGH")).toBe(true);
    expect(p.some((x) => x.kind === "LOW")).toBe(true);
  });
});

describe("trade engine", () => {
  it("builds a coherent card with stop below entry below target", () => {
    const m = buildTechnicalMap("TEST", syntheticCandles());
    const card = buildTradeCard(m);
    if (card.entry !== null && card.stop !== null && card.target1 !== null) {
      expect(card.stop).toBeLessThan(card.entry);
      expect(card.target1).toBeGreaterThan(card.entry);
      expect(card.riskReward).not.toBeNull();
    }
  });
});

// ------------------------------------------------------------------- valuation

describe("valuation engine", () => {
  it("produces a sane fair-value band for a healthy company", () => {
    const v = computeValuation(snap(), 300);
    expect(v.verdict).toBe("OK");
    expect(v.base).not.toBeNull();
    expect(v.bear!).toBeLessThanOrEqual(v.base!);
    expect(v.bull!).toBeGreaterThanOrEqual(v.base!);
    // No absurd outputs (spec §11): within ±80% of price for this input set.
    expect(Math.abs(v.upsidePct!)).toBeLessThan(80);
  });

  it("rejects an outlier street target instead of averaging it in", () => {
    const v = computeValuation(snap({ analystTargetPrice: 1513 }), 300);
    expect(v.rejectedModels.map((r) => r.model)).toContain("STREET_TARGET");
    expect(v.models.map((m) => m.model)).not.toContain("STREET_TARGET");
  });

  it("returns VALUATION INVALID for unusable data, never a forced target", () => {
    const v = computeValuation(snap({ quarterly: [] }), 300);
    expect(v.verdict).toBe("INVALID");
    expect(v.base).toBeNull();
  });

  it("uses book-anchored model for banks", () => {
    const v = computeValuation(
      snap({
        identity: { ...snap().identity, companyType: "BANK", industry: "Banks - Diversified" },
        bookValuePerShare: 100,
        roe: 0.15,
      }),
      120,
    );
    expect(v.models.map((m) => m.model)).toContain("P_B_JUSTIFIED");
    expect(v.models.map((m) => m.model)).not.toContain("FCF_YIELD");
  });

  it("returns INVALID for non-USD reporting currency instead of FX-inflated numbers", () => {
    const v = computeValuation(
      snap({ identity: { ...snap().identity, currency: "TWD" } }),
      300,
    );
    expect(v.verdict).toBe("INVALID");
    expect(v.invalidReason).toMatch(/currency/i);
  });

  it("returns INVALID when the blended output is absurdly far from price (share-basis trap)", () => {
    // Simulate BRK-B-style per-A-share estimates: forward EPS 100x too big.
    const v = computeValuation(snap({ epsEstimateNextYear: 1600, epsEstimateCurrentYear: 1300 }), 300);
    expect(v.verdict).toBe("INVALID");
    expect(v.invalidReason).toMatch(/inconsistent|share basis/i);
  });

  it("drops FCF model when FCF is negative rather than emitting nonsense", () => {
    const v = computeValuation(snap({ freeCashFlowTtm: -10e9 }), 300);
    expect(v.rejectedModels.map((r) => r.model)).toContain("FCF_YIELD");
  });
});

// ---------------------------------------------------------------- expectations

describe("expectations engine", () => {
  it("computes a revision score and positive gap for improving estimates", () => {
    const e = computeExpectations(snap(), 300, 22);
    expect(e.revisionScore).toBeGreaterThan(50);
    expect(e.expectationGapPct).not.toBeNull();
    expect(e.gapReading).toBe("POSITIVE"); // street 16 vs implied 300/22≈13.6
  });

  it("returns nulls (not zeros) when inputs are missing", () => {
    const e = computeExpectations(null, 300, 22);
    expect(e.revisionScore).toBeNull();
    expect(e.expectationGapPct).toBeNull();
  });
});

// ------------------------------------------------------------- financial story

describe("financial story", () => {
  it("labels an improving company IMPROVING", () => {
    const story = buildFinancialStory(snap());
    expect(story.revenue).toBe("ACCELERATING");
    expect(story.debt).toBe("NET_CASH");
    expect(story.overall).toBe("IMPROVING");
  });

  it("returns N/A with insufficient quarters", () => {
    const story = buildFinancialStory(snap({ quarterly: snap().quarterly.slice(0, 4) }));
    expect(story.overall).toBe("N/A");
  });
});

// ------------------------------------------------------------------ news rules

describe("news classifier", () => {
  it("classifies guidance, M&A and analyst actions with sentiment", () => {
    const a = classifyNews({ title: "Acme raises full-year guidance after record quarter", date: "2026-09-01", url: "u" });
    expect(a.category).toBe("EARNINGS_GUIDANCE");
    expect(a.sentiment).toBe("POSITIVE");
    expect(a.impact).toBe("HIGH");
    const b = classifyNews({ title: "MegaCorp agrees to acquire Acme for $9B", date: "2026-09-01", url: "u" });
    expect(b.category).toBe("M_A");
    const c = classifyNews({ title: "Broker downgrades Acme, cuts price target", date: "2026-09-01", url: "u" });
    expect(c.category).toBe("ANALYST_ACTION");
    expect(c.sentiment).toBe("NEGATIVE");
  });

  it("dedupes near-identical headlines", () => {
    const items = dedupeNews([
      { title: "Acme raises full-year guidance after record quarter" },
      { title: "Acme raises full-year guidance after record quarter — analysts react" },
      { title: "Completely different story about Acme factory" },
    ]);
    expect(items.length).toBe(2);
  });
});
