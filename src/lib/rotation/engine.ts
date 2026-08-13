import "server-only";
import { cachedHistories, getHistories } from "@/lib/providers";
import { enqueue, queueDepth } from "@/lib/server/warm-queue";
import type { Candle } from "@/lib/types";
import { loadScreenerUniverse } from "@/lib/scanner/screener-universe";
import {
  FLOW_GROUPS,
  TIMEFRAMES,
  US_BENCHMARK,
  type FlowGroup,
  type Timeframe,
} from "./sectors";

/**
 * Sector rotation.
 *
 * THE CENTRAL DISTINCTION, enforced in the types rather than left to the UI:
 * nothing here observes money moving. Every figure is derived from price,
 * volume and breadth, which is evidence of *rotation in leadership*, not of
 * net capital entering a sector. Calling a relative-strength reading a "fund
 * inflow" would be inventing a measurement nobody took.
 *
 * `dataType` is a required field on every group. It reads MARKET_ROTATION_SIGNAL
 * today because no ETF creation/redemption source is configured; a real flow
 * provider would set ACTUAL_FUND_FLOW and the label changes with it.
 */

export type DataType = "ACTUAL_FUND_FLOW" | "MARKET_ROTATION_SIGNAL";

export type FlowState =
  | "STRONG ROTATION IN"
  | "ROTATION IN"
  | "NEUTRAL"
  | "ROTATION OUT"
  | "STRONG ROTATION OUT";

export interface TimeframeCell {
  timeframe: Timeframe;
  ret: number | null;
  benchmarkRet: number | null;
  /** Return less benchmark return, in percentage points. */
  relative: number | null;
  direction: "up" | "flat" | "down";
}

export interface Breadth {
  /** Constituents sampled — reported so a thin sample is visible. */
  sample: number;
  above20: number | null;
  above50: number | null;
  above200: number | null;
  advancing: number | null;
  declining: number | null;
}

/**
 * One constituent's reading, kept so a group can be opened up.
 *
 * The sector table answers "where is money rotating"; this answers "which
 * names are carrying it". Same sample as the breadth calculation — the most
 * traded members — so the two never disagree.
 */
export interface ConstituentReading {
  symbol: string;
  /** Return over the selected window. */
  ret: number | null;
  ret3m: number | null;
  /** Window return less the quarter's pace over the same span. */
  improvement: number | null;
  above50: boolean | null;
}

export interface RotationComponent {
  key: string;
  label: string;
  score: number;
  detail: string;
}

export interface GroupRotation {
  group: FlowGroup;
  dataType: DataType;
  cells: TimeframeCell[];
  breadth: Breadth;
  /** Sampled constituents behind `breadth`, for the group detail view. */
  members: ConstituentReading[];
  /** 0..100 for the selected timeframe. */
  score: number | null;
  components: RotationComponent[];
  coverage: { have: number; total: number };
  state: FlowState;
  why: string[];
  /** Regime comparison across horizons. */
  inflection: "EARLY ROTATION" | "LOSING LEADERSHIP" | null;
  relVolume: number | null;
}

const CACHE_TTL_MS = 30 * 60_000;
/**
 * A table computed while constituent history was still arriving is held only
 * briefly. Caching a half-filled breadth column for half an hour would freeze
 * a loading state into an answer.
 */
const PARTIAL_TTL_MS = 60_000;
const KEY = Symbol.for("pcc.rotation.cache");
interface RotationCacheEntry {
  at: number;
  value: GroupRotation[];
  /** True when breadth was computed before every constituent had arrived. */
  partial: boolean;
}

const cache: Map<string, RotationCacheEntry> = ((
  globalThis as unknown as Record<symbol, Map<string, RotationCacheEntry>>
)[KEY] ??= new Map());

const closes = (c: Candle[]) => c.map((x) => x.close).filter((x) => Number.isFinite(x) && x > 0);

function retOver(c: Candle[], bars: number): number | null {
  const px = closes(c);
  if (px.length <= bars) return null;
  const ref = px[px.length - 1 - bars];
  return ref > 0 ? (px.at(-1)! / ref - 1) * 100 : null;
}

const sma = (px: number[], n: number): number | null =>
  px.length < n ? null : px.slice(-n).reduce((a, b) => a + b, 0) / n;

/** Clamp a raw reading onto 0..100 between a stated bad and good level. */
const grade = (v: number | null, bad: number, good: number): number | null =>
  v === null || !Number.isFinite(v)
    ? null
    : Math.round(Math.max(0, Math.min(1, (v - bad) / (good - bad))) * 100);

/**
 * Breadth from constituents.
 *
 * Uses the most-traded names in the group rather than every constituent: one
 * batched history request per sector is affordable, several hundred is not.
 * The sample size travels with the result so a thin reading is visible rather
 * than presented as the whole sector.
 */
