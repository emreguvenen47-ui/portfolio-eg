import type { EventKind, Importance } from "./playbook";

/**
 * Macro event schedule.
 *
 * The configured data plan has no economic calendar, so recurring events are
 * derived from their published release rules rather than guessed: NFP is the
 * first Friday, US CPI is mid-month, PCE is late month, TCMB and TR CPI follow
 * their own fixed cadence. FOMC dates are the Fed's own published 2026
 * schedule.
 *
 * Consensus, previous prints and market-implied probabilities are NOT derived
 * — there is no honest way to compute them here, so they stay null and render
 * as N/A.
 */

export interface CalendarEvent {
  id: string;
  kind: EventKind;
  title: string;
  /** yyyy-mm-dd, in the releasing venue's local convention. */
  date: string;
  importance: Importance;
  /** Where the schedule came from, shown in the UI. */
  source: string;
  previous: number | null;
  consensus: number | null;
  actual: number | null;
}

/** Fed's published 2026 FOMC meeting end-dates. */
const FOMC_2026 = [
  "2026-01-28",
  "2026-03-18",
  "2026-04-29",
  "2026-06-17",
  "2026-07-29",
  "2026-09-16",
  "2026-11-04",
  "2026-12-16",
];

/** ECB Governing Council monetary-policy meeting dates for 2026. */
const ECB_2026 = [
  "2026-02-05",
  "2026-03-19",
  "2026-04-30",
  "2026-06-11",
  "2026-07-23",
  "2026-09-10",
  "2026-10-29",
  "2026-12-17",
];

/** TCMB rate-setting committee dates for 2026. */
const TCMB_2026 = [
  "2026-01-22",
  "2026-03-12",
  "2026-04-23",
  "2026-06-11",
  "2026-07-23",
  "2026-09-11",
  "2026-10-22",
  "2026-12-11",
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** First Friday of the given month — the BLS payrolls rule. */
function firstFriday(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 1));
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
}

/** Nth weekday of a month, used for the mid-month CPI window. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const d = new Date(Date.UTC(year, month, 1));
  let count = 0;
  while (true) {
    if (d.getUTCDay() === weekday) {
      count++;
      if (count === n) return iso(d);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

/** Last business day of a month — the PCE release window. */
function lastBusinessDay(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month + 1, 0));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return iso(d);
}

const EMPTY = { previous: null, consensus: null, actual: null };

/**
 * Events in a window around today. Past events are included so the UI can
 * switch them from UPCOMING to EVENT REVIEW.
 */
export function buildCalendar(monthsBack = 3, monthsForward = 3): CalendarEvent[] {
  const now = new Date();
  const out: CalendarEvent[] = [];

  for (let offset = -monthsBack; offset <= monthsForward; offset++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();

    out.push({
      id: `nfp-${y}-${m}`,
      kind: "US_NFP",
      title: "US Nonfarm Payrolls",
      date: firstFriday(y, m),
      importance: "HIGH",
      source: "BLS release rule — first Friday",
      ...EMPTY,
    });
    out.push({
      id: `cpi-${y}-${m}`,
      kind: "US_CPI",
      title: "US CPI",
      date: nthWeekday(y, m, 2, 2), // second Tuesday, the usual BLS window
      importance: "HIGH",
      source: "BLS release window — mid-month",
      ...EMPTY,
    });
    out.push({
      id: `pce-${y}-${m}`,
      kind: "US_PCE",
      title: "US PCE",
      date: lastBusinessDay(y, m),
      importance: "MEDIUM",
      source: "BEA release window — month end",
      ...EMPTY,
    });
    out.push({
      id: `trcpi-${y}-${m}`,
      kind: "TR_CPI",
      title: "Turkey CPI",
      date: iso(new Date(Date.UTC(y, m, 3))),
      importance: "HIGH",
      source: "TurkStat release rule — 3rd of the month",
      ...EMPTY,
    });
  }

  const fixed: [string[], EventKind, string, Importance, string][] = [
    [FOMC_2026, "FOMC", "FOMC rate decision", "HIGH", "Federal Reserve published 2026 schedule"],
    [ECB_2026, "ECB", "ECB rate decision", "MEDIUM", "ECB published 2026 schedule"],
    [TCMB_2026, "TCMB", "TCMB rate decision", "HIGH", "TCMB published 2026 schedule"],
  ];
  for (const [dates, kind, title, importance, source] of fixed) {
    for (const date of dates) {
      out.push({ id: `${kind}-${date}`, kind, title, date, importance, source, ...EMPTY });
    }
  }

  const from = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1)));
  const to = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsForward + 1, 0)));

  return out
    .filter((e) => e.date >= from && e.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ------------------------------------------------------- historical study

export interface EventReaction {
  date: string;
  /** Asset key -> percentage move over each horizon. */
  moves: Record<string, { d1: number | null; w1: number | null; m1: number | null }>;
}

export interface EventStudy {
  events: EventReaction[];
  /** Median move per asset per horizon across the sampled events. */
  median: Record<string, { d1: number | null; w1: number | null; m1: number | null }>;
  positive: Record<string, number>;
  total: number;
}

function pctAfter(
  closes: { date: string; close: number }[],
  eventDate: string,
  sessions: number,
): number | null {
  const i = closes.findIndex((c) => c.date >= eventDate);
  if (i < 0) return null;
  const base = closes[i]?.close;
  const then = closes[Math.min(i + sessions, closes.length - 1)]?.close;
  if (!base || !then || base <= 0) return null;
  // Refuse to report a horizon the data does not actually cover.
  if (i + sessions > closes.length - 1) return null;
  return (then / base - 1) * 100;
}

const median = (xs: number[]): number | null => {
  const ok = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (ok.length === 0) return null;
  const mid = Math.floor(ok.length / 2);
  return ok.length % 2 ? ok[mid] : (ok[mid - 1] + ok[mid]) / 2;
};

/**
 * Measure what actually happened around past occurrences of an event.
 *
 * Uses only real candles. Horizons that run past the end of the series are
 * reported as null rather than clipped to the last available bar, which would
 * silently understate a one-month move.
 */
export function runEventStudy(
  eventDates: string[],
  series: Record<string, { date: string; close: number }[]>,
): EventStudy {
  const keys = Object.keys(series);
  const events: EventReaction[] = [];

  for (const date of eventDates) {
    const moves: EventReaction["moves"] = {};
    let any = false;
    for (const k of keys) {
      const d1 = pctAfter(series[k], date, 1);
      const w1 = pctAfter(series[k], date, 5);
      const m1 = pctAfter(series[k], date, 21);
      moves[k] = { d1, w1, m1 };
      if (d1 !== null || w1 !== null || m1 !== null) any = true;
    }
    if (any) events.push({ date, moves });
  }

  const medianOut: EventStudy["median"] = {};
  const positive: Record<string, number> = {};
  for (const k of keys) {
    medianOut[k] = {
      d1: median(events.map((e) => e.moves[k]?.d1).filter((x): x is number => x !== null)),
      w1: median(events.map((e) => e.moves[k]?.w1).filter((x): x is number => x !== null)),
      m1: median(events.map((e) => e.moves[k]?.m1).filter((x): x is number => x !== null)),
    };
    positive[k] = events.filter((e) => (e.moves[k]?.m1 ?? 0) > 0).length;
  }

  return { events, median: medianOut, positive, total: events.length };
}
