import { buildTechnicalDecision, resampleWeekly, type TechnicalDecision } from "./technical-v3";
import {
  atrSeries,
  bollingerSeries,
  fibonacciFromSwings,
  findSwings,
  macdSeries,
  obvSeries,
  rsiSeries,
  smaSeries,
  stochasticSeries,
  type FibLevels,
} from "./indicators";
import type { Candle } from "@/lib/types";

/**
 * EG TECHNICAL REPORT — the deep "Analyze" behind the workstation button.
 *
 * ENRICHMENT layer: the canonical signal/setup/stops/targets come verbatim
 * from the V3 decision engine (single source of truth); this report adds the
 * surrounding evidence (structure, momentum, volume, volatility, patterns,
 * Fibonacci, scenarios) computed from the same OHLC series. Deterministic —
 * same candles, same report. Nothing here invents a price.
 */

export interface ReportLevel {
  price: number;
  label: string;
  kind: "SUPPORT" | "RESISTANCE" | "ENTRY" | "STOP" | "TARGET" | "FIB" | "MA";
}

export interface TechnicalReport {
  symbol: string;
  asOf: string;
  timeframe: string;
  price: number;

  structure: {
    dailyTrend: string;
    weeklyTrend: string;
    counterTrend: boolean;
    sequence: string; // e.g. "HH-HL-HH (last 4 swings)"
    trendStrengthPct: number | null; // distance of price vs MA200
    lines: string[];
  };
  levels: {
    supports: Array<{ price: number; label: string }>;
    resistances: Array<{ price: number; label: string }>;
    breakoutLevel: number | null;
    breakdownLevel: number | null;
    lines: string[];
  };
  movingAverages: Array<{
    label: string;
    value: number | null;
    distancePct: number | null;
    slope: "RISING" | "FALLING" | "FLAT" | null;
  }>;
  maNotes: string[];
  momentum: {
    rsi: number | null;
    rsiState: string;
    macd: number | null;
    macdSignal: number | null;
    macdState: string;
    stochK: number | null;
    stochD: number | null;
    divergence: string | null; // stated only with evidence
    lines: string[];
  };
  volume: {
    avg20: number | null;
    lastVsAvg: number | null; // ratio
    state: string;
    obvTrend: string | null;
    lines: string[];
  };
  volatility: {
    atr: number | null;
    atrPct: number | null;
    realizedAnnualPct: number | null;
    bandWidthPct: number | null;
    regime: string;
    lines: string[];
  };
  patterns: string[]; // only evidence-backed; may be empty
  fibonacci: {
    available: boolean;
    direction: string | null;
    swingHigh: { date: string; price: number } | null;
    swingLow: { date: string; price: number } | null;
    retracements: Array<{ ratio: number; price: number }>;
    extensions: Array<{ ratio: number; price: number }>;
    nearest: string | null;
  };
  entries: Array<{ kind: string; price: number | null; note: string }>;
  stops: TechnicalDecision["stops"];
  targets: Array<{ kind: string; price: number | null; note: string }>;
  riskReward: Array<{ combo: string; risk: number; reward: number; rr: number }>;
  scenarios: Array<{ case: "BULL" | "BASE" | "BEAR"; trigger: string; target: string; invalidation: string }>;
  verdict: {
    signal: string;
    setup: string;
    score: number | null;
    confidence: string;
    freshness: string;
    timeframe: string;
    interpretation: string;
  };
  /** Everything the chart needs to draw the EG ANALYSIS layer. */
  overlays: ReportLevel[];
}

const last = <T,>(xs: T[]): T | undefined => xs[xs.length - 1];
const f2 = (v: number) => Number(v.toFixed(2));

function slopeOf(values: Array<{ value: number | null }>, bars = 10): "RISING" | "FALLING" | "FLAT" | null {
  const now = last(values)?.value ?? null;
  const then = values[values.length - 1 - bars]?.value ?? null;
  if (now === null || then === null) return null;
  const chg = (now - then) / then;
  return chg > 0.004 ? "RISING" : chg < -0.004 ? "FALLING" : "FLAT";
}

