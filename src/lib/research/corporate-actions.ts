/**
 * Corporate actions between two 13F quarters.
 *
 * WHY THIS EXISTS: comparing share counts across quarters treats a stock split
 * as buying and a CUSIP change as a total liquidation. Both were showing up as
 * the loudest entries in a "what did funds do" ranking, and both were false:
 *
 *   KLA      482480100   implied price $1472.41 → $301.71, shares ×10
 *            A five-for-one split. The managers roughly doubled the position;
 *            the ranking reported +935%.
 *
 *   Honeywell 438516106 → 43849R105 + 438516205 at the same price
 *            A spinoff. One holding became two, and every holder appeared to
 *            have exited completely in the same quarter — which is the shape
 *            of an identifier change, not of four independent decisions.
 *
 * Everything here is derived from the filings themselves. A 13F carries value
 * and share count, and their quotient is an implied price; that is enough to
 * see a split without any corporate-actions feed.
 *
 * WHAT THIS DOES NOT DO: it does not guess. A ratio that is not close to a
 * plain split factor is treated as price movement, and a vanished CUSIP with
 * no matching successor stays an exit. The cost of over-correcting — hiding a
 * real liquidation as a "reidentification" — is worse than leaving a rare
 * artefact visible, so the tests are deliberately narrow.
 */

/** Split factors worth testing. Anything else is price movement. */
const SPLIT_FACTORS = [2, 3, 4, 5, 6, 7, 8, 10, 15, 20];

/**
 * How far the price and share ratios may sit from a split factor.
 *
 * Generous, because a split and a price move happen in the same quarter.
 * Booking's twenty-for-one arrived with the stock also down fifteen percent,
 * giving a price ratio of 23.6 against a factor of 20 — a tight band missed it
 * and reported the split as a 2,207% purchase.
 *
 * What stops the wide band admitting ordinary price moves is that BOTH ratios
 * must agree with the same factor. A stock that merely halves has a price
 * ratio of 2 and a share ratio near 1, and those cannot both be a two-for-one.
 */
const BAND = 0.4;

export interface Reading {
  shares: number;
  value: number;
}

export const impliedPrice = (r: Reading): number | null =>
  r.shares > 0 && r.value > 0 ? r.value / r.shares : null;

export interface SplitDetection {
  /** Multiply the prior share count by this to compare like with like. */
  factor: number;
  /** True when a split was recognised rather than assumed absent. */
  detected: boolean;
  ratio: number | null;
}

/**
 * Detect a split from the change in implied price.
 *
 * A split divides the price and multiplies the share count by the same factor,
 * leaving value untouched. Price alone cannot distinguish a five-for-one split
 * from an 80% fall, so the share count has to agree: both must move by the
 * same factor in opposite directions.
 */
export function detectSplit(prior: Reading, now: Reading): SplitDetection {
  const p0 = impliedPrice(prior);
  const p1 = impliedPrice(now);
  if (p0 === null || p1 === null || prior.shares <= 0 || now.shares <= 0) {
    return { factor: 1, detected: false, ratio: null };
  }

  const priceRatio = p0 / p1;
  const shareRatio = now.shares / prior.shares;

  const valueRatio = now.value / prior.value;
  const agrees = (observed: number, expected: number) =>
    expected > 0 && Math.abs(observed / expected - 1) < BAND;

  /**
   * Three conditions, and each rules out a different false positive.
   *
   *   price divided by f      — a split divides the price
   *   share count multiplied  — rules out a plain price fall, where the count
   *                             does not move at all
   *   value consistent with
   *   the implied trade       — rules out a larger factor claiming the same
   *                             price ratio. KLA's managers doubled through a
   *                             five-for-one, so shares went ×10; an eight-for-
   *                             one would imply a ×1.25 position against an
   *                             observed ×2.05 in value, and is rejected on
   *                             that alone.
   *
   * The share-count test is loose on purpose — a manager who sold into the
   * split still shows a genuine split — but not so loose that an unchanged
   * count survives it.
   */
  /**
   * Every candidate is scored and the best fit wins, rather than the first to
   * pass. Taking the first meant the search order decided the answer: a
   * ten-for-one reverse split was claimed by eight simply because eight was
   * reached earlier.
   */
  let best: { factor: number; error: number } | null = null;
  const consider = (factor: number, error: number) => {
    if (!best || error < best.error) best = { factor, error };
  };

  for (const f of SPLIT_FACTORS) {
    if (agrees(priceRatio, f) && shareRatio > f * 0.6 && agrees(valueRatio, shareRatio / f)) {
      consider(f, Math.abs(priceRatio / f - 1) + Math.abs(valueRatio / (shareRatio / f) - 1));
    }
    if (agrees(1 / priceRatio, f) && shareRatio < 1 / (f * 0.6) && agrees(valueRatio, shareRatio * f)) {
      consider(
        1 / f,
        Math.abs(1 / priceRatio / f - 1) + Math.abs(valueRatio / (shareRatio * f) - 1),
      );
    }
  }

  return best
    ? { factor: (best as { factor: number }).factor, detected: true, ratio: priceRatio }
    : { factor: 1, detected: false, ratio: priceRatio };
}