function computeBreadth(
  symbols: string[],
  bars: number,
  hist: Record<string, { candles?: Candle[] } | undefined>,
): { breadth: Breadth; members: ConstituentReading[] } {
  if (symbols.length === 0) {
    return {
      breadth: { sample: 0, above20: null, above50: null, above200: null, advancing: null, declining: null },
      members: [],
    };
  }

  let n = 0;
  let a20 = 0;
  let a50 = 0;
  let a200 = 0;
  let n20 = 0;
  let n50 = 0;
  let n200 = 0;
  let adv = 0;
  let dec = 0;
  const members: ConstituentReading[] = [];

  for (const s of symbols) {
    const candles = hist[s]?.candles ?? [];
    const px = closes(candles);
    if (px.length < 25) continue;
    n++;
    const last = px.at(-1)!;
    const overWindow = retOver(candles, bars);
    const over63 = retOver(candles, 63);
    members.push({
      symbol: s,
      ret: overWindow,
      ret3m: over63,
      // Improving means the short window is running ahead of the pace the
      // quarter set. Null unless both legs are known.
      improvement: overWindow !== null && over63 !== null ? overWindow - over63 / (63 / bars) : null,
      above50: (() => {
        const m = sma(px, 50);
        return m === null ? null : last > m;
      })(),
    });

    const m20 = sma(px, 20);
    if (m20 !== null) {
      n20++;
      if (last > m20) a20++;
    }
    const m50 = sma(px, 50);
    if (m50 !== null) {
      n50++;
      if (last > m50) a50++;
    }
    const m200 = sma(px, 200);
    if (m200 !== null) {
      n200++;
      if (last > m200) a200++;
    }
    if (px.length >= 2) {
      const d = px.at(-1)! / px.at(-2)! - 1;
      if (d > 0) adv++;
      else if (d < 0) dec++;
    }
  }

  const pct = (hit: number, total: number) => (total >= 5 ? (hit / total) * 100 : null);
  return {
    breadth: {
      sample: n,
      above20: pct(a20, n20),
      above50: pct(a50, n50),
      above200: pct(a200, n200),
      advancing: n >= 5 ? adv : null,
      declining: n >= 5 ? dec : null,
    },
    members,
  };
}

/** Recent traded volume against its own three-month average. */
function relativeVolume(c: Candle[]): number | null {
  const v: number[] = [];
  for (const x of c) {
    if (typeof x.volume === "number" && Number.isFinite(x.volume) && x.volume > 0) v.push(x.volume);
  }
  if (v.length < 70) return null;
  const recent = v.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const base = v.slice(-63).reduce((a, b) => a + b, 0) / 63;
  return base > 0 ? (recent / base - 1) * 100 : null;
}