/** Simple two-pivot divergence check: price extreme vs RSI extreme. */
function divergence(candles: Candle[], rsi: Array<{ value: number | null }>): string | null {
  const swings = findSwings(candles.slice(-120), 5);
  const highs = swings.filter((s) => s.kind === "HIGH").slice(-2);
  const lows = swings.filter((s) => s.kind === "LOW").slice(-2);
  const base = candles.length - Math.min(120, candles.length);
  if (highs.length === 2) {
    const [a, b] = highs;
    const ra = rsi[base + a!.index]?.value ?? null;
    const rb = rsi[base + b!.index]?.value ?? null;
    if (ra !== null && rb !== null && b!.price > a!.price && rb < ra - 2)
      return `Bearish divergence: price made a higher high (${f2(b!.price)} vs ${f2(a!.price)}) while RSI made a lower high (${rb.toFixed(0)} vs ${ra.toFixed(0)}).`;
  }
  if (lows.length === 2) {
    const [a, b] = lows;
    const ra = rsi[base + a!.index]?.value ?? null;
    const rb = rsi[base + b!.index]?.value ?? null;
    if (ra !== null && rb !== null && b!.price < a!.price && rb > ra + 2)
      return `Bullish divergence: price made a lower low (${f2(b!.price)} vs ${f2(a!.price)}) while RSI made a higher low (${rb.toFixed(0)} vs ${ra.toFixed(0)}).`;
  }
  return null;
}

/** Deterministic double-top/bottom evidence from the last swings. */
function patternEvidence(candles: Candle[], d: TechnicalDecision): string[] {
  const out: string[] = [];
  if (d.setup !== "NONE")
    out.push(`${d.setup.replaceAll("_", " ")} — the canonical setup detected by the decision engine (freshness ${d.freshness}).`);
  const swings = findSwings(candles.slice(-160), 5);
  const highs = swings.filter((s) => s.kind === "HIGH").slice(-2);
  const lows = swings.filter((s) => s.kind === "LOW").slice(-2);
  if (highs.length === 2) {
    const [a, b] = highs;
    if (Math.abs(b!.price - a!.price) / a!.price < 0.015 && b!.index - a!.index >= 10)
      out.push(`Potential double top: two swing highs within 1.5% (${f2(a!.price)} / ${f2(b!.price)}), ${b!.index - a!.index} bars apart. Confirmation requires a break of the interim low.`);
  }
  if (lows.length === 2) {
    const [a, b] = lows;
    if (Math.abs(b!.price - a!.price) / a!.price < 0.015 && b!.index - a!.index >= 10)
      out.push(`Potential double bottom: two swing lows within 1.5% (${f2(a!.price)} / ${f2(b!.price)}), ${b!.index - a!.index} bars apart. Confirmation requires a break of the interim high.`);
  }
  return out;
}

