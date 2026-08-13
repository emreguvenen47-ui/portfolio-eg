import { describe, expect, it } from "vitest";
import {
  buildAggregates,
  evaluateCriterion,
  evaluateScreen,
  metricsInScreen,
  type Criterion,
  type Enriched,
  type Screen,
} from "./filter";
import { METRIC_BY_KEY, metricApplies, type Row } from "./metrics";
import type { Sector } from "@/lib/scanner/types";

const blank = (): Row =>
  ({
    symbol: "X",
    revenueGrowth: null, epsGrowth: null, grossMargin: null, operatingMargin: null,
    netMargin: null, fcfMargin: null, ruleOf40: null, roe: null, roa: null, roic: null,
    netCashToAssets: null, debtToEquity: null, currentRatio: null, equityToAssets: null,
    interestCover: null, pe: null, forwardPe: null, ps: null, pb: null, evEbitda: null,
    evSales: null, pFcf: null, fcfYield: null, return3m: null, return6m: null,
    return12m: null, fromHigh: null, volatility: null, beta: null, analystScore: null,
    bookValueGrowth: null, peg: null, marketCap: null, enterpriseValue: null, evEbit: null,
    ebitdaMargin: null, earningsYield: null, dividendYield: null, netDebtToEbitda: null,
    cashToDebt: null, quickRatio: null, netDebt: null, cash: null, rsi: null,
    fromHigh52: null, fromLow52: null, from20dma: null, from50dma: null, from200dma: null,
    returnYtd: null, return1d: null, return1w: null, relativeStrength: null,
    avgDollarVolume: null, qualityScore: null, opportunityScore: null, fairValueUpside: null,
    bookValueGrowthYoy: null, revenueGrowthQoq: null, epsGrowthQoq: null,
    operatingIncomeGrowth: null, fcfGrowth: null,
  }) as Row;

const e = (symbol: string, sector: Sector, over: Partial<Row>, industry = "Machinery"): Enriched => ({
  symbol,
  sector,
  industry,
  row: { ...blank(), symbol, ...over },
});

const crit = (o: Partial<Criterion>): Criterion => ({
  id: "c1",
  metric: "evEbitda",
  comparator: "lt",
  basis: "absolute",
  value: 10,
  value2: null,
  enabled: true,
  ...o,
});

const screen = (criteria: Criterion[], combinator: "AND" | "OR" = "AND"): Screen => ({
  id: "s",
  name: "s",
  combinator,
  criteria,
});

const AGG = (rows: Enriched[], keys: Parameters<typeof buildAggregates>[1]) =>
  buildAggregates(rows, keys);

describe("metric applicability", () => {
  it("keeps EV/EBITDA and gross margin away from banks", () => {
    expect(metricApplies(METRIC_BY_KEY.get("evEbitda")!, "Banks")).toBe(false);
    expect(metricApplies(METRIC_BY_KEY.get("grossMargin")!, "Banks")).toBe(false);
    expect(metricApplies(METRIC_BY_KEY.get("roic")!, "Banks")).toBe(false);
    expect(metricApplies(METRIC_BY_KEY.get("netDebt")!, "Banks")).toBe(false);
  });

  it("keeps equity/assets to banks and allows P/B and ROE everywhere", () => {
    expect(metricApplies(METRIC_BY_KEY.get("equityToAssets")!, "Banks")).toBe(true);
    expect(metricApplies(METRIC_BY_KEY.get("equityToAssets")!, "Industrials")).toBe(false);
    expect(metricApplies(METRIC_BY_KEY.get("pb")!, "Banks")).toBe(true);
    expect(metricApplies(METRIC_BY_KEY.get("roe")!, "Banks")).toBe(true);
  });
});

