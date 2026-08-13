import { describe, expect, it } from "vitest";
import { capBucket, toSector, CAP_BUCKET_LABEL } from "./types";
import { modelFor, metricsUsedBy, HIGHER_IS_BETTER, type Facts } from "./metrics";
import { buildPeerGroup, percentileOf, scoreCandidate, explain, type Candidate } from "./score";
import { fairValue } from "./fair-value";
import { applyFilters, applyPreset, EMPTY_FILTERS, PRESETS } from "./filters";
import type { ScanRow } from "./engine";

const facts = (o: Partial<Facts>): Facts =>
  ({
    symbol: "X",
    revenueGrowth: null, epsGrowth: null, grossMargin: null, operatingMargin: null,
    netMargin: null, fcfMargin: null, ruleOf40: null, roe: null, roa: null, roic: null,
    netCashToAssets: null, debtToEquity: null, currentRatio: null, equityToAssets: null,
    interestCover: null, pe: null, forwardPe: null, ps: null, pb: null, evEbitda: null,
    evSales: null, pFcf: null, fcfYield: null, return3m: null, return6m: null,
    return12m: null, fromHigh: null, volatility: null, beta: null, analystScore: null,
    bookValueGrowth: null, ...o,
  }) as Facts;

const cand = (symbol: string, sector: Parameters<typeof modelFor>[0], f: Partial<Facts>, industry = "Ind"): Candidate => ({
  profile: {
    symbol, name: symbol, region: "US", currency: "USD",
    industry, sector, marketCap: 5_000, bucket: "MID", fetchedAt: "",
  },
  facts: facts({ ...f, symbol }),
  price: 100,
  dollarVolume: 10_000_000,
});

describe("market-cap buckets", () => {
  // Units are absolute currency, not millions. The screener reports absolute
  // figures and the classifier is the single place that reads them, so mixing
  // the two would move every threshold by a factor of a million.
  it("uses lira thresholds for BIST rather than the US ladder", () => {
    expect(capBucket(30_000_000_000, "BIST")).toBe("MID");
    expect(capBucket(30_000_000_000, "US")).toBe("LARGE");
    expect(CAP_BUCKET_LABEL.BIST.MID).toContain("₺");
  });

  it("returns null rather than a bucket when market cap is unknown", () => {
    expect(capBucket(null, "US")).toBeNull();
    expect(capBucket(0, "US")).toBeNull();
  });
});

describe("sector mapping", () => {
  it("routes provider industries to the model that fits", () => {
    expect(toSector("Semiconductors")).toBe("Semiconductors");
    expect(toSector("Banking")).toBe("Banks");
    expect(toSector("Oil & Gas")).toBe("Energy");
    expect(toSector(null)).toBe("Other");
  });
});

describe("sector models", () => {
  it("never asks a bank for gross margin or free cash flow", () => {
    const used = metricsUsedBy("Banks");
    expect(used).not.toContain("grossMargin");
    expect(used).not.toContain("fcfMargin");
    expect(used).not.toContain("roic");
    expect(used).not.toContain("netCashToAssets");
    // And it does ask for the ones that describe a balance-sheet business.
    expect(used).toContain("roe");
    expect(used).toContain("pb");
    expect(used).toContain("equityToAssets");
  });

  it("knows which direction is better for each metric", () => {
    expect(HIGHER_IS_BETTER.revenueGrowth).toBe(true);
    expect(HIGHER_IS_BETTER.pe).toBe(false);
    expect(HIGHER_IS_BETTER.debtToEquity).toBe(false);
    expect(HIGHER_IS_BETTER.fcfYield).toBe(true);
  });
});

describe("percentiles", () => {
  it("inverts for lower-is-better metrics", () => {
    const sorted = [10, 20, 30, 40, 50];
    // A P/E of 10 is the cheapest, so it should score highest.
    expect(percentileOf(sorted, 10, false)).toBe(100);
    expect(percentileOf(sorted, 50, false)).toBe(0);
    expect(percentileOf(sorted, 50, true)).toBe(100);
  });
});

