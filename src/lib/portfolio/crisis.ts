import type { Candle } from "@/lib/types";

/**
 * Historical crisis replay.
 *
 * Every number here comes from real closes over a real date range. Nothing is
 * modelled, extrapolated or back-filled: a position whose price history does
 * not cover the window is reported as having insufficient history, not
 * silently dropped and not proxied by something that does have history.
 *
 * That last point is the whole discipline of this module. A portfolio of
 * 2024-listed ETFs "surviving" 2008 with a −4% drawdown would be a fabricated
 * comfort, so coverage is reported as prominently as the result.
 */

export interface CrisisWindow {
  id: string;
  name: string;
  /** Inclusive ISO dates. */
  start: string;
  end: string;
  /** What happened, so the result has context. */
  note: string;
  /** Regions the episode actually hit, for the UI to group by. */
  scope: "global" | "us" | "turkey";
}

export const CRISES: CrisisWindow[] = [
  {
    id: "gfc-2008",
    name: "2008 Financial Crisis",
    start: "2007-10-09",
    end: "2009-03-09",
    note: "Peak-to-trough of the global financial crisis. S&P 500 fell roughly 57%.",
    scope: "global",
  },
  {
    id: "covid-2020",
    name: "COVID Crash",
    start: "2020-02-19",
    end: "2020-03-23",
    note: "Fastest 30%+ drawdown in S&P 500 history, over 23 trading days.",
    scope: "global",
  },
  {
    id: "q4-2018",
    name: "2018 Q4 Selloff",
    start: "2018-09-20",
    end: "2018-12-24",
    note: "Rate-hike and growth scare; S&P 500 fell about 20% into Christmas Eve.",
    scope: "us",
  },
  {
    id: "rates-2022",
    name: "2022 Rate Shock",
    start: "2022-01-03",
    end: "2022-10-12",
    note: "Inflation and rapid tightening. Stocks and long bonds fell together.",
    scope: "global",
  },
  {
    id: "banks-2023",
    name: "2023 Banking Stress",
    start: "2023-03-08",
    end: "2023-03-24",
    note: "Silicon Valley Bank failure and the Credit Suisse rescue.",
    scope: "global",
  },
  {
    id: "tr-2018",
    name: "2018 Turkey FX Crisis",
    start: "2018-08-01",
    end: "2018-09-13",
    note: "Lira fell sharply against the dollar; BIST and Turkish assets repriced.",
    scope: "turkey",
  },
  {
    id: "tr-2021",
    name: "2021 Lira Selloff",
    start: "2021-11-01",
    end: "2021-12-20",
    note: "Rate cuts into high inflation drove a disorderly lira decline.",
    scope: "turkey",
  },
  {
    id: "tr-2023",
    name: "2023 Turkey Policy Reset",
    start: "2023-05-26",
    end: "2023-08-31",
    note: "Post-election policy shift and a step change in the lira.",
    scope: "turkey",
  },
];

export interface AssetCrisisResult {
  symbol: string;
  weight: number;
  /** Null when the price history does not cover the window. */
  totalReturn: number | null;
  maxDrawdown: number | null;
  worstDay: number | null;
  /** Contribution to the portfolio result, in percentage points. */
  contribution: number | null;
  covered: boolean;
  /** First close available inside the window, for the coverage note. */
  firstDate: string | null;
}

export interface CrisisResult {
  crisis: CrisisWindow;
  /** Weight of the book that actually has history for this window, 0..1. */
  coverage: number;
  /** Portfolio figures over the covered sleeve only. */
  totalReturn: number | null;
  maxDrawdown: number | null;
  worstDay: number | null;
  /** Trading days from the trough back to the starting level, if reached. */
  recoveryDays: number | null;
  recovered: boolean;
  benchmarkReturn: number | null;
  assets: AssetCrisisResult[];
  note: string;
}

const within = (c: Candle, start: string, end: string) => c.date >= start && c.date <= end;

/** Series restricted to the window, oldest first. */
function slice(candles: Candle[], w: CrisisWindow): Candle[] {
  return candles.filter((c) => within(c, w.start, w.end)).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Does this series genuinely cover the window?
 *
 * A handful of bars at the tail end is not coverage — an asset listed two
 * weeks before the trough would post a tiny drawdown and flatter the whole
 * portfolio. Requires a close within the first 10% of the window.
 */
function covers(candles: Candle[], w: CrisisWindow): boolean {
  const s = slice(candles, w);
  if (s.length < 5) return false;
  const startMs = Date.parse(w.start);
  const endMs = Date.parse(w.end);
  const firstMs = Date.parse(s[0].date);
  return firstMs - startMs <= (endMs - startMs) * 0.1;
}

function drawdownOf(closes: number[]): number {
  let peak = closes[0];
  let worst = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = c / peak - 1;
    if (dd < worst) worst = dd;
  }
  return worst * 100;
}

function worstDayOf(closes: number[]): number {
  let worst = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) {
      const r = closes[i] / closes[i - 1] - 1;
      if (r < worst) worst = r;
    }
  }
  return worst * 100;
}