describe("missing data never passes a filter", () => {
  const agg = AGG([], ["evEbitda"]);

  it("fails a company with no value for the filtered metric", () => {
    const r = evaluateCriterion(crit({}), e("NODATA", "Industrials", {}), agg);
    expect(r.outcome).toBe("NO_DATA");
    expect(evaluateScreen(screen([crit({})]), e("NODATA", "Industrials", {}), agg).matched).toBe(false);
  });

  it("passes a company that genuinely satisfies it", () => {
    const r = evaluateCriterion(crit({}), e("CHEAP", "Industrials", { evEbitda: 6 }), agg);
    expect(r.outcome).toBe("PASS");
  });

  it("fails a company that genuinely misses it", () => {
    expect(evaluateCriterion(crit({}), e("RICH", "Industrials", { evEbitda: 22 }), agg).outcome).toBe("FAIL");
  });

  it("skips a bank rather than failing it on an inapplicable metric", () => {
    const r = evaluateCriterion(crit({}), e("BANK", "Banks", { pb: 1.1 }), agg);
    expect(r.outcome).toBe("NOT_APPLICABLE");
  });

  it("does not match a company on which nothing could be tested", () => {
    // Only criterion is inapplicable — that is not the same as satisfying it.
    const v = evaluateScreen(screen([crit({})]), e("BANK", "Banks", { pb: 1.1 }), agg);
    expect(v.matched).toBe(false);
    expect(v.tested).toBe(0);
  });
});

describe("AND / OR", () => {
  const agg = AGG([], ["evEbitda", "roic"]);
  const cs = [
    crit({ id: "a", metric: "evEbitda", comparator: "lt", value: 10 }),
    crit({ id: "b", metric: "roic", comparator: "gt", value: 15 }),
  ];

  it("AND requires every tested criterion", () => {
    expect(evaluateScreen(screen(cs, "AND"), e("A", "Industrials", { evEbitda: 6, roic: 20 }), agg).matched).toBe(true);
    expect(evaluateScreen(screen(cs, "AND"), e("B", "Industrials", { evEbitda: 6, roic: 5 }), agg).matched).toBe(false);
  });

  it("OR requires only one", () => {
    expect(evaluateScreen(screen(cs, "OR"), e("B", "Industrials", { evEbitda: 6, roic: 5 }), agg).matched).toBe(true);
    expect(evaluateScreen(screen(cs, "OR"), e("C", "Industrials", { evEbitda: 40, roic: 5 }), agg).matched).toBe(false);
  });

  it("ignores disabled criteria", () => {
    const disabled = [cs[0], { ...cs[1], enabled: false }];
    expect(evaluateScreen(screen(disabled), e("B", "Industrials", { evEbitda: 6, roic: 1 }), agg).matched).toBe(true);
  });
});