describe("scoring", () => {
  const pool = [
    cand("A", "Technology", { revenueGrowth: 30, operatingMargin: 30, roic: 30, pe: 15, netMargin: 20, debtToEquity: 20, currentRatio: 2, return6m: 20, return3m: 10, return12m: 30, fcfMargin: 20, volatility: 20, beta: 1, analystScore: 80, epsGrowth: 25, interestCover: 10, netCashToAssets: 10, forwardPe: 14, evEbitda: 10 }),
    cand("B", "Technology", { revenueGrowth: 10, operatingMargin: 15, roic: 12, pe: 30, netMargin: 8, debtToEquity: 90, currentRatio: 1.1, return6m: 0, return3m: -5, return12m: 5, fcfMargin: 6, volatility: 40, beta: 1.4, analystScore: 50, epsGrowth: 5, interestCover: 3, netCashToAssets: -10, forwardPe: 27, evEbitda: 18 }),
    cand("C", "Technology", { revenueGrowth: 20, operatingMargin: 22, roic: 20, pe: 22, netMargin: 14, debtToEquity: 50, currentRatio: 1.5, return6m: 10, return3m: 3, return12m: 15, fcfMargin: 12, volatility: 30, beta: 1.2, analystScore: 65, epsGrowth: 15, interestCover: 6, netCashToAssets: 0, forwardPe: 20, evEbitda: 14 }),
    cand("D", "Technology", { revenueGrowth: 5, operatingMargin: 10, roic: 8, pe: 40, netMargin: 5, debtToEquity: 120, currentRatio: 0.9, return6m: -10, return3m: -12, return12m: -20, fcfMargin: 2, volatility: 55, beta: 1.8, analystScore: 40, epsGrowth: -5, interestCover: 2, netCashToAssets: -20, forwardPe: 35, evEbitda: 22 }),
    cand("E", "Technology", { revenueGrowth: 15, operatingMargin: 18, roic: 16, pe: 25, netMargin: 11, debtToEquity: 70, currentRatio: 1.3, return6m: 5, return3m: 0, return12m: 8, fcfMargin: 9, volatility: 35, beta: 1.3, analystScore: 55, epsGrowth: 10, interestCover: 4, netCashToAssets: -5, forwardPe: 23, evEbitda: 16 }),
  ];

  it("ranks the strong company above the weak one", () => {
    const a = scoreCandidate(pool[0], buildPeerGroup(pool[0], pool));
    const d = scoreCandidate(pool[3], buildPeerGroup(pool[3], pool));
    expect(a.score).toBeGreaterThan(d.score!);
  });

  it("does not rank a cheap company highly on price alone", () => {
    // Cheapest multiple in the group, worst everything else.
    const cheapJunk = cand("JUNK", "Technology", {
      pe: 4, forwardPe: 4, evEbitda: 2,
      revenueGrowth: -20, epsGrowth: -40, operatingMargin: 1, netMargin: 0.5,
      roic: 1, fcfMargin: -5, debtToEquity: 300, currentRatio: 0.6,
      interestCover: 0.8, netCashToAssets: -40, return3m: -30, return6m: -40,
      return12m: -60, volatility: 80, beta: 2.2, analystScore: 20,
    });
    const all = [...pool, cheapJunk];
    const junk = scoreCandidate(cheapJunk, buildPeerGroup(cheapJunk, all));
    const strong = scoreCandidate(pool[0], buildPeerGroup(pool[0], all));
    // Valuation alone is 20% of the weight; it must not carry the whole score.
    expect(junk.score).toBeLessThan(strong.score!);
    expect(junk.score).toBeLessThan(55);
  });

  it("refuses to score a candidate below the coverage floor", () => {
    const thin = cand("THIN", "Technology", { pe: 12 });
    const all = [...pool, thin];
    const r = scoreCandidate(thin, buildPeerGroup(thin, all));
    expect(r.score).toBeNull();
    expect(r.confidence).toBe("LOW");
  });

  it("does not count a metric no peer reports against anyone", () => {
    // Nobody in this group reports bookValueGrowth, so it must not enter the
    // coverage denominator and drag everyone below the floor.
    const r = scoreCandidate(pool[0], buildPeerGroup(pool[0], pool));
    const keys = r.pillars.flatMap((p) => [...p.parts.map((x) => x.metric), ...p.missing]);
    expect(keys).not.toContain("bookValueGrowth");
  });

  it("falls back from industry to sector when peers are too few", () => {
    const lonely = cand("LONE", "Technology", { pe: 20 }, "VeryNicheIndustry");
    const peer = buildPeerGroup(lonely, [...pool, lonely]);
    expect(peer.basis).toBe("sector");
  });

  it("explains itself with real peer comparisons on both sides", () => {
    const r = scoreCandidate(pool[0], buildPeerGroup(pool[0], pool));
    const e = explain(pool[0], r);
    expect(e.likes.length).toBeGreaterThan(0);
    expect(e.likes[0]).toMatch(/percentile/);
    expect(e.triggers.length).toBeGreaterThan(0);
  });
});

