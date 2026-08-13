import { describe, expect, it } from "vitest";
import { analyseInsiders, classify } from "./insiders";
import { analyseAnalysts } from "./analysts";
import { buildSmartMoney } from "./smart-money";
import { classifyChange, guidanceTrend } from "./guidance";
import { capitalAllocation, earningsQuality, ttmGrowth, netCash, roic } from "./statements";
import type { InsiderTx, FinancialPeriod } from "@/lib/providers/fundamentals";

const tx = (o: Partial<InsiderTx>): InsiderTx => ({
  name: "DOE JANE",
  share: 10_000,
  change: -100,
  filingDate: "2026-08-01",
  transactionDate: "2026-08-01",
  transactionPrice: 100,
  ...o,
});

const NOW = Date.parse("2026-08-11T00:00:00Z");
const daysAgo = (n: number) =>
  new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);

describe("insider transaction classification", () => {
  it("separates open-market decisions from mechanical filings", () => {
    const cases: [string, string, boolean][] = [
      ["P", "OPEN_MARKET_BUY", true],
      ["S", "OPEN_MARKET_SELL", true],
      ["M", "OPTION_EXERCISE", false],
      ["A", "STOCK_AWARD", false],
      ["F", "TAX_WITHHOLDING", false],
      ["G", "GIFT", false],
    ];
    for (const [code, kind] of cases) {
      expect(classify(tx({ transactionCode: code })).kind).toBe(kind);
    }
  });

  it("does not promote an unlabelled filing to an open-market trade", () => {
    // No code on the filing: direction is still known, but calling it a
    // deliberate purchase would be an invention.
    const r = classify(tx({ transactionCode: undefined, change: 500 }));
    expect(r.side).toBe("BUY");
    expect(r.kind).toBe("OTHER");
  });

  it("demotes a priceless P or S rather than booking a zero-dollar trade", () => {
    // Apple files gifts at a zero price; a P/S with no price is an artefact and
    // must not enter the dollar-flow totals as a free transaction.
    const r = classify(tx({ transactionCode: "S", transactionPrice: 0 }));
    expect(r.kind).toBe("OTHER");
    expect(r.value).toBeNull();
  });

  it("computes value and ownership change from the shares held after", () => {
    const r = classify(tx({ transactionCode: "P", change: 1_000, share: 11_000, transactionPrice: 50 }));
    expect(r.value).toBe(50_000);
    expect(r.sharesAfter).toBe(11_000);
    // Held 10,000 before, bought 1,000 → +10%.
    expect(r.ownershipChangePct).toBeCloseTo(10, 6);
  });

  it("reports unavailable fields as null rather than guessing", () => {
    const r = classify(tx({ transactionCode: "P" }));
    expect(r.title).toBeNull();
    expect(r.plan10b51).toBeNull();
    expect(r.ownershipType).toBeNull();
  });
});

describe("insider summary and signal", () => {
  it("excludes mechanical filings from the flow totals", () => {
    const r = analyseInsiders(
      [
        tx({ transactionCode: "P", change: 1_000, transactionPrice: 100, transactionDate: daysAgo(5) }),
        // A large award and withholding must not move the dollar flows at all.
        tx({ transactionCode: "A", change: 500_000, transactionPrice: 100, transactionDate: daysAgo(5) }),
        tx({ transactionCode: "F", change: -200_000, transactionPrice: 100, transactionDate: daysAgo(5) }),
      ],
      NOW,
    );
    const w30 = r.windows[0];
    expect(w30.buyValue).toBe(100_000);
    expect(w30.sellValue).toBe(0);
    expect(w30.sellCount).toBe(0);
    expect(r.mechanicalCount).toBe(2);
  });

  it("does not read heavy RSU vesting as insider selling", () => {
    // The common large-cap pattern: awards and tax withholding only. Reading
    // this as bearish is the failure this module exists to prevent.
    const r = analyseInsiders(
      Array.from({ length: 20 }, (_, i) =>
        tx({
          name: `EXEC ${i}`,
          transactionCode: i % 2 ? "F" : "A",
          change: i % 2 ? -5_000 : 20_000,
          transactionDate: daysAgo(10),
        }),
      ),
      NOW,
    );
    expect(r.signal).toBe("NEUTRAL");
    expect(r.windows[0].sellValue).toBe(0);
  });

  it("flags cluster buying when several insiders buy within 90 days", () => {
    const r = analyseInsiders(
      [
        tx({ name: "A", transactionCode: "P", change: 1_000, transactionPrice: 100, transactionDate: daysAgo(10) }),
        tx({ name: "B", transactionCode: "P", change: 2_000, transactionPrice: 100, transactionDate: daysAgo(30) }),
        tx({ name: "C", transactionCode: "P", change: 1_500, transactionPrice: 100, transactionDate: daysAgo(60) }),
      ],
      NOW,
    );
    expect(r.windows[1].clusterBuying).toBe(true);
    expect(r.windows[1].clusterBuyers).toBe(3);
    expect(r.signal).toBe("STRONG BUYING");
  });

  it("does not call one insider buying twice a cluster", () => {
    const r = analyseInsiders(
      [
        tx({ name: "A", transactionCode: "P", change: 1_000, transactionPrice: 100, transactionDate: daysAgo(10) }),
        tx({ name: "A", transactionCode: "P", change: 1_000, transactionPrice: 100, transactionDate: daysAgo(20) }),
      ],
      NOW,
    );
    expect(r.windows[1].clusterBuying).toBe(false);
  });

  it("ignores token purchases when detecting a cluster", () => {
    const r = analyseInsiders(
      [
        tx({ name: "A", transactionCode: "P", change: 1, transactionPrice: 10, transactionDate: daysAgo(5) }),
        tx({ name: "B", transactionCode: "P", change: 1, transactionPrice: 10, transactionDate: daysAgo(5) }),
      ],
      NOW,
    );
    expect(r.windows[1].clusterBuying).toBe(false);
  });

  it("calls broad selling with no buying STRONG SELLING", () => {
    const r = analyseInsiders(
      ["A", "B", "C", "D"].map((n) =>
        tx({ name: n, transactionCode: "S", change: -5_000, transactionPrice: 100, transactionDate: daysAgo(20) }),
      ),
      NOW,
    );
    expect(r.signal).toBe("STRONG SELLING");
  });

  it("stays neutral with no filings at all", () => {
    const r = analyseInsiders([], NOW);
    expect(r.signal).toBe("NEUTRAL");
    expect(r.windows.every((w) => w.buyCount === 0 && w.sellCount === 0)).toBe(true);
  });
});

