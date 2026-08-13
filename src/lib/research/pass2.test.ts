import { describe, expect, it } from "vitest";
import { isBistSymbol, toBistYahoo, toBistDisplay, isTurkishBank, searchBist } from "@/lib/providers/bist";
import { companyKind, suppressedMetrics, bankMetrics } from "./company-kind";
import { compare, type CompareInput } from "./compare";
import { nowcast, pricingPower } from "./alt-data";
import { matches } from "@/lib/providers/polymarket";
import { classifyChange, radar, type InstitutionalHolder } from "@/lib/providers/ownership";
import { runCrisis, CRISES } from "@/lib/portfolio/crisis";
import { lookThrough } from "@/lib/portfolio/xray";
import type { Candle, PositionValuation } from "@/lib/types";
import type { FinancialPeriod } from "@/lib/providers/fundamentals";

describe("BIST symbol handling", () => {
  it("recognises universe members and .IS forms, not any five-letter ticker", () => {
    expect(isBistSymbol("THYAO")).toBe(true);
    expect(isBistSymbol("AKBNK")).toBe(true);
    expect(isBistSymbol("ASELS.IS")).toBe(true);
    expect(isBistSymbol("XU100")).toBe(true);
    // A US five-letter ticker must not be routed to Istanbul.
    expect(isBistSymbol("GOOGL")).toBe(false);
    expect(isBistSymbol("SBUX")).toBe(false);
  });

  it("keeps the .IS suffix out of the display form", () => {
    expect(toBistYahoo("THYAO")).toBe("THYAO.IS");
    expect(toBistYahoo("THYAO.IS")).toBe("THYAO.IS");
    expect(toBistDisplay("THYAO.IS")).toBe("THYAO");
  });

  it("knows which BIST names are banks", () => {
    expect(isTurkishBank("AKBNK")).toBe(true);
    expect(isTurkishBank("GARAN")).toBe(true);
    expect(isTurkishBank("THYAO")).toBe(false);
  });

  it("searches by ticker and by Turkish company name", () => {
    expect(searchBist("THY").map((b) => b.symbol)).toContain("THYAO");
    // Diacritic-insensitive: "TUPRAS" should find "Tüpraş".
    expect(searchBist("TUPRAS").map((b) => b.symbol)).toContain("TUPRS");
    expect(searchBist("aselsan").map((b) => b.symbol)).toContain("ASELS");
  });
});

describe("company classification", () => {
  it("treats US and Turkish banks alike", () => {
    expect(companyKind("JPM")).toBe("bank");
    expect(companyKind("AKBNK")).toBe("bank");
    expect(companyKind("GARAN")).toBe("bank");
    expect(companyKind("NVDA")).toBe("operating");
    expect(companyKind("THYAO")).toBe("operating");
  });

  it("suppresses industrial metrics for banks", () => {
    const s = suppressedMetrics("bank");
    // These four are the ones that produce confidently wrong readings.
    for (const k of ["grossmargin", "freecashflow", "netdebt", "roic"]) {
      expect(s.has(k)).toBe(true);
    }
    expect(suppressedMetrics("operating").size).toBe(0);
  });

  it("derives equity/assets but never invents a regulatory ratio", () => {
    const q = (o: Partial<FinancialPeriod>) => ({ equity: 100, totalAssets: 1000, ...o }) as FinancialPeriod;
    const b = bankMetrics(null, [q({})]);
    expect(b.equityToAssets).toBeCloseTo(10, 6);
    // Capital adequacy, NPL and NIM come from regulatory filings we do not have.
    expect(b.capitalAdequacy).toBeNull();
    expect(b.nplRatio).toBeNull();
    expect(b.netInterestMargin).toBeNull();
  });
});

// ------------------------------------------------------------------ compare

const ci = (symbol: string, over: Partial<CompareInput> = {}): CompareInput => ({
  symbol,
  quote: null,
  candles: [],
  periods: [],
  metrics: null,
  recommendations: null,
  technical: null,
  insiderSignal: null,
  smartMoney: null,
  opportunityScore: null,
  nextCatalyst: null,
  ...over,
});