export function buildTechnicalReport(
  symbol: string,
  dailyCandles: Candle[],
  timeframe: "DAILY" | "WEEKLY" = "DAILY",
): TechnicalReport | null {
  if (dailyCandles.length < 60) return null;
  const candles = timeframe === "WEEKLY" ? resampleWeekly(dailyCandles) : dailyCandles;
  // Canonical decision is ALWAYS daily+weekly composite; the report timeframe
  // only changes which bars the enrichment math runs on.
  const d = buildTechnicalDecision(symbol, dailyCandles);
  const price = last(candles)!.close;

  // Structure
  const swings = findSwings(candles.slice(-160), 5).slice(-4);
  const seq = swings
    .map((s, i) => {
      if (i === 0) return s.kind === "HIGH" ? "H" : "L";
      const prevSame = swings.slice(0, i).reverse().find((x) => x.kind === s.kind);
      if (!prevSame) return s.kind === "HIGH" ? "H" : "L";
      if (s.kind === "HIGH") return s.price > prevSame.price ? "HH" : "LH";
      return s.price > prevSame.price ? "HL" : "LL";
    })
    .join("-");
  const ma200 = last(smaSeries(candles, 200))?.value ?? null;
  const trendStrengthPct = ma200 !== null ? ((price / ma200 - 1) * 100) : null;

  // Momentum
  const rsiAll = rsiSeries(candles, 14);
  const rsi = last(rsiAll)?.value ?? null;
  const macdAll = macdSeries(candles);
  const m = last(macdAll)!;
  const stoch = last(stochasticSeries(candles));
  const div = divergence(candles, rsiAll);
  const rsiState =
    rsi === null ? "N/A" : rsi >= 70 ? "OVERBOUGHT" : rsi <= 30 ? "OVERSOLD" : rsi >= 55 ? "BULLISH" : rsi <= 45 ? "BEARISH" : "NEUTRAL";
  const macdState =
    m.macd === null || m.signal === null
      ? "N/A"
      : m.macd > m.signal
        ? m.macd > 0 ? "BULLISH (above zero, above signal)" : "IMPROVING (below zero, above signal)"
        : m.macd > 0 ? "WEAKENING (above zero, below signal)" : "BEARISH (below zero, below signal)";

  // Volume
  const vols = candles.map((c) => c.volume ?? 0);
  const avg20 = vols.length >= 20 ? vols.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
  const lastVol = last(vols) ?? null;
  const volRatio = avg20 && lastVol !== null && avg20 > 0 ? lastVol / avg20 : null;
  const obvAll = obvSeries(candles);
  const obvTrend = slopeOf(obvAll, 20);

  // Volatility
  const atrAll = atrSeries(candles, 14);
  const atr = last(atrAll)?.value ?? null;
  const atrPct = atr !== null ? (atr / price) * 100 : null;
  const bb = last(bollingerSeries(candles));
  const bandWidthPct =
    bb && bb.upper !== null && bb.lower !== null && bb.middle !== null
      ? ((bb.upper - bb.lower) / bb.middle) * 100
      : null;
  const atr60 = atrAll.slice(-60).map((p) => p.value).filter((v): v is number => v !== null);
  const atrMedian = atr60.length ? [...atr60].sort((a, b) => a - b)[Math.floor(atr60.length / 2)]! : null;
  const volRegime =
    atr === null || atrMedian === null
      ? "N/A"
      : atr < atrMedian * 0.8
        ? "COMPRESSION (ATR well below its 60-bar median — expansion often follows)"
        : atr > atrMedian * 1.25
          ? "EXPANSION (ATR well above its 60-bar median)"
          : "NORMAL";

  // Fibonacci
  const fib: FibLevels | null = fibonacciFromSwings(candles);
  const nearestFib = fib
    ? [...fib.retracements]
        .map((r) => ({ ...r, dist: Math.abs(r.price - price) / price }))
        .sort((a, b) => a.dist - b.dist)[0] ?? null
    : null;

  // Moving averages table
  const maRows = [20, 50, 100, 200].map((p) => {
    const s = smaSeries(candles, p);
    const v = last(s)?.value ?? null;
    return {
      label: `MA${p}`,
      value: v,
      distancePct: v !== null ? ((price / v - 1) * 100) : null,
      slope: slopeOf(s, 10),
    };
  });
  const ma20v = maRows[0]!.value;
  const ma50v = maRows[1]!.value;
  const crossNote =
    ma20v !== null && ma50v !== null
      ? ma20v > ma50v
        ? "MA20 above MA50 (short-term structure constructive)."
        : "MA20 below MA50 (short-term structure heavy)."
      : null;

  // Entries / targets from the canonical decision, with derivations labelled.
  const entries = [
    { kind: "PREFERRED", price: d.entry, note: "Engine entry zone (structure-based)." },
    { kind: "RETEST", price: d.retestLevel, note: "Wait for a retest of the broken/tested level." },
    { kind: "BREAKOUT", price: d.daily.primaryResistance, note: "Above primary resistance with volume confirmation." },
    {
      kind: "AGGRESSIVE",
      price: d.daily.primarySupport,
      note: "At primary support — smaller size, wider invalidation risk.",
    },
  ];
  const targets = [
    { kind: "T1", price: d.target1, note: "Primary resistance / first structural objective." },
    { kind: "T2", price: d.target2, note: "Major resistance / second objective." },
    { kind: "RUNNER", price: d.runnerTarget, note: "Measured-move objective." },
    ...(fib ? fib.extensions.slice(0, 2).map((e) => ({ kind: `FIB ${e.ratio}`, price: f2(e.price) as number | null, note: "Fibonacci extension of the dominant swing." })) : []),
  ];

  // R:R combos for every entry×stop×T1 that exists.
  const rr: TechnicalReport["riskReward"] = [];
  for (const e of entries) {
    if (e.price === null) continue;
    for (const s of d.stops) {
      if (d.target1 === null) continue;
      const risk = e.price - s.price;
      const reward = d.target1 - e.price;
      if (risk <= 0 || reward <= 0) continue;
      rr.push({ combo: `${e.kind} entry / ${s.kind} stop / T1`, risk: f2(risk), reward: f2(reward), rr: f2(reward / risk) });
    }
  }

  const scenarios: TechnicalReport["scenarios"] = [
    {
      case: "BULL",
      trigger:
        d.daily.primaryResistance !== null
          ? `Daily close above ${f2(d.daily.primaryResistance)} on ≥1.3× average volume`
          : "Break of the nearest resistance on expanding volume",
      target: d.target2 !== null ? `${f2(d.target2)}${d.runnerTarget !== null ? `, runner ${f2(d.runnerTarget)}` : ""}` : "next structural resistance",
      invalidation: d.daily.primarySupport !== null ? `back below ${f2(d.daily.primarySupport)}` : "loss of the breakout level",
    },
    {
      case: "BASE",
      trigger: "No decisive break of the current range",
      target:
        d.daily.primarySupport !== null && d.daily.primaryResistance !== null
          ? `range-bound ${f2(d.daily.primarySupport)} – ${f2(d.daily.primaryResistance)}`
          : "consolidation near current levels",
      invalidation: "resolved by whichever range edge breaks first",
    },
    {
      case: "BEAR",
      trigger:
        d.daily.primarySupport !== null
          ? `Daily close below ${f2(d.daily.primarySupport)}`
          : "Loss of primary support",
      target: d.daily.majorSupport !== null ? `${f2(d.daily.majorSupport)} (major support)` : "next structural support",
      invalidation:
        d.daily.primaryResistance !== null ? `reclaim of ${f2(d.daily.primaryResistance)}` : "reclaim of the broken level",
    },
  ];

  // Overlays for the chart's EG ANALYSIS layer.
  const overlays: ReportLevel[] = [];
  const pushLevel = (price: number | null, label: string, kind: ReportLevel["kind"]) => {
    if (price !== null && Number.isFinite(price)) overlays.push({ price: f2(price), label, kind });
  };
  pushLevel(d.daily.primarySupport, "Support", "SUPPORT");
  pushLevel(d.daily.secondarySupport, "Support 2", "SUPPORT");
  pushLevel(d.daily.majorSupport, "Major support", "SUPPORT");
  pushLevel(d.daily.primaryResistance, "Resistance", "RESISTANCE");
  pushLevel(d.daily.secondaryResistance, "Resistance 2", "RESISTANCE");
  pushLevel(d.entry, "Entry", "ENTRY");
  pushLevel(d.retestLevel, "Retest", "ENTRY");
  for (const s of d.stops) pushLevel(s.price, `Stop ${s.kind}`, "STOP");
  pushLevel(d.target1, "T1", "TARGET");
  pushLevel(d.target2, "T2", "TARGET");
  pushLevel(d.runnerTarget, "Runner", "TARGET");
  for (const r of maRows) pushLevel(r.value, r.label, "MA");
  if (fib) for (const r of fib.retracements) pushLevel(r.price, `Fib ${(r.ratio * 100).toFixed(1)}%`, "FIB");

  const interpretation = (() => {
    const s = d.signal.replaceAll("_", " ");
    const parts: string[] = [`${s}.`];
    if (d.counterTrend) parts.push("Counter-trend — tactical size only.");
    if (d.entry !== null && d.stops.length && d.target1 !== null)
      parts.push(
        `Actionable plan: entry ~${f2(d.entry)}, standard stop ${f2((d.stops.find((x) => x.kind === "STANDARD") ?? d.stops[0]!).price)}, first target ${f2(d.target1)}${d.riskReward !== null ? ` (R:R ${d.riskReward})` : ""}.`,
      );
    else parts.push("No qualifying structure right now — the honest action is to wait for one of the scenario triggers.");
    return parts.join(" ");
  })();

  return {
    symbol,
    asOf: last(candles)!.date,
    timeframe,
    price: f2(price),
    structure: {
      dailyTrend: d.daily.trend,
      weeklyTrend: d.weeklyTrend,
      counterTrend: d.counterTrend,
      sequence: seq || "insufficient swings",
      trendStrengthPct: trendStrengthPct !== null ? f2(trendStrengthPct) : null,
      lines: [
        `Daily trend ${d.daily.trend.replaceAll("_", " ")}, weekly regime ${d.weeklyTrend.replaceAll("_", " ")}${d.counterTrend ? " — timeframes CONFLICT" : " — timeframes aligned"}.`,
        `Swing sequence (last ${swings.length}): ${seq || "N/A"}.`,
        trendStrengthPct !== null ? `Price ${trendStrengthPct >= 0 ? "+" : ""}${trendStrengthPct.toFixed(1)}% vs MA200.` : "MA200 not available (short history).",
      ],
    },
    levels: {
      supports: [
        ...(d.daily.primarySupport !== null ? [{ price: f2(d.daily.primarySupport), label: "primary" }] : []),
        ...(d.daily.secondarySupport !== null ? [{ price: f2(d.daily.secondarySupport), label: "secondary" }] : []),
        ...(d.daily.majorSupport !== null ? [{ price: f2(d.daily.majorSupport), label: "major" }] : []),
      ],
      resistances: [
        ...(d.daily.primaryResistance !== null ? [{ price: f2(d.daily.primaryResistance), label: "primary" }] : []),
        ...(d.daily.secondaryResistance !== null ? [{ price: f2(d.daily.secondaryResistance), label: "secondary" }] : []),
      ],
      breakoutLevel: d.daily.primaryResistance !== null ? f2(d.daily.primaryResistance) : null,
      breakdownLevel: d.daily.primarySupport !== null ? f2(d.daily.primarySupport) : null,
      lines: [
        d.daily.primarySupport !== null && d.daily.primaryResistance !== null
          ? `Working range ${f2(d.daily.primarySupport)} – ${f2(d.daily.primaryResistance)}; breakout above the top, breakdown below the bottom.`
          : "Structural levels incomplete on this history.",
      ],
    },
    movingAverages: maRows.map((r) => ({ ...r, value: r.value !== null ? f2(r.value) : null, distancePct: r.distancePct !== null ? f2(r.distancePct) : null })),
    maNotes: [crossNote].filter((x): x is string => x !== null),
    momentum: {
      rsi: rsi !== null ? f2(rsi) : null,
      rsiState,
      macd: m.macd !== null ? f2(m.macd) : null,
      macdSignal: m.signal !== null ? f2(m.signal) : null,
      macdState,
      stochK: stoch?.k !== null && stoch !== undefined ? f2(stoch.k!) : null,
      stochD: stoch?.d !== null && stoch !== undefined && stoch.d !== null ? f2(stoch.d) : null,
      divergence: div,
      lines: [
        `RSI(14) ${rsi !== null ? rsi.toFixed(0) : "N/A"} — ${rsiState}.`,
        `MACD ${macdState}.`,
        ...(div ? [div] : []),
      ],
    },
    volume: {
      avg20,
      lastVsAvg: volRatio !== null ? f2(volRatio) : null,
      state: d.volumeState,
      obvTrend,
      lines: [
        volRatio !== null ? `Last bar volume ${volRatio.toFixed(2)}× the 20-bar average (engine state: ${d.volumeState}).` : "Volume data incomplete.",
        obvTrend ? `OBV ${obvTrend.toLowerCase()} over ~20 bars — ${obvTrend === "RISING" ? "accumulation evidence" : obvTrend === "FALLING" ? "distribution evidence" : "no clear accumulation/distribution"}.` : "OBV N/A.",
      ],
    },
    volatility: {
      atr: atr !== null ? f2(atr) : null,
      atrPct: atrPct !== null ? f2(atrPct) : null,
      realizedAnnualPct: d.realizedVolAnnualPct,
      bandWidthPct: bandWidthPct !== null ? f2(bandWidthPct) : null,
      regime: volRegime,
      lines: [
        atr !== null ? `ATR(14) ${atr.toFixed(2)} (${atrPct!.toFixed(1)}% of price); realized vol ${d.realizedVolAnnualPct ?? "N/A"}% annualized.` : "ATR N/A.",
        `Volatility regime: ${volRegime}.`,
      ],
    },
    patterns: patternEvidence(candles, d),
    fibonacci: {
      available: fib !== null,
      direction: fib?.direction ?? null,
      swingHigh: fib ? { date: fib.swingHigh.date, price: f2(fib.swingHigh.price) } : null,
      swingLow: fib ? { date: fib.swingLow.date, price: f2(fib.swingLow.price) } : null,
      retracements: fib ? fib.retracements.map((r) => ({ ratio: r.ratio, price: f2(r.price) })) : [],
      extensions: fib ? fib.extensions.map((r) => ({ ratio: r.ratio, price: f2(r.price) })) : [],
      nearest: nearestFib
        ? `Nearest retracement: ${(nearestFib.ratio * 100).toFixed(1)}% at ${f2(nearestFib.price)} (${(nearestFib.dist * 100).toFixed(1)}% away).`
        : null,
    },
    entries,
    stops: d.stops,
    targets,
    riskReward: rr,
    scenarios,
    verdict: {
      signal: d.signal,
      setup: d.setup,
      score: d.score?.total ?? null,
      confidence: d.confidence,
      freshness: d.freshness,
      timeframe,
      interpretation,
    },
    overlays,
  };
}