// ------------------------------------------------------------------ statements

const q = (o: Partial<FinancialPeriod>): FinancialPeriod =>
  ({
    year: 2026,
    quarter: 1,
    endDate: "2026-03-31",
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
    ...o,
  }) as FinancialPeriod;

describe("statement derivations", () => {
  it("measures growth over trailing twelve months, not one quarter", () => {
    // 8 quarters: 100 each in the older year, 120 each in the newer.
    const periods = [
      ...Array.from({ length: 4 }, () => q({ revenue: 100 })),
      ...Array.from({ length: 4 }, () => q({ revenue: 120 })),
    ];
    expect(ttmGrowth(periods, (p) => p.revenue)).toBeCloseTo(20, 6);
  });

  it("falls back to a single-quarter comparison with short history", () => {
    const periods = [
      q({ revenue: 100 }),
      q({ revenue: 0 }),
      q({ revenue: 0 }),
      q({ revenue: 0 }),
      q({ revenue: 150 }),
    ];
    expect(ttmGrowth(periods, (p) => p.revenue)).toBeCloseTo(50, 6);
  });

  it("returns null rather than zero when a line is missing", () => {
    const periods = Array.from({ length: 8 }, () => q({ revenue: null }));
    expect(ttmGrowth(periods, (p) => p.revenue)).toBeNull();
  });

  it("treats total debt as absent only when both legs are absent", () => {
    expect(netCash(q({ cash: 100, shortTermDebt: null, longTermDebt: null }))).toBeNull();
    expect(netCash(q({ cash: 100, shortTermInvestments: 50, longTermDebt: 30 }))).toBe(120);
  });

  it("declines to compute ROIC without a full year of inputs", () => {
    const short = [q({ operatingIncome: 10, equity: 100, longTermDebt: 10 })];
    expect(roic(short[0], short)).toBeNull();
  });

  it("computes ROIC from reported figures when all inputs exist", () => {
    const periods = Array.from({ length: 4 }, () =>
      q({ operatingIncome: 25, pretaxIncome: 25, taxExpense: 5, equity: 200, longTermDebt: 100, cash: 50 }),
    );
    // EBIT 100, tax rate 20% → NOPAT 80; invested 200 + 100 − 50 = 250 → 32%.
    expect(roic(periods[3], periods)).toBeCloseTo(32, 6);
  });
});

describe("earnings quality", () => {
  it("flags profit rising while operating cash flow falls", () => {
    const periods = [
      q({ netIncome: 100, operatingCashFlow: 120, freeCashFlow: 100 }),
      q({ netIncome: 105, operatingCashFlow: 115, freeCashFlow: 95 }),
      q({ netIncome: 130, operatingCashFlow: 90, freeCashFlow: 70 }),
      q({ netIncome: 140, operatingCashFlow: 85, freeCashFlow: 65 }),
    ];
    const r = earningsQuality(periods);
    expect(r.verdict).toBe("WATCH");
    expect(r.note).toMatch(/cash flow is falling/i);
  });

  it("calls consistent cash conversion high quality", () => {
    const periods = Array.from({ length: 4 }, () =>
      q({ netIncome: 100, operatingCashFlow: 130, freeCashFlow: 110 }),
    );
    const r = earningsQuality(periods);
    expect(r.verdict).toBe("HIGH QUALITY");
    expect(r.ocfToNi).toBeCloseTo(1.3, 6);
  });

  it("reports N/A rather than guessing on short history", () => {
    expect(earningsQuality([q({ netIncome: 100 })]).verdict).toBe("N/A");
  });
});