describe("comparison lab", () => {
  it("marks a bank's gross margin not-applicable rather than zero", () => {
    const r = compare([ci("NVDA"), ci("JPM"), ci("AAPL")]);
    const row = r.rows.find((x) => x.key === "grossMargin")!;
    const jpm = row.cells[1];
    expect(jpm.display).toBe("N/A");
    expect(jpm.notApplicable).toMatch(/bank/i);
    // And it must not be ranked WEAK for having no value.
    expect(jpm.rank).toBeNull();
  });

  it("refuses to rank with fewer than three real values", () => {
    const r = compare([
      ci("A", { metrics: { peTTM: 10 } }),
      ci("B", { metrics: { peTTM: 30 } }),
    ]);
    const pe = r.rows.find((x) => x.key === "pe")!;
    expect(pe.cells.every((c) => c.rank === null)).toBe(true);
  });

  it("ranks lower-is-better metrics in the right direction", () => {
    const r = compare([
      ci("A", { metrics: { peTTM: 10 } }),
      ci("B", { metrics: { peTTM: 20 } }),
      ci("C", { metrics: { peTTM: 40 } }),
    ]);
    const pe = r.rows.find((x) => x.key === "pe")!;
    expect(pe.cells[0].rank).toBe("BEST");
    expect(pe.cells[2].rank).toBe("WEAK");
  });

  it("leaves a tied field unranked", () => {
    const r = compare([
      ci("A", { metrics: { peTTM: 20 } }),
      ci("B", { metrics: { peTTM: 20 } }),
      ci("C", { metrics: { peTTM: 20 } }),
    ]);
    const pe = r.rows.find((x) => x.key === "pe")!;
    expect(pe.cells.every((c) => c.rank === null)).toBe(true);
  });
});

// ------------------------------------------------------------------- crisis

const series = (from: string, days: number, start: number, end: number): Candle[] =>
  Array.from({ length: days }, (_, i) => {
    const close = start * (end / start) ** (i / Math.max(1, days - 1));
    const d = new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10);
    return { date: d, open: close, high: close, low: close, close, volume: 0 };
  });

describe("crisis simulator", () => {
  const covid = CRISES.find((c) => c.id === "covid-2020")!;

  it("excludes assets with no history rather than treating them as flat", () => {
    const r = runCrisis(covid, [
      { symbol: "OLD", weight: 0.5, candles: series("2020-02-19", 34, 100, 70) },
      { symbol: "NEW", weight: 0.5, candles: [] },
    ]);
    expect(r.coverage).toBeCloseTo(0.5, 6);
    expect(r.assets.find((a) => a.symbol === "NEW")!.covered).toBe(false);
    // The covered sleeve fell 30%; a "flat" assumption would report −15%.
    expect(r.totalReturn).toBeLessThan(-25);
    expect(r.note).toMatch(/50% of the book/);
  });

  it("rejects an asset that only listed near the end of the window", () => {
    // Five bars at the very end is not coverage of a five-week crash.
    const late = series("2020-03-18", 6, 100, 98);
    const r = runCrisis(covid, [{ symbol: "LATE", weight: 1, candles: late }]);
    expect(r.coverage).toBe(0);
    expect(r.totalReturn).toBeNull();
  });

  it("reports zero coverage honestly rather than a comforting number", () => {
    const r = runCrisis(CRISES.find((c) => c.id === "gfc-2008")!, [
      { symbol: "NEW", weight: 1, candles: series("2024-01-01", 100, 100, 120) },
    ]);
    expect(r.coverage).toBe(0);
    expect(r.maxDrawdown).toBeNull();
    expect(r.note).toMatch(/No position/);
  });
});

// -------------------------------------------------------------- look-through

const pv = (code: string, weight: number, kind = "etf"): PositionValuation =>
  ({ currentWeight: weight, position: { code, symbol: code, kind, themes: [] } }) as unknown as PositionValuation;

describe("full look-through", () => {
  it("sums direct and indirect exposure to the same company", () => {
    const r = lookThrough([pv("NVDA", 0.03, "etf"), pv("QQQ", 0.3), pv("SMH", 0.1)], {
      QQQ: { NVDA: 0.07 },
      SMH: { NVDA: 0.26 },
    });
    const nvda = r.holdings.find((h) => h.ticker === "NVDA")!;
    expect(nvda.direct).toBeCloseTo(0.03, 6);
    // 0.3 × 0.07 + 0.1 × 0.26 = 0.021 + 0.026
    expect(nvda.indirect).toBeCloseTo(0.047, 6);
    expect(nvda.total).toBeCloseTo(0.077, 6);
    expect(nvda.via).toHaveLength(2);
  });

  it("does not treat a fund with no holdings file as empty", () => {
    const r = lookThrough([pv("VGK", 0.2)], {});
    expect(r.uncovered).toContain("VGK");
    expect(r.covered).toBe(0);
    // Its weight is still counted as direct, not lost.
    expect(r.holdings.find((h) => h.ticker === "VGK")!.direct).toBeCloseTo(0.2, 6);
  });
});

