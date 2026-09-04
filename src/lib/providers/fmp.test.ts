import { describe, it, expect } from "vitest";
import { fillBalanceSheet, reportedDebtFor, type FmpBalanceSheets } from "./fmp";
import type { FinancialPeriod } from "./fundamentals";

/**
 * The merge rules, offline.
 *
 * `fillBalanceSheet` is the only part of this provider that can corrupt data —
 * it writes into periods another source filed — so its guarantees are pinned
 * here rather than left to a live call.
 */

/** A period with everything null, so a test only states what it cares about. */
function period(over: Partial<FinancialPeriod> = {}): FinancialPeriod {
  return {
    year: 2026,
    quarter: 1,
    endDate: "2026-03-28",
    discrete: true,
    revenue: null,
    costOfRevenue: null,
    grossProfit: null,
    rnd: null,
    sga: null,
    operatingIncome: null,
    pretaxIncome: null,
    taxExpense: null,
    netIncome: null,
    eps: null,
    dilutedShares: null,
    operatingCashFlow: null,
    capex: null,
    freeCashFlow: null,
    depreciation: null,
    stockComp: null,
    dividendsPaid: null,
    buybacks: null,
    stockIssued: null,
    debtIssued: null,
    debtRepaid: null,
    cash: null,
    shortTermInvestments: null,
    totalAssets: null,
    currentAssets: null,
    currentLiabilities: null,
    totalLiabilities: null,
    equity: null,
    shortTermDebt: null,
    longTermDebt: null,
    inventory: null,
    ...over,
  };
}

function sheets(quarterly: FinancialPeriod[], annual: FinancialPeriod[] = []): FmpBalanceSheets {
  return {
    currency: "USD",
    quarterly,
    annual,
    asOf: "2026-04-30",
    source: "Financial Modeling Prep",
    sourceUrl: "https://example.invalid",
    reportedDebt: {},
  };
}

