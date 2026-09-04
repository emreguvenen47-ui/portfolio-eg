import { describe, expect, it } from "vitest";
import { usableForValuation, validateCompanySnapshot } from "./company";
import type { CompanySnapshot, StatementRow } from "../normalize/company";

function q(date: string, over: Partial<StatementRow> = {}): StatementRow {
  return {
    date,
    filingDate: null,
    revenue: 100e9,
    grossProfit: 60e9,
    operatingIncome: 40e9,
    ebitda: 45e9,
    netIncome: 30e9,
    totalAssets: 500e9,
    totalDebt: 50e9,
    cash: 80e9,
    equity: 200e9,
    sharesOutstanding: 10e9,
    operatingCashFlow: 35e9,
    capex: 5e9,
    freeCashFlow: 30e9,
    costOfRevenue: null, rnd: null, sga: null, ebit: null, pretaxIncome: null, taxExpense: null,
    eps: null, currentAssets: null, currentLiabilities: null, inventory: null,
    shortTermDebt: null, longTermDebt: null, depreciation: null, stockComp: null,
    dividendsPaid: null, buybacks: null,
    ...over,
  };
}

const recentQ = () => {
  const d = new Date(Date.now() - 45 * 86_400_000);
  return d.toISOString().slice(0, 10);
};

function snapshot(over: Partial<CompanySnapshot> = {}): CompanySnapshot {
  return {
    identity: {
      symbol: "TEST",
      name: "Test Corp",
      exchange: "NASDAQ",
      currency: "USD",
      sector: "Technology",
      industry: "Semiconductors",
      description: null,
      country: "USA",
      employees: null,
      companyType: "SEMICONDUCTOR",
    },
    marketCap: 1000e9,
    sharesOutstanding: 10e9,
    floatShares: null,
    peTtm: 25,
    forwardPe: 20,
    peg: 1.2,
    priceToSales: 8,
    priceToBook: 10,
    enterpriseValue: 980e9,
    evToEbitda: 20,
    evToRevenue: 8,
    fcfYield: 0.03,
    epsTtm: 12,
    bookValuePerShare: 20,
    dividendYield: null,
    payoutRatio: null,
    grossMarginTtm: 0.6,
    operatingMarginTtm: 0.4,
    netMarginTtm: 0.3,
    fcfMargin: 0.3,
    roe: 0.4,
    roa: 0.2,
    roic: 0.25,
    roce: 0.2,
    revenueTtm: 400e9,
    netIncomeTtm: 120e9,
    ebitdaTtm: 180e9,
    operatingCashFlowTtm: 140e9,
    capexTtm: 20e9,
    freeCashFlowTtm: 120e9,
    cash: 80e9,
    totalDebt: 50e9,
    netDebt: -30e9,
    equity: 200e9,
    netDebtToEbitda: null, debtToEquity: 0.25, currentRatio: 1.5, quickRatio: 1.2,
    revenueGrowthYoY: 0.2,
    epsGrowthYoY: 0.25,
    revenueCagr3y: 0.15,
    epsCagr3y: 0.18,
    analystRating: 4.2,
    analystTargetPrice: 300,
    analystCounts: { strongBuy: 10, buy: 5, hold: 3, sell: 0, strongSell: 0 },
    epsEstimateCurrentYear: 13,
    epsEstimateNextYear: 15,
    forwardEstimates: [
      { periodEnd: "2027-12-31", epsAvg: 15, epsLow: 12, epsHigh: 18, revenueAvg: 450e9, analystCount: 30 },
    ],
    insiderOwnershipPct: 2,
    institutionalOwnershipPct: 70,
    quarterly: [q(recentQ()), q("2026-04-30"), q("2026-01-31"), q("2025-10-31")],
    annual: [],
    earningsHistory: [],
    meta: {
      source: "eodhd",
      fetchedAt: new Date().toISOString(),
      period: null,
      currency: "USD",
      confidence: "HIGH",
      issues: [],
      latestStatementPeriod: null,
      latestReportedPeriod: null,
      latestReportDate: null,
      dataDelayed: false,
    },
    ...over,
  };
}

describe("validateCompanySnapshot", () => {
  it("passes a healthy snapshot as HIGH", () => {
    const v = validateCompanySnapshot(snapshot());
    expect(v.meta.confidence).toBe("HIGH");
    expect(usableForValuation(v)).toBe(true);
  });

  it("marks a snapshot with no statements INVALID and unusable", () => {
    const v = validateCompanySnapshot(snapshot({ quarterly: [] }));
    expect(v.meta.confidence).toBe("INVALID");
    expect(usableForValuation(v)).toBe(false);
  });

  it("downgrades stale statements", () => {
    const v = validateCompanySnapshot(
      snapshot({ quarterly: [q("2025-06-30"), q("2025-03-31"), q("2024-12-31"), q("2024-09-30")] }),
    );
    expect(["MEDIUM", "LOW"]).toContain(v.meta.confidence);
    expect(v.meta.issues.join(" ")).toMatch(/days old|stale/i);
  });

  it("catches a share-count / EPS inconsistency (unit slip)", () => {
    // netIncome 120e9 at epsTtm 12 implies 10e9 shares; claim 100e9 shares.
    const v = validateCompanySnapshot(snapshot({ sharesOutstanding: 100e9 }));
    expect(v.meta.issues.join(" ")).toMatch(/share count/i);
    expect(v.meta.confidence).toBe("LOW");
  });

  it("catches impossible margins", () => {
    const v = validateCompanySnapshot(snapshot({ netMarginTtm: 1.4 }));
    expect(v.meta.issues.join(" ")).toMatch(/impossible net margin/i);
  });

  it("flags duplicate quarters", () => {
    const d = recentQ();
    const v = validateCompanySnapshot(
      snapshot({ quarterly: [q(d), q(d), q("2026-01-31"), q("2025-10-31")] }),
    );
    expect(v.meta.issues.join(" ")).toMatch(/duplicate/i);
  });

  it("rejects negative TTM revenue as INVALID", () => {
    const v = validateCompanySnapshot(snapshot({ revenueTtm: -5e9 }));
    expect(v.meta.confidence).toBe("INVALID");
  });
});