export function runCrisis(
  crisis: CrisisWindow,
  positions: { symbol: string; weight: number; candles: Candle[] }[],
  benchmark: Candle[] = [],
): CrisisResult {
  const assets: AssetCrisisResult[] = positions.map((p) => {
    const s = slice(p.candles, crisis);
    const covered = covers(p.candles, crisis);
    if (!covered) {
      return {
        symbol: p.symbol,
        weight: p.weight,
        totalReturn: null,
        maxDrawdown: null,
        worstDay: null,
        contribution: null,
        covered: false,
        firstDate: s[0]?.date ?? null,
      };
    }
    const closes = s.map((c) => c.close).filter((c) => Number.isFinite(c) && c > 0);
    const total = (closes.at(-1)! / closes[0] - 1) * 100;
    return {
      symbol: p.symbol,
      weight: p.weight,
      totalReturn: total,
      maxDrawdown: drawdownOf(closes),
      worstDay: worstDayOf(closes),
      contribution: null,
      covered: true,
      firstDate: s[0]?.date ?? null,
    };
  });

  const coveredAssets = assets.filter((a) => a.covered);
  const coveredWeight = coveredAssets.reduce((s, a) => s + a.weight, 0);

  if (coveredWeight <= 0) {
    return {
      crisis,
      coverage: 0,
      totalReturn: null,
      maxDrawdown: null,
      worstDay: null,
      recoveryDays: null,
      recovered: false,
      benchmarkReturn: null,
      assets,
      note: `No position has price history covering ${crisis.start} to ${crisis.end}.`,
    };
  }

  // Renormalise across the covered sleeve. The alternative — treating absent
  // assets as flat — would quietly report a smaller drawdown than the covered
  // holdings actually suffered.
  for (const a of coveredAssets) {
    a.contribution = ((a.weight / coveredWeight) * (a.totalReturn ?? 0));
  }

  // Rebuild a portfolio path on the union of dates, so drawdown reflects the
  // book rather than the worst single line.
  const dates = [
    ...new Set(
      positions
        .filter((p) => covers(p.candles, crisis))
        .flatMap((p) => slice(p.candles, crisis).map((c) => c.date)),
    ),
  ].sort();

  const priceAt = new Map<string, Map<string, number>>();
  for (const p of positions) {
    if (!covers(p.candles, crisis)) continue;
    priceAt.set(p.symbol, new Map(slice(p.candles, crisis).map((c) => [c.date, c.close])));
  }

  const path: number[] = [];
  const base = new Map<string, number>();
  for (const a of coveredAssets) {
    const first = priceAt.get(a.symbol)?.get(dates[0]);
    if (first) base.set(a.symbol, first);
  }

  let lastKnown = new Map<string, number>(base);
  for (const d of dates) {
    let value = 0;
    let w = 0;
    for (const a of coveredAssets) {
      const b = base.get(a.symbol);
      if (!b) continue;
      const px = priceAt.get(a.symbol)?.get(d) ?? lastKnown.get(a.symbol);
      if (px === undefined) continue;
      lastKnown.set(a.symbol, px);
      value += (a.weight / coveredWeight) * (px / b);
      w += a.weight / coveredWeight;
    }
    if (w > 0) path.push(value / w);
  }

  const totalReturn = path.length >= 2 ? (path.at(-1)! / path[0] - 1) * 100 : null;
  const maxDrawdown = path.length >= 2 ? drawdownOf(path) : null;
  const worstDay = path.length >= 2 ? worstDayOf(path) : null;

  // Recovery: trading days from the trough back to the starting level. Only
  // answerable within the window we have, so "not yet" is a real answer.
  let recoveryDays: number | null = null;
  let recovered = false;
  if (path.length >= 2) {
    let troughIdx = 0;
    let peak = path[0];
    let worst = 0;
    for (let i = 0; i < path.length; i++) {
      if (path[i] > peak) peak = path[i];
      const dd = path[i] / peak - 1;
      if (dd < worst) {
        worst = dd;
        troughIdx = i;
      }
    }
    for (let i = troughIdx; i < path.length; i++) {
      if (path[i] >= path[0]) {
        recoveryDays = i - troughIdx;
        recovered = true;
        break;
      }
    }
  }

  const bm = slice(benchmark, crisis).map((c) => c.close).filter((c) => c > 0);
  const benchmarkReturn = bm.length >= 2 ? (bm.at(-1)! / bm[0] - 1) * 100 : null;

  const missing = assets.filter((a) => !a.covered);
  return {
    crisis,
    coverage: coveredWeight,
    totalReturn,
    maxDrawdown,
    worstDay,
    recoveryDays,
    recovered,
    benchmarkReturn,
    assets,
    note: missing.length
      ? `${(coveredWeight * 100).toFixed(0)}% of the book has price history for this window. ${missing.length} position${missing.length === 1 ? "" : "s"} did not exist or lack data and are excluded — the result describes the covered sleeve only.`
      : "Every position has price history covering this window.",
  };
}