describe("sector-relative filters", () => {
  const peers: Enriched[] = [
    e("P1", "Industrials", { evEbitda: 6, roic: 8 }),
    e("P2", "Industrials", { evEbitda: 8, roic: 12 }),
    e("P3", "Industrials", { evEbitda: 10, roic: 16 }),
    e("P4", "Industrials", { evEbitda: 12, roic: 20 }),
    e("P5", "Industrials", { evEbitda: 14, roic: 24 }),
  ];
  const agg = AGG(peers, ["evEbitda", "roic"]);

  it("computes the sector median from the peers", () => {
    expect(agg.sectorMedian.get("Industrials")?.evEbitda).toBe(10);
    expect(agg.sectorMedian.get("Industrials")?.roic).toBe(16);
  });

  it("passes a company below the sector median and fails one above", () => {
    const c = crit({ metric: "evEbitda", comparator: "lt", basis: "sectorMedian", value: null });
    expect(evaluateCriterion(c, e("CHEAP", "Industrials", { evEbitda: 7 }), agg).outcome).toBe("PASS");
    expect(evaluateCriterion(c, e("RICH", "Industrials", { evEbitda: 13 }), agg).outcome).toBe("FAIL");
  });

  it("supports a multiple of the median", () => {
    // Below 0.8 × median of 10 means below 8.
    const c = crit({ metric: "evEbitda", comparator: "lt", basis: "sectorMedian", value: 0.8 });
    expect(evaluateCriterion(c, e("A", "Industrials", { evEbitda: 7 }), agg).threshold).toBe(8);
    expect(evaluateCriterion(c, e("A", "Industrials", { evEbitda: 7 }), agg).outcome).toBe("PASS");
    expect(evaluateCriterion(c, e("B", "Industrials", { evEbitda: 9 }), agg).outcome).toBe("FAIL");
  });

  it("reports NO_PEERS rather than passing when the group is too small", () => {
    const thin = AGG([e("ONLY", "Energy", { evEbitda: 5 })], ["evEbitda"]);
    const c = crit({ metric: "evEbitda", basis: "sectorMedian", value: null });
    expect(evaluateCriterion(c, e("ONLY", "Energy", { evEbitda: 5 }), thin).outcome).toBe("NO_PEERS");
  });

  it("inverts the percentile scale for lower-is-better metrics", () => {
    // The cheapest EV/EBITDA in the group should sit at a HIGH percentile,
    // because for a valuation metric cheap is the good end.
    const c = crit({ metric: "evEbitda", comparator: "gte", basis: "sectorPercentile", value: 70 });
    const cheapest = evaluateCriterion(c, e("P1", "Industrials", { evEbitda: 6 }), agg);
    expect(cheapest.outcome).toBe("PASS");
    const dearest = evaluateCriterion(c, e("P5", "Industrials", { evEbitda: 14 }), agg);
    expect(dearest.outcome).toBe("FAIL");
  });

  it("keeps the percentile scale as-is for higher-is-better metrics", () => {
    const c = crit({ metric: "roic", comparator: "gte", basis: "sectorPercentile", value: 70 });
    expect(evaluateCriterion(c, e("P5", "Industrials", { roic: 24 }), agg).outcome).toBe("PASS");
    expect(evaluateCriterion(c, e("P1", "Industrials", { roic: 8 }), agg).outcome).toBe("FAIL");
  });
});

describe("composite screens", () => {
  const peers: Enriched[] = [
    e("A", "Industrials", { evEbitda: 6, roic: 22, revenueGrowth: 14, marketCap: 1e9 }),
    e("B", "Industrials", { evEbitda: 8, roic: 18, revenueGrowth: 11, marketCap: 3e9 }),
    e("C", "Industrials", { evEbitda: 10, roic: 12, revenueGrowth: 8, marketCap: 5e9 }),
    e("D", "Industrials", { evEbitda: 12, roic: 9, revenueGrowth: 4, marketCap: 8e9 }),
    e("E", "Industrials", { evEbitda: 16, roic: 6, revenueGrowth: 1, marketCap: 2e9 }),
  ];
  const keys = ["evEbitda", "roic", "revenueGrowth"] as const;
  const agg = AGG(peers, [...keys]);

  it("returns only companies satisfying every criterion", () => {
    const s = screen([
      crit({ id: "1", metric: "evEbitda", comparator: "lt", basis: "sectorMedian", value: null }),
      crit({ id: "2", metric: "roic", comparator: "gt", basis: "sectorMedian", value: null }),
      crit({ id: "3", metric: "revenueGrowth", comparator: "gt", basis: "absolute", value: 10 }),
    ]);
    const matched = peers.filter((p) => evaluateScreen(s, p, agg).matched).map((p) => p.symbol);
    // Median EV/EBITDA is 10 and median ROIC is 12; A and B clear all three.
    expect(matched).toEqual(["A", "B"]);
  });

  it("lists exactly the metrics a screen reads, for enrichment priority", () => {
    const s = screen([crit({ id: "1", metric: "roic" }), crit({ id: "2", metric: "roic" }), crit({ id: "3", metric: "pe" })]);
    expect(metricsInScreen(s).sort()).toEqual(["pe", "roic"]);
  });
});