// ----------------------------------------------------------------- ownership

describe("ownership radar", () => {
  const h = (name: string, shares: number, prior: number | null): InstitutionalHolder => ({
    name,
    shares,
    ownershipPct: null,
    value: null,
    asOf: "2026-06-30",
    filedAt: "2026-08-14",
    sharesPrior: prior,
    change: classifyChange(shares, prior),
    changeShares: prior === null ? null : shares - prior,
  });

  it("treats sub-1% moves as unchanged rather than a decision", () => {
    expect(classifyChange(1000, 1005)).toBe("UNCHANGED");
    expect(classifyChange(1200, 1000)).toBe("INCREASED");
    expect(classifyChange(800, 1000)).toBe("REDUCED");
    expect(classifyChange(0, 1000)).toBe("SOLD OUT");
    expect(classifyChange(1000, null)).toBe("NEW POSITION");
  });

  it("never reads a missing filing as an exit", () => {
    // Six filers, none of whom sold out. Only explicit SOLD OUT rows count.
    const holders = [
      h("A", 1200, 1000),
      h("B", 1300, 1000),
      h("C", 1000, null),
      h("D", 1000, 1000),
      h("E", 900, 1000),
      h("F", 1100, 1000),
    ];
    const r = radar(holders);
    expect(r.exited).toBe(0);
    expect(r.trend).toBe("ACCUMULATING");
  });

  it("returns N/A when too few filers moved to call a direction", () => {
    expect(radar([h("A", 1200, 1000)]).trend).toBe("N/A");
  });

  it("returns N/A with no filings at all", () => {
    expect(radar([]).trend).toBe("N/A");
  });
});

// ---------------------------------------------------------------- polymarket

describe("polymarket matching", () => {
  it("requires every term and rejects near-misses", () => {
    const fed = { allOf: ["fed", "rate"], noneOf: ["ecb", "turkey"] };
    expect(matches("Will the Fed cut rates in March?", fed)).toBe(true);
    // One word away, and about a different central bank.
    expect(matches("Will the ECB cut rates in March?", fed)).toBe(false);
    expect(matches("Will the Fed chair resign?", fed)).toBe(false);
  });
});

// ------------------------------------------------------------------ alt-data

describe("pricing power", () => {
  it("requires price, discounting and margin to agree", () => {
    const strong = pricingPower(
      { trackedProducts: 40, avgPriceChange90d: 6, discountFrequencyChange: -8, promotionIntensity: "LOW" },
      120,
    );
    expect(strong.verdict).toBe("IMPROVING");

    // Price up, but given straight back through promotion.
    const hollow = pricingPower(
      { trackedProducts: 40, avgPriceChange90d: 6, discountFrequencyChange: 15, promotionIntensity: "HIGH" },
      -50,
    );
    expect(hollow.verdict).toBe("DETERIORATING");
  });

  it("is N/A without tracked pricing", () => {
    expect(pricingPower(null, 100).verdict).toBe("N/A");
  });
});

describe("earnings nowcast", () => {
  const empty = {
    hiring: null,
    pricing: null,
    contracts: [],
    patents: null,
    analystRevision: null,
    grossMarginChangeBps: null,
    inventoryChangePct: null,
  };

  it("refuses a direction below three signals", () => {
    const r = nowcast({ ...empty, analystRevision: 20 });
    expect(r.verdict).toBe("N/A");
    expect(r.coverage).toBe(1);
  });

  it("always populates the counter-argument when one exists", () => {
    const r = nowcast({
      ...empty,
      hiring: { totalOpenings: 500, change30d: null, change90d: 25, byCategory: [], trend: "ACCELERATING" },
      pricing: { trackedProducts: 10, avgPriceChange90d: 5, discountFrequencyChange: null, promotionIntensity: null },
      analystRevision: 12,
      grossMarginChangeBps: -80,
      inventoryChangePct: 35,
    });
    // Three positives against two real negatives nets to +1, below the
    // threshold — margin compression and an inventory build genuinely offset
    // hiring and pricing rather than being footnoted under a green headline.
    expect(r.verdict).toBe("STABLE");
    expect(r.supporting.length).toBeGreaterThan(0);
    // A signal that only lists what supports it is a sales pitch.
    expect(r.against.length).toBeGreaterThan(0);
    expect(r.against.join(" ")).toMatch(/margin|Inventory/i);
  });

  it("never emits a revenue or EPS figure", () => {
    const r = nowcast({ ...empty, analystRevision: 20, grossMarginChangeBps: 100 });
    expect(JSON.stringify(r)).not.toMatch(/\$\d/);
  });
});
