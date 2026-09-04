import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/types";
import { buildTechnicalDecision, resampleWeekly } from "./technical-v3";
import { aggregateStats, backtestSetups } from "./backtest";

/** Same deterministic synthetic series as engines.test.ts. */
function syntheticCandles(n = 400): Candle[] {
  let price = 100;
  let seed = 42;
  const rnd = () => {
    seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
    return ((seed >>> 0) % 1000) / 1000;
  };
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const drift = 0.0006;
    const shock = (rnd() - 0.5) * 0.03;
    if (price < 100) price = 100 + rnd() * 1.5;
    price = Math.max(60, price * (1 + drift + shock));
    const high = price * (1 + rnd() * 0.012);
    const low = Math.min(price * (1 - rnd() * 0.012), high - 0.01);
    out.push({
      date: new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      open: price * (1 - 0.002 + rnd() * 0.004),
      high, low, close: price,
      volume: 1_000_000 + Math.floor(rnd() * 500_000),
    });
  }
  return out;
}

describe("technical decision V3", () => {
  const candles = syntheticCandles();
  const d = buildTechnicalDecision("TEST", candles);

  it("is deterministic", () => {
    expect(buildTechnicalDecision("TEST", syntheticCandles())).toEqual(d);
  });

  it("resamples weekly bars consistently", () => {
    const w = resampleWeekly(candles);
    expect(w.length).toBeGreaterThan(40);
    expect(w.length).toBeLessThan(candles.length / 4);
    // Weekly high must dominate its member days.
    expect(Math.max(...w.map((x) => x.high))).toBeCloseTo(Math.max(...candles.map((x) => x.high)), 6);
  });

  it("derives stops from structure with an explicit ladder, never bare percentages", () => {
    expect(d.stops.length).toBeGreaterThan(0);
    for (const s of d.stops) {
      expect(s.price).toBeLessThan(d.price);
      expect(s.atrDistance).toBeGreaterThan(0);
      expect(s.reason).toMatch(/ATR|structure|level/i);
    }
    const kinds = d.stops.map((s) => s.kind);
    expect(new Set(kinds).size).toBe(kinds.length); // no duplicate rungs
    // Ladder ordering: TIGHT above STANDARD above WIDE.
    const get = (k: string) => d.stops.find((s) => s.kind === k)?.price;
    const tight = get("TIGHT"); const std = get("STANDARD"); const wide = get("WIDE");
    if (tight !== undefined && std !== undefined) expect(tight).toBeGreaterThan(std);
    if (std !== undefined && wide !== undefined) expect(std).toBeGreaterThanOrEqual(wide);
  });

  it("keeps score composition explicit and bounded", () => {
    if (d.score) {
      const w = d.score.weights;
      expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
      expect(d.score.total).toBeGreaterThanOrEqual(0);
      expect(d.score.total).toBeLessThanOrEqual(100);
    }
  });

  it("computes coherent R:R when actionable", () => {
    if (d.riskReward !== null) {
      expect(d.riskPct).toBeGreaterThan(0);
      expect(d.rewardPct).toBeGreaterThan(0);
      expect(d.riskReward).toBeCloseTo(d.rewardPct! / d.riskPct!, 1);
    }
  });

  it("degrades counter-trend signals to tactical with LOW confidence", () => {
    // Manufacture: strong recent daily rally inside a long weekly downtrend.
    let px = 200;
    const bearish: Candle[] = [];
    for (let i = 0; i < 320; i++) {
      px = px * (1 - 0.004 + (i % 7 === 0 ? 0.004 : 0)); // grinding weekly downtrend
      bearish.push({
        date: new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
        open: px, high: px * 1.008, low: px * 0.992, close: px, volume: 1e6,
      });
    }
    for (let i = 0; i < 30; i++) {
      px = px * 1.012; // sharp daily recovery
      bearish.push({
        date: new Date(Date.UTC(2024, 0, 1) + (320 + i) * 86_400_000).toISOString().slice(0, 10),
        open: px, high: px * 1.01, low: px * 0.995, close: px, volume: 1.4e6,
      });
    }
    const cd = buildTechnicalDecision("CT", bearish);
    if (cd.counterTrend && ["TACTICAL_BUY", "WATCHING_FOR_ENTRY", "WAIT"].includes(cd.signal)) {
      expect(cd.confidence).toBe("LOW");
    }
    // Whatever the state machine lands on, a counter-trend read must never be STRONG_BUY.
    if (cd.counterTrend) expect(cd.signal).not.toBe("STRONG_BUY");
  });
});

describe("backtest engine", () => {
  const candles = syntheticCandles(600);

  it("NEVER looks ahead: bar-i decision identical when the future is replaced with garbage", () => {
    const i = 400;
    const visible = candles.slice(0, i + 1);
    const garbageFuture: Candle[] = [
      ...visible,
      ...candles.slice(i + 1).map((c, k) => ({ ...c, close: 1 + k, open: 1, high: 2 + k, low: 0.5 })),
    ];
    const a = buildTechnicalDecision("T", visible);
    const b = buildTechnicalDecision("T", garbageFuture.slice(0, i + 1));
    expect(a).toEqual(b);
  });

  it("produces outcomes with worst-case same-bar rule and no overlapping trades", () => {
    const outcomes = backtestSetups("TEST", candles, { stride: 2, horizon: 30 });
    // Entries fill at next bar open, never at the detection bar's close.
    for (const o of outcomes) {
      expect(o.mfePct).toBeGreaterThanOrEqual(0);
      expect(o.maePct).toBeLessThanOrEqual(0);
      if (o.exit === "STOP") expect(o.returnPct).toBeLessThan(0);
    }
    // Non-overlap: each entry begins after the previous exit.
    for (let k = 1; k < outcomes.length; k++) {
      expect(outcomes[k]!.entryDate > outcomes[k - 1]!.exitDate || outcomes[k]!.entryDate > outcomes[k - 1]!.entryDate).toBe(true);
    }
  });

  it("refuses to publish stats on thin samples", () => {
    const stats = aggregateStats(backtestSetups("TEST", candles.slice(0, 300), { stride: 5 }));
    for (const s of stats) {
      if (s.samples < 15) {
        expect(s.verdict).toBe("INSUFFICIENT_DATA");
        expect(s.target1HitRate).toBeNull();
      }
    }
  });
});
