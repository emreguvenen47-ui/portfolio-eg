import "server-only";

/**
 * Which venue a symbol trades on, and whether that venue is open.
 *
 * This exists so a closed market reads as MARKET_CLOSED rather than STALE. An
 * unchanged price at 03:00 on a Sunday is correct, not a failure, and badging
 * it as stale trains the reader to ignore the badge. It also tells the fetch
 * layer when to stop asking for prices that cannot move.
 *
 * Holidays are ignored: a wrong badge on Thanksgiving is cosmetic, whereas a
 * holiday calendar rots silently.
 */

export type Venue = "US_EQUITY" | "BIST" | "FX" | "FUTURES";

/** UTC minute-of-day helpers. */
const minutes = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

const BIST_SYMBOLS = /^(XU100|BIST)$/i;
const FUTURES_SYMBOLS = /^(XAU\/USD|WTI\/USD|BRENT\/USD|XAG\/USD|US2Y|US10Y|VIX|DXY)$/i;

export function venueFor(symbol: string): Venue {
  const s = symbol.trim().toUpperCase();
  if (BIST_SYMBOLS.test(s)) return "BIST";
  if (s.includes("/")) return "FX";
  if (FUTURES_SYMBOLS.test(s)) return "FUTURES";
  return "US_EQUITY";
}

/**
 * Regular hours in UTC, widened to cover daylight-saving shifts.
 *
 *  - US equity: 09:30–16:00 ET → 13:30–21:00 UTC
 *  - BIST:      10:00–18:00 TRT (UTC+3) → 07:00–15:00 UTC
 *  - FX:        continuous Sunday 21:00 UTC → Friday 22:00 UTC
 *  - Futures:   near-continuous on weekdays; treated as FX-like
 */
export function isVenueOpen(venue: Venue, now = new Date()): boolean {
  const m = minutes(now);
  const day = now.getUTCDay();

  switch (venue) {
    case "US_EQUITY":
      return !isWeekend(now) && m >= 13 * 60 + 30 && m < 21 * 60;
    case "BIST":
      return !isWeekend(now) && m >= 7 * 60 && m < 15 * 60;
    case "FX":
    case "FUTURES":
      // Opens Sunday evening, closes Friday evening.
      if (day === 6) return false;
      if (day === 0) return m >= 21 * 60;
      if (day === 5) return m < 22 * 60;
      return true;
  }
}

export const isSymbolMarketOpen = (symbol: string, now = new Date()): boolean =>
  isVenueOpen(venueFor(symbol), now);

/** True when at least one venue we track is trading. Drives the global badge. */
export function anyMarketOpen(now = new Date()): boolean {
  return (["US_EQUITY", "BIST", "FX", "FUTURES"] as Venue[]).some((v) => isVenueOpen(v, now));
}