describe("capital allocation", () => {
  it("reads the share count, not the buyback spend", () => {
    // Heavy buyback spend but a rising share count — issuance is outrunning it,
    // and the verdict has to follow the count that reaches per-share returns.
    const periods = [
      ...Array.from({ length: 4 }, () => q({ dilutedShares: 1_000, buybacks: 500 })),
      q({ dilutedShares: 1_050, buybacks: 500 }),
    ];
    const r = capitalAllocation(periods);
    expect(r.shareCountYoY).toBeCloseTo(5, 6);
    expect(r.shareVerdict).toBe("DILUTION");
  });

  it("calls a shrinking count a net buyback", () => {
    const periods = [
      ...Array.from({ length: 4 }, () => q({ dilutedShares: 1_000 })),
      q({ dilutedShares: 960 }),
    ];
    expect(capitalAllocation(periods).shareVerdict).toBe("NET BUYBACK");
  });

  it("reports N/A without a share count", () => {
    expect(capitalAllocation([q({})]).shareVerdict).toBe("N/A");
  });
});

// -------------------------------------------------------------------- analysts

describe("analyst consensus", () => {
  const rec = (period: string, strongBuy: number, buy: number, hold: number, sell = 0) => ({
    period,
    strongBuy,
    buy,
    hold,
    sell,
    strongSell: 0,
  });

  it("derives improving momentum from a strengthening book", () => {
    const r = analyseAnalysts([
      rec("2026-08-01", 20, 15, 5),
      rec("2026-07-01", 14, 14, 10),
      rec("2026-06-01", 10, 12, 15),
      rec("2026-05-01", 6, 10, 20),
    ]);
    expect(r.momentum).toBe("IMPROVING");
    expect(r.label).toBe("STRONG BUY");
    expect(r.netUpgrades).toBeGreaterThan(0);
  });

  it("reports N/A with no coverage rather than a neutral verdict", () => {
    const r = analyseAnalysts([]);
    expect(r.label).toBe("N/A");
    expect(r.momentum).toBe("N/A");
    expect(r.targets).toBeNull();
  });

  it("leaves targets and the action feed empty when no provider carries them", () => {
    const r = analyseAnalysts([rec("2026-08-01", 5, 5, 5)]);
    expect(r.actions).toEqual([]);
    expect(r.targets).toBeNull();
    expect(r.gapNote).toMatch(/not available/i);
  });
});

// ----------------------------------------------------------------- smart money

const emptyHealth = {
  pillars: [],
  total: null,
  coverage: 0,
  strengths: [],
  watch: [],
};

describe("smart money score", () => {
  it("excludes missing signals from the denominator", () => {
    const r = buildSmartMoney({
      insiders: null,
      analysts: analyseAnalysts([]),
      guidance: { entries: [], trend: "N/A", available: false, note: "" },
      health: emptyHealth,
      metrics: null,
      technical: "BULLISH",
      valuation: "N/A",
    });
    // Only the technical read has data, so it alone sets the score.
    expect(r.coverage).toBe(1);
    expect(r.score).toBe(75);
    expect(r.signals.filter((s) => s.score === null).length).toBe(r.total - 1);
  });

  it("never scores a missing signal as zero", () => {
    const withTech = buildSmartMoney({
      insiders: null,
      analysts: analyseAnalysts([]),
      guidance: { entries: [], trend: "N/A", available: false, note: "" },
      health: emptyHealth,
      metrics: null,
      technical: "BULLISH",
      valuation: "N/A",
    });
    // A zero-filled denominator would drag a single bullish signal far down.
    expect(withTech.score).toBeGreaterThan(50);
  });

  it("reports a null score when nothing has data", () => {
    const r = buildSmartMoney({
      insiders: null,
      analysts: analyseAnalysts([]),
      guidance: { entries: [], trend: "N/A", available: false, note: "" },
      health: emptyHealth,
      metrics: null,
      technical: null,
      valuation: "N/A",
    });
    expect(r.score).toBeNull();
    expect(r.coverage).toBe(0);
  });
});

// -------------------------------------------------------------------- guidance

describe("guidance classification", () => {
  const base = {
    metric: "revenue" as const,
    period: "FY2026",
    issuedAt: "2026-05-01",
    actual: null,
    unit: "usd" as const,
  };

  it("classifies a raised, lowered and withdrawn guide", () => {
    expect(classifyChange({ ...base, previous: { low: 90, high: 110 }, current: { low: 100, high: 120 } })).toBe("RAISED");
    expect(classifyChange({ ...base, previous: { low: 100, high: 120 }, current: { low: 90, high: 110 } })).toBe("LOWERED");
    expect(classifyChange({ ...base, previous: { low: 100, high: 120 }, current: null })).toBe("WITHDRAWN");
  });

  it("treats a rounding-level move as maintained", () => {
    expect(classifyChange({ ...base, previous: { low: 100, high: 100 }, current: { low: 100.2, high: 100.2 } })).toBe("MAINTAINED");
  });

  it("reports N/A with no guidance at all", () => {
    expect(guidanceTrend([])).toBe("N/A");
  });
});
