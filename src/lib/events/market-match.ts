import type { EventKind } from "./playbook";
import type { MarketMatcher } from "@/lib/providers/polymarket";

/**
 * Which Polymarket question counts as "this event".
 *
 * Strict by design. Every term in `allOf` must appear in the market's own
 * question text, and `noneOf` rules out the near-misses that would otherwise
 * match — a market about the ECB is one word away from a market about the Fed,
 * and attaching the wrong one would put a confident, wrong number next to real
 * data.
 *
 * When nothing matches, the panel says N/A. That is the correct outcome, not a
 * failure to try hard enough.
 */
export const MARKET_MATCHERS: Record<EventKind, MarketMatcher> = {
  FOMC: { allOf: ["fed", "rate"], noneOf: ["ecb", "boe", "boj", "turkey"] },
  US_CPI: { allOf: ["inflation"], noneOf: ["turkey", "euro", "uk"] },
  US_PCE: { allOf: ["pce"] },
  US_NFP: { allOf: ["jobs"], noneOf: ["turkey", "euro"] },
  US_GDP: { allOf: ["gdp"], noneOf: ["turkey", "china", "euro"] },
  ECB: { allOf: ["ecb"] },
  TCMB: { allOf: ["turkey", "rate"] },
  TR_CPI: { allOf: ["turkey", "inflation"] },
  EARNINGS: { allOf: ["earnings"] },
};