describe("fair value", () => {
  const peer = {
    basis: "industry" as const,
    label: "Ind",
    n: 12,
    medians: { pe: 20, forwardPe: 18, evEbitda: 12 },
    values: { pe: [10, 20, 30], forwardPe: [12, 18, 24], evEbitda: [8, 12, 16] },
  };

  it("implies a higher price when the company trades below peers", () => {
    const fv = fairValue({
      facts: facts({ pe: 10, forwardPe: 9, evEbitda: 6 }),
      sector: "Technology",
      price: 100,
      peer,
      growthPercentile: 50,
      qualityPercentile: 50,
    });
    expect(fv.available).toBe(true);
    expect(fv.low!).toBeGreaterThan(100);
  });

  it("caps the growth/quality premium rather than compounding it", () => {
    const fv = fairValue({
      facts: facts({ pe: 20 }),
      sector: "Technology",
      price: 100,
      peer,
      growthPercentile: 100,
      qualityPercentile: 100,
    });
    // Peer median is the company's own multiple, so the entire uplift is the
    // adjustment — bounded at +25%.
    expect(fv.methods[0].impliedPrice).toBeCloseTo(125, 0);
  });

  it("skips a multiple with a negative denominator", () => {
    const fv = fairValue({
      facts: facts({ pe: -8, evEbitda: 10 }),
      sector: "Technology",
      price: 100,
      peer,
      growthPercentile: 50,
      qualityPercentile: 50,
    });
    expect(fv.methods.map((m) => m.method)).not.toContain("pe");
  });

  it("never values a bank on EV/EBITDA", () => {
    const fv = fairValue({
      facts: facts({ pb: 1, pe: 8, evEbitda: 5 }),
      sector: "Banks",
      price: 100,
      peer: { ...peer, medians: { ...peer.medians, pb: 1.4 }, values: { ...peer.values, pb: [0.8, 1.4, 2] } },
      growthPercentile: 50,
      qualityPercentile: 50,
    });
    expect(fv.methods.map((m) => m.method)).not.toContain("evEbitda");
    expect(fv.methods.map((m) => m.method)).toContain("pb");
  });

  it("lowers confidence when the methods disagree", () => {
    const wide = fairValue({
      facts: facts({ pe: 5, forwardPe: 40, evEbitda: 6 }),
      sector: "Technology",
      price: 100,
      peer,
      growthPercentile: 50,
      qualityPercentile: 50,
    });
    expect(wide.confidence).toBe("LOW");
  });

  it("is unavailable rather than guessed with no price", () => {
    const fv = fairValue({ facts: facts({ pe: 10 }), sector: "Technology", price: null, peer, growthPercentile: null, qualityPercentile: null });
    expect(fv.available).toBe(false);
    expect(fv.low).toBeNull();
  });
});

describe("filters", () => {
  const row = (o: Partial<ScanRow> & { score: number | null; coverage?: [number, number]; peers?: number }): ScanRow =>
    ({
      symbol: "X", name: "X", region: "US", sector: "Technology", industry: "Ind",
      currency: "USD", marketCap: 5_000, bucket: "MID", price: 100,
      result: {
        symbol: "X", score: o.score,
        pillars: [{ pillar: "quality", score: 80, parts: [], missing: [] }],
        coverage: { have: o.coverage?.[0] ?? 9, total: o.coverage?.[1] ?? 10 },
        confidence: "HIGH",
        peer: { basis: "industry", label: "Ind", n: o.peers ?? 12, medians: {}, values: {} },
        industryPercentile: null, sectorPercentile: null,
      },
      explanation: { likes: [], dislikes: [], triggers: [] },
      fair: { available: false, methods: [], low: null, high: null, mid: null, upsideLow: null, upsideHigh: null, confidence: "LOW", note: "" },
      ...o,
    }) as ScanRow;

  it("excludes a row whose market cap is unknown from a cap filter", () => {
    const rows = [row({ score: 70 }), row({ score: 70, symbol: "Y", marketCap: null, bucket: null })];
    const out = applyFilters(rows, { ...EMPTY_FILTERS, buckets: ["MID"] });
    expect(out.map((r) => r.symbol)).toEqual(["X"]);
  });

  it("rejects a row below the coverage floor", () => {
    const rows = [row({ score: 70, coverage: [3, 10] })];
    expect(applyFilters(rows, { ...EMPTY_FILTERS, minCoverage: 0.5 })).toHaveLength(0);
  });

  it("rejects a row whose pillar has no score against a floor", () => {
    const r = row({ score: 70 });
    r.result.pillars = [{ pillar: "quality", score: null, parts: [], missing: [] }];
    expect(applyFilters([r], { ...EMPTY_FILTERS, pillarFloors: { quality: 50 } })).toHaveLength(0);
  });

  it("applies a preset as a filter configuration", () => {
    const cheap = PRESETS.find((p) => p.id === "cheap-quality")!;
    const f = applyPreset(EMPTY_FILTERS, cheap);
    // The quality floor is what stops this being a list of cheap junk.
    expect(f.pillarFloors.quality).toBeGreaterThan(0);
    expect(f.pillarFloors.valuation).toBeGreaterThan(0);
  });
});