/**
 * Normalised issuer name, for spotting the same company under a new CUSIP.
 *
 * Deliberately blunt: only the leading words survive, because a spinoff often
 * renames as well as re-identifies and a strict comparison would miss it.
 */
const DROP = new Set(["inc", "corp", "co", "the", "ltd", "plc", "new", "com", "cl", "class"]);

/**
 * Filings abbreviate inconsistently — the same issuer arrives as "HONEYWELL
 * INTL INC" one quarter and "HONEYWELL INTERNATIONAL" the next. Expanded
 * before comparison, or the spinoff match finds one successor and misses the
 * other.
 */
const EXPAND: Record<string, string> = {
  intl: "international",
  natl: "national",
  amern: "american",
  amer: "american",
  finl: "financial",
  tech: "technologies",
  technol: "technologies",
  pharm: "pharmaceuticals",
  comm: "communications",
  sys: "systems",
  inds: "industries",
  indl: "industrial",
  hldgs: "holdings",
  grp: "group",
};

export function issuerKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .map((w) => EXPAND[w] ?? w)
    .filter((w) => w && !DROP.has(w))
    .slice(0, 2)
    .join(" ");
}

export interface Succession {
  /** CUSIPs that vanished. */
  from: string[];
  /** CUSIPs that appeared and carry the same issuer at a comparable price. */
  to: string[];
  issuer: string;
}

/**
 * Match disappeared CUSIPs to new ones for the same issuer.
 *
 * The price test is what keeps this honest. Two identifiers for the same
 * issuer at wildly different prices are two different securities — a
 * preferred line, a warrant, a different share class — and merging them would
 * invent a position change. Only comparable prices are treated as the same
 * holding under a new identifier.
 */
export function findSuccessions(
  prior: Map<string, { issuer: string } & Reading>,
  now: Map<string, { issuer: string } & Reading>,
): Succession[] {
  const gone = [...prior.entries()].filter(([c]) => !now.has(c));
  const fresh = [...now.entries()].filter(([c]) => !prior.has(c));
  if (gone.length === 0 || fresh.length === 0) return [];

  const freshByIssuer = new Map<string, { cusip: string; r: { issuer: string } & Reading }[]>();
  for (const [cusip, r] of fresh) {
    const k = issuerKey(r.issuer);
    freshByIssuer.set(k, [...(freshByIssuer.get(k) ?? []), { cusip, r }]);
  }

  const out: Succession[] = [];
  for (const [cusip, old] of gone) {
    const candidates = freshByIssuer.get(issuerKey(old.issuer));
    if (!candidates?.length) continue;

    const oldPrice = impliedPrice(old);
    if (oldPrice === null) continue;

    const matched = candidates.filter((c) => {
      const p = impliedPrice(c.r);
      // Within a third of the old price. A spinoff shifts value between the
      // parent and the new line, so exact agreement is not expected.
      return p !== null && Math.abs(p / oldPrice - 1) < 0.34;
    });
    if (matched.length === 0) continue;

    out.push({ from: [cusip], to: matched.map((m) => m.cusip), issuer: old.issuer });
  }

  return out;
}