function annualVol(c: Candle[]): number | null {
  const px = closes(c);
  if (px.length < 63) return null;
  const rets: number[] = [];
  for (let i = px.length - 62; i < px.length; i++) rets.push(px[i] / px[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  return Math.sqrt(varr * 252) * 100;
}

const stateFor = (score: number | null): FlowState =>
  score === null
    ? "NEUTRAL"
    : score >= 75
      ? "STRONG ROTATION IN"
      : score >= 58
        ? "ROTATION IN"
        : score <= 25
          ? "STRONG ROTATION OUT"
          : score <= 42
            ? "ROTATION OUT"
            : "NEUTRAL";

const fmtPp = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}pp`;

export async function runRotation(timeframe: Timeframe = "1W"): Promise<{
  groups: GroupRotation[];
  benchmark: string;
  timeframe: Timeframe;
  actualFlowGroups: number;
  signalGroups: number;
  /**
   * Constituent histories still arriving. While this is above zero the breadth
   * columns are incomplete and the scores that depend on them will move, so
   * the client polls rather than presenting a partial reading as settled.
   */
  warming: number;
}> {
  const hit = cache.get(timeframe);
  if (hit && Date.now() - hit.at < (hit.partial ? PARTIAL_TTL_MS : CACHE_TTL_MS)) {
    return {
      groups: hit.value,
      benchmark: US_BENCHMARK,
      timeframe,
      actualFlowGroups: hit.value.filter((g) => g.dataType === "ACTUAL_FUND_FLOW").length,
      signalGroups: hit.value.filter((g) => g.dataType === "MARKET_ROTATION_SIGNAL").length,
      warming: queueDepth("rotation"),
    };
  }

  const universe = await loadScreenerUniverse().catch(() => []);
  const proxies = [...new Set([US_BENCHMARK, ...FLOW_GROUPS.map((g) => g.proxy)])];

  /**
   * Constituents for every group are resolved before anything is fetched.
   *
   * Fetching them group by group meant twenty-one sequential round trips —
   * measured at 58.9s cold — and re-fetched the overlap, since a sub-sector's
   * members are also members of its parent sector. One batched call over the
   * union costs a single round trip and asks for each symbol once.
   */
  const memberSymbols = new Map<string, string[]>();
  for (const group of FLOW_GROUPS) {
    memberSymbols.set(
      group.id,
      universe
        .filter((r) => {
          if (r.region !== group.region) return false;
          if (group.sector && r.sector !== group.sector) return false;
          if (group.industryPattern && !(r.industry && group.industryPattern.test(r.industry))) {
            return false;
          }
          return true;
        })
        .sort((a, b) => (b.dollarVolume ?? 0) - (a.dollarVolume ?? 0))
        .slice(0, 24)
        .map((r) => r.symbol),
    );
  }
  /**
   * The proxies are the signal and are awaited; the constituents only feed
   * breadth and are not.
   *
   * Waiting for every constituent history cost 74s on a cold cache for a table
   * whose headline numbers need twenty-two series. So the matrix renders from
   * the proxies immediately, breadth reads whatever constituent history is
   * already cached, and the misses go to the background queue — the next visit
   * has them.
   */
  const proxyHist = await getHistories(proxies, 300).catch(
    () => ({}) as Awaited<ReturnType<typeof getHistories>>,
  );

  const constituents = [...new Set([...memberSymbols.values()].flat())].filter(
    (s) => !(s in proxyHist),
  );
  const { have, missing } = cachedHistories(constituents, 300);
  /**
   * Bounded per visit, and at the bottom of the queue.
   *
   * Breadth is a secondary reading on a page whose headline numbers come from
   * the proxies, so its backlog must never sit in front of the scanner and
   * screener work a user is looking at. Priority 0 puts it last — those tasks
   * carry dollar volume, which is always higher — and the slice keeps a single
   * cold visit from parking six hundred items in the queue. Coverage converges
   * over a few visits instead of one long one.
   */
  enqueue(
    missing.slice(0, 120).map((symbol) => ({
      kind: "rotation",
      symbol,
      priority: 0,
      run: () => getHistories([symbol], 300),
    })),
  );

  const hist: Record<string, { candles?: Candle[] } | undefined> = { ...have, ...proxyHist };
  const bench = hist[US_BENCHMARK]?.candles ?? [];

  const groups: GroupRotation[] = [];

  for (const group of FLOW_GROUPS) {
    const candles = hist[group.proxy]?.candles ?? [];

    const cells: TimeframeCell[] = TIMEFRAMES.map((tf) => {
      const ret = retOver(candles, tf.bars);
      const b = retOver(bench, tf.bars);
      const relative = ret !== null && b !== null ? ret - b : null;
      return {
        timeframe: tf.key,
        ret,
        benchmarkRet: b,
        relative,
        direction:
          relative === null ? "flat" : relative > 0.5 ? "up" : relative < -0.5 ? "down" : "flat",
      };
    });

    const members = memberSymbols.get(group.id) ?? [];
    const bars = TIMEFRAMES.find((t) => t.key === timeframe)!.bars;
    const { breadth, members: readings } = computeBreadth(members, bars, hist);
    const relVol = relativeVolume(candles);
    const vol = annualVol(candles);

    const cell = cells.find((c) => c.timeframe === timeframe)!;
    const shorter = cells.find((c) => c.timeframe === "1M")!;
    const longer = cells.find((c) => c.timeframe === "6M")!;
    // Acceleration: is the recent relative move stronger than the medium one?
    const accel =
      cell.relative !== null && longer.relative !== null
        ? cell.relative - longer.relative / 6
        : null;

    const components: RotationComponent[] = [];
    const add = (key: string, label: string, score: number | null, detail: string) => {
      if (score !== null) components.push({ key, label, score, detail });
    };

    add("relative", "Relative return", grade(cell.relative, -5, 5), cell.relative === null ? "" : fmtPp(cell.relative));
    add("accel", "Acceleration", grade(accel, -4, 4), accel === null ? "" : fmtPp(accel));
    add("momentum", "3M relative", grade(cells.find((c) => c.timeframe === "3M")!.relative, -10, 10),
      (() => {
        const r = cells.find((c) => c.timeframe === "3M")!.relative;
        return r === null ? "" : fmtPp(r);
      })());
    add("above50", "% above 50DMA", grade(breadth.above50, 25, 80), breadth.above50 === null ? "" : `${breadth.above50.toFixed(0)}% of ${breadth.sample}`);
    add("above200", "% above 200DMA", grade(breadth.above200, 25, 80), breadth.above200 === null ? "" : `${breadth.above200.toFixed(0)}%`);
    add("above20", "% above 20DMA", grade(breadth.above20, 25, 80), breadth.above20 === null ? "" : `${breadth.above20.toFixed(0)}%`);
    add("relvol", "Relative volume", grade(relVol, -25, 40), relVol === null ? "" : `${relVol > 0 ? "+" : ""}${relVol.toFixed(0)}% vs 3M`);
    // Lower realised volatility scores better; a sector leading on calm price
    // action is a different thing from one lurching upward.
    add("volatility", "Volatility", grade(vol, 45, 12), vol === null ? "" : `${vol.toFixed(0)}% annual`);

    // Eight possible components; missing ones leave the denominator.
    const total = 8;
    const score = components.length
      ? Math.round(components.reduce((s, c) => s + c.score, 0) / components.length)
      : null;

    const why: string[] = [];
    if (cell.relative !== null) {
      why.push(`${timeframe} relative strength ${fmtPp(cell.relative)} vs ${US_BENCHMARK}.`);
    }
    if (breadth.above50 !== null) {
      why.push(`${breadth.above50.toFixed(0)}% of ${breadth.sample} sampled constituents above their 50DMA.`);
    }
    if (breadth.above200 !== null) {
      why.push(`${breadth.above200.toFixed(0)}% above their 200DMA.`);
    }
    if (relVol !== null) {
      why.push(`Traded volume ${relVol > 0 ? "above" : "below"} its three-month average by ${Math.abs(relVol).toFixed(0)}%.`);
    }
    if (accel !== null) {
      why.push(`Relative move is ${accel > 0 ? "accelerating" : "decelerating"} against the six-month pace.`);
    }

    // Inflection: the short horizon disagreeing with the long one. Described,
    // never framed as a prediction.
    const shortRel = shorter.relative;
    const longRel = longer.relative;
    let inflection: GroupRotation["inflection"] = null;
    if (shortRel !== null && longRel !== null) {
      if (shortRel > 1 && longRel < 0 && (breadth.above50 ?? 0) > 50) inflection = "EARLY ROTATION";
      else if (shortRel < -1 && longRel > 3) inflection = "LOSING LEADERSHIP";
    }

    groups.push({
      group,
      // No ETF creation/redemption source is configured, so every group here
      // is inferred from market data. This flag is what the UI keys its label
      // off — it is never hardcoded in the view.
      dataType: "MARKET_ROTATION_SIGNAL",
      cells,
      breadth,
      members: readings,
      score,
      components,
      coverage: { have: components.length, total },
      state: stateFor(score),
      why,
      inflection,
      relVolume: relVol,
    });
  }

  groups.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  cache.set(timeframe, { at: Date.now(), value: groups, partial: missing.length > 0 });

  return {
    warming: queueDepth("rotation"),
    groups,
    benchmark: US_BENCHMARK,
    timeframe,
    actualFlowGroups: 0,
    signalGroups: groups.length,
  };
}

/**
 * Rotation map: which groups leadership is moving out of and into.
 *
 * Only emitted when the relative moves actually support it — a spread of a
 * point or two across sectors is noise, and naming it a rotation would be
 * reading a pattern into the ordinary dispersion of weekly returns.
 */
export function rotationMap(groups: GroupRotation[], timeframe: Timeframe): {
  out: GroupRotation[];
  into: GroupRotation[];
  supported: boolean;
  note: string;
} {
  const withRel: { g: GroupRotation; rel: number }[] = [];
  for (const g of groups) {
    const c = g.cells.find((x) => x.timeframe === timeframe);
    if (c && c.relative !== null && Number.isFinite(c.relative)) {
      withRel.push({ g, rel: c.relative });
    }
  }
  if (withRel.length < 6) {
    return {
      out: [],
      into: [],
      supported: false,
      note: "Not enough sectors have a comparable return series for this window.",
    };
  }

  const sorted = [...withRel].sort((a, b) => b.rel - a.rel);
  const spread = sorted[0].rel - sorted[sorted.length - 1].rel;

  if (spread < 3) {
    return {
      out: [],
      into: [],
      supported: false,
      note: `Sector dispersion over ${timeframe} is only ${spread.toFixed(1)}pp — too narrow to describe as rotation rather than ordinary noise.`,
    };
  }

  return {
    out: sorted.slice(-3).reverse().filter((x) => x.rel < 0).map((x) => x.g),
    into: sorted.slice(0, 3).filter((x) => x.rel > 0).map((x) => x.g),
    supported: true,
    note: `Leadership spread across sectors is ${spread.toFixed(1)}pp over ${timeframe}.`,
  };
}