describe("between comparator", () => {
  const agg = AGG([], ["marketCap"]);
  it("is inclusive at both ends and needs the upper bound", () => {
    const c = crit({ metric: "marketCap", comparator: "between", value: 5e8, value2: 5e9 });
    expect(evaluateCriterion(c, e("A", "Industrials", { marketCap: 5e8 }), agg).outcome).toBe("PASS");
    expect(evaluateCriterion(c, e("B", "Industrials", { marketCap: 6e9 }), agg).outcome).toBe("FAIL");
    const noUpper = crit({ metric: "marketCap", comparator: "between", value: 5e8, value2: null });
    expect(evaluateCriterion(noUpper, e("C", "Industrials", { marketCap: 1e9 }), agg).outcome).toBe("FAIL");
  });
});

describe("untestable criteria never grant a pass", () => {
  const peers = ["p1", "p2", "p3", "p4", "p5"].map((s, i) =>
    e(s, "Industrials", { evEbitda: 5 + i, roic: 10 + i }),
  );
  // Industrials has enough members for evEbitda; nobody reports roic in a
  // second, thinner sector.
  const agg = AGG(peers, ["evEbitda", "roic"]);

  it("does not admit a row on one criterion when the other has no peer group", () => {
    // Energy has a single member, so its median is meaningless.
    const lone = e("SOLO", "Energy", { evEbitda: 3, roic: 40 });
    const withLone = AGG([...peers, lone], ["evEbitda", "roic"]);
    const screen: Screen = {
      id: "s",
      name: "two things",
      combinator: "AND",
      criteria: [
        crit({ id: "a", metric: "evEbitda", basis: "sectorMedian", value: null }),
        crit({ id: "b", metric: "roic", comparator: "gt", basis: "sectorMedian", value: null }),
      ],
    };
    const v = evaluateScreen(screen, lone, withLone);
    expect(v.results.map((r) => r.outcome)).toEqual(["NO_PEERS", "NO_PEERS"]);
    expect(v.matched).toBe(false);
    // Both counted against it rather than being forgiven.
    expect(v.tested).toBe(2);
  });

  it("still admits a row when the unresolvable criterion is merely inapplicable", () => {
    const bank = e("BANK", "Banks", { pb: 0.8 });
    const bankPeers = ["b1", "b2", "b3", "b4", "b5"].map((s, i) => e(s, "Banks", { pb: 1 + i * 0.3 }));
    const bagg = AGG([...bankPeers, bank], ["pb", "evEbitda"]);
    const screen: Screen = {
      id: "s",
      name: "cheap bank",
      combinator: "AND",
      criteria: [
        crit({ id: "a", metric: "evEbitda", comparator: "lt", basis: "absolute", value: 10 }),
        crit({ id: "b", metric: "pb", comparator: "lt", basis: "absolute", value: 1.5 }),
      ],
    };
    const v = evaluateScreen(screen, bank, bagg);
    expect(v.results.map((r) => r.outcome)).toEqual(["NOT_APPLICABLE", "PASS"]);
    expect(v.matched).toBe(true);
    expect(v.tested).toBe(1);
  });

  it("under OR an unresolvable criterion contributes nothing", () => {
    const lone = e("SOLO", "Energy", { evEbitda: 3, roic: 40 });
    const withLone = AGG([...peers, lone], ["evEbitda", "roic"]);
    const screen: Screen = {
      id: "s",
      name: "either",
      combinator: "OR",
      criteria: [
        crit({ id: "a", metric: "evEbitda", basis: "sectorMedian", value: null }),
        crit({ id: "b", metric: "roic", comparator: "gt", basis: "absolute", value: 20 }),
      ],
    };
    const v = evaluateScreen(screen, lone, withLone);
    // The absolute criterion passes on its own merits; the peerless one does
    // not tip the balance either way.
    expect(v.matched).toBe(true);
    expect(v.results[0].outcome).toBe("NO_PEERS");
    expect(v.results[1].outcome).toBe("PASS");
  });
});