describe("fillBalanceSheet", () => {
  it("fills a blank balance-sheet cell from the matching period", () => {
    const target = [period({ totalAssets: null, equity: null })];
    const donor = sheets([period({ totalAssets: 383_000, equity: 107_000 })]);

    const r = fillBalanceSheet(target, donor);

    expect(r.periods[0]!.totalAssets).toBe(383_000);
    expect(r.periods[0]!.equity).toBe(107_000);
    expect(r.filled).toBe(2);
    expect(r.repaired).toEqual(["2026-03-28"]);
  });

  it("never overwrites a figure the primary source filed", () => {
    const target = [period({ totalAssets: 1, equity: 2 })];
    const donor = sheets([period({ totalAssets: 999, equity: 999 })]);

    const r = fillBalanceSheet(target, donor);

    expect(r.periods[0]!.totalAssets).toBe(1);
    expect(r.periods[0]!.equity).toBe(2);
    expect(r.filled).toBe(0);
  });

  it("leaves income and cash-flow fields alone", () => {
    // The donor carries no income data by design; writing its nulls over a
    // filed revenue would silently blank the income statement.
    const target = [period({ revenue: 100, operatingCashFlow: 50, totalAssets: null })];
    const donor = sheets([period({ totalAssets: 383_000, revenue: null })]);

    const r = fillBalanceSheet(target, donor);

    expect(r.periods[0]!.revenue).toBe(100);
    expect(r.periods[0]!.operatingCashFlow).toBe(50);
    expect(r.periods[0]!.totalAssets).toBe(383_000);
  });

  it("matches on end date, not on the fiscal quarter label", () => {
    // Apple's fiscal Q3 ends in June; a calendar-derived source calls the same
    // period Q2. Matching on the label would pair the wrong quarters.
    const target = [period({ endDate: "2026-06-27", quarter: 2, totalAssets: null })];
    const donor = sheets([
      period({ endDate: "2026-03-28", quarter: 2, totalAssets: 371_000 }),
      period({ endDate: "2026-06-27", quarter: 3, totalAssets: 383_000 }),
    ]);

    const r = fillBalanceSheet(target, donor);

    expect(r.periods[0]!.totalAssets).toBe(383_000);
  });

  it("prefers an exact date match over a near one", () => {
    const target = [period({ endDate: "2026-03-28", quarter: 1, totalAssets: null })];
    const donor = sheets([
      period({ endDate: "2026-03-31", quarter: 1, totalAssets: 111 }),
      period({ endDate: "2026-03-28", quarter: 1, totalAssets: 222 }),
    ]);

    expect(fillBalanceSheet(target, donor).periods[0]!.totalAssets).toBe(222);
  });

  it("tolerates a few days of drift for the same quarter", () => {
    // 52/53-week filers land on a slightly different day between sources.
    const target = [period({ endDate: "2026-03-31", quarter: 1, totalAssets: null })];
    const donor = sheets([period({ endDate: "2026-03-28", quarter: 1, totalAssets: 371_000 })]);

    expect(fillBalanceSheet(target, donor).periods[0]!.totalAssets).toBe(371_000);
  });

  it("does not reach across a different period", () => {
    const target = [period({ endDate: "2026-03-31", quarter: 1, totalAssets: null })];
    const donor = sheets([period({ endDate: "2025-12-27", quarter: 4, totalAssets: 379_000 })]);

    const r = fillBalanceSheet(target, donor);

    expect(r.periods[0]!.totalAssets).toBeNull();
    expect(r.filled).toBe(0);
  });

  it("draws on the annual sheets too", () => {
    const target = [period({ quarter: 0, endDate: "2025-09-27", totalAssets: null })];
    const donor = sheets([], [period({ quarter: 0, endDate: "2025-09-27", totalAssets: 365_000 })]);

    expect(fillBalanceSheet(target, donor).periods[0]!.totalAssets).toBe(365_000);
  });

  it("does not give a bank a current/non-current split it never filed", () => {
    // FMP buckets a bank's balance sheet into current and non-current even
    // though the filing has no such split — JPM comes back with a
    // multi-trillion `totalCurrentAssets`. Writing that in would put a derived
    // figure into a field the app reads as filed.
    const target = [
      period({ totalAssets: null, currentAssets: null, currentLiabilities: null, inventory: null }),
    ];
    const donor = sheets([
      period({
        totalAssets: 5_015_000,
        currentAssets: 3_165_000,
        currentLiabilities: 3_766_200,
        inventory: 0,
      }),
    ]);

    const r = fillBalanceSheet(target, donor, { bankLike: true });

    // The unclassified lines are still repaired — those a bank does file.
    expect(r.periods[0]!.totalAssets).toBe(5_015_000);
    // The classified ones are not.
    expect(r.periods[0]!.currentAssets).toBeNull();
    expect(r.periods[0]!.currentLiabilities).toBeNull();
    expect(r.periods[0]!.inventory).toBeNull();
    expect(r.filled).toBe(1);
  });

  it("does fill the split for an operating company", () => {
    const target = [period({ currentAssets: null, currentLiabilities: null })];
    const donor = sheets([period({ currentAssets: 149_820, currentLiabilities: 149_330 })]);

    const r = fillBalanceSheet(target, donor, { bankLike: false });

    expect(r.periods[0]!.currentAssets).toBe(149_820);
    expect(r.periods[0]!.currentLiabilities).toBe(149_330);
    expect(r.filled).toBe(2);
  });

  it("is a no-op without a donor, returning the same array", () => {
    const target = [period({ totalAssets: 5 })];

    const r = fillBalanceSheet(target, null);

    expect(r.periods).toBe(target);
    expect(r.filled).toBe(0);
  });

  it("returns the original array untouched when nothing was filled", () => {
    const target = [period({ totalAssets: 5 })];

    const r = fillBalanceSheet(target, sheets([period({ totalAssets: 9 })]));

    expect(r.periods).toBe(target);
  });
});

describe("reportedDebtFor", () => {
  const donor: FmpBalanceSheets = {
    ...sheets([]),
    reportedDebt: {
      "2026-03-28": { totalDebt: 84_710, netDebt: 48_380 },
    },
  };

  it("finds an exact period", () => {
    expect(reportedDebtFor(donor, "2026-03-28")?.totalDebt).toBe(84_710);
  });

  it("accepts a timestamped end date", () => {
    // The SEC path carries `2026-03-28 00:00:00`.
    expect(reportedDebtFor(donor, "2026-03-28 00:00:00")?.netDebt).toBe(48_380);
  });

  it("tolerates a few days of drift", () => {
    expect(reportedDebtFor(donor, "2026-03-31")?.totalDebt).toBe(84_710);
  });

  it("returns null for an unrelated period", () => {
    expect(reportedDebtFor(donor, "2024-01-01")).toBeNull();
  });

  it("returns null without a donor", () => {
    expect(reportedDebtFor(null, "2026-03-28")).toBeNull();
  });
});
