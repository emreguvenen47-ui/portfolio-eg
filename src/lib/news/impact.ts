import type { PositionValuation } from "@/lib/types";
import type { RawArticle } from "./sources";

/**
 * Ties headlines to holdings and reports what those holdings ACTUALLY did.
 *
 * The direction shown to the user is never inferred from the text. Matching a
 * story to a position is a keyword judgement and is labelled as such; the
 * number beside it is the position's measured move and its weight-scaled P&L,
 * which is a fact. That split is deliberate — a sentiment guess dressed up as
 * a percentage would be the most misleading thing this panel could do.
 */

export type MatchReason = "ticker" | "holding-feed" | "theme" | "macro";

export interface NewsImpactRow {
  code: string;
  /** Why this headline was attached to this position. */
  reason: MatchReason;
  /** What matched, for display ("copper", "NVDA", ...). */
  matched: string;
  /** The position's real move today, in percent. Null when unpriced. */
  dailyPct: number | null;
  /** That move scaled by position size, in USD. */
  dailyPnl: number | null;
  /** Portfolio weight, 0..1. */
  weight: number;
}

/** Filter buckets shown above the feed. An item can sit in several. */
export type NewsCategory =
  | "Portfolio"
  | "US Markets"
  | "Technology / AI"
  | "Europe"
  | "China / EM"
  | "Commodities"
  | "Macro";

export const NEWS_CATEGORIES: NewsCategory[] = [
  "Portfolio",
  "US Markets",
  "Technology / AI",
  "Europe",
  "China / EM",
  "Commodities",
  "Macro",
];

export interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  /** Provider-tagged ticker, when the story came from a per-symbol feed. */
  ticker?: string;
  categories: NewsCategory[];
  impacts: NewsImpactRow[];
  /** Sum of `dailyPnl` across impacts — today's move in the touched sleeve. */
  netPnl: number;
  /** Same, as a share of total portfolio value. */
  netPct: number;
}

/**
 * Keyword sets per holding. Kept explicit rather than derived: a wrong match
 * here shows the user a headline next to an unrelated position, so the cost of
 * being clever is higher than the cost of a table someone can read and correct.
 */
const KEYWORDS: Record<string, string[]> = {
  SMH: [
    "semiconductor",
    "chip",
    "chipmaker",
    "nvidia",
    "tsmc",
    "amd",
    "asml",
    "micron",
    "broadcom",
    "foundry",
    "wafer",
  ],
  QQQ: [
    "nasdaq",
    "megacap",
    "mega-cap",
    "big tech",
    "apple",
    "microsoft",
    "alphabet",
    "amazon",
    "meta",
    "nvidia",
    "artificial intelligence",
  ],
  // "wall street" is deliberately absent: it appears in a third of financial
  // headlines and says nothing about equal-weight US equity in particular.
  RSP: ["s&p 500", "equal weight", "market breadth"],
  XLI: [
    "industrial",
    "manufactur",
    "factory",
    "capex",
    "infrastructure",
    "electrification",
    "power grid",
  ],
  VGK: ["europe", "european", "ecb", "eurozone", "euro area", "germany", "france"],
  KWEB: ["china", "chinese", "beijing", "alibaba", "tencent", "hong kong", "hang seng"],
  EMXC: ["emerging market", "emerging-market", "india", "brazil", "korea", "taiwan"],
  GLDM: ["gold", "bullion", "precious metal", "safe haven", "safe-haven"],
  CPER: ["copper", "base metal", "industrial metal", "mining", "smelter"],
  SGOV: ["treasury bill", "t-bill", "money market", "short-term rate", "front end"],
  BIST: ["turkey", "turkish", "istanbul", "bist", "lira", "cbrt", "erdogan"],
  PPF: ["turkey", "turkish", "lira", "cbrt", "turkish central bank"],
};

/** Macro stories move the whole book, so they attach to every priced holding. */
const MACRO_KEYWORDS = [
  "federal reserve",
  "the fed",
  "fomc",
  "interest rate",
  "rate cut",
  "rate hike",
  "inflation",
  "cpi",
  "pce",
  "jobs report",
  "payroll",
  "jobless claims",
  "recession",
  "tariff",
  "trade war",
  "treasury yield",
  "bond yield",
  "dollar index",
  "gdp",
];

/**
 * Category keywords, matched against the headline only (same reasoning as the
 * theme matcher below: summaries produce too many incidental hits).
 *
 * "Portfolio" is not keyword-driven — an item earns it by touching a holding,
 * which is a fact rather than a guess.
 */
const CATEGORY_KEYWORDS: Record<Exclude<NewsCategory, "Portfolio">, string[]> = {
  "US Markets": [
    "s&p 500",
    "nasdaq",
    "dow",
    "wall street",
    "u.s. stocks",
    "us stocks",
    "russell",
    "earnings",
    "ipo",
    "buyback",
  ],
  "Technology / AI": [
    "artificial intelligence",
    "chip",
    "chipmaker",
    "semiconductor",
    "nvidia",
    "openai",
    "anthropic",
    "data center",
    "datacenter",
    "cloud",
    "software",
    "apple",
    "microsoft",
    "alphabet",
    "amazon",
    "meta",
  ],
  Europe: ["europe", "european", "ecb", "eurozone", "euro area", "germany", "france", "uk", "britain"],
  "China / EM": [
    "china",
    "chinese",
    "beijing",
    "hong kong",
    "emerging market",
    "india",
    "brazil",
    "taiwan",
    "korea",
    "turkey",
    "turkish",
  ],
  Commodities: [
    "oil",
    "crude",
    "opec",
    "gold",
    "bullion",
    "copper",
    "metal",
    "natural gas",
    "commodity",
    "wheat",
  ],
  Macro: [
    "federal reserve",
    "the fed",
    "fomc",
    "interest rate",
    "rate cut",
    "rate hike",
    "inflation",
    "cpi",
    "pce",
    "jobs report",
    "payroll",
    "jobless claims",
    "recession",
    "tariff",
    "trade war",
    "treasury yield",
    "bond yield",
    "gdp",
    "central bank",
  ],
};

/** Word-boundary match, so "AI" does not fire on "said" and "V" on everything. */
function mentions(haystack: string, needle: string): boolean {
  if (needle.startsWith(" ") || needle.endsWith(" ")) return haystack.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

function impactRow(row: PositionValuation, reason: MatchReason, matched: string): NewsImpactRow {
  const priced = row.quote !== null;
  return {
    code: row.position.code,
    reason,
    matched,
    // `PositionValuation.dailyPct` is a fraction; this API speaks percent.
    dailyPct: priced ? row.dailyPct * 100 : null,
    dailyPnl: priced ? row.dailyPnl : null,
    weight: row.currentWeight,
  };
}

/**
 * Attach holdings to each article and score it by what those holdings did.
 *
 * Articles that touch nothing in the portfolio are dropped: this panel exists
 * to answer "does this affect me", not to be a news reader.
 */
export function attachImpacts(
  articles: RawArticle[],
  rows: PositionValuation[],
  totalValue: number,
): NewsItem[] {
  const byCode = new Map(rows.map((r) => [r.position.code.toUpperCase(), r]));
  const bySymbol = new Map(
    rows
      .filter((r) => r.position.symbol)
      .map((r) => [r.position.symbol!.toUpperCase(), r] as const),
  );

  const out: NewsItem[] = [];

  for (const a of articles) {
    // Tickers may be matched anywhere, but themes and macro terms are matched
    // against the HEADLINE only. Summaries are long enough that an incidental
    // mention ("...its European launch site...") would attach a space-industry
    // story to a European equity sleeve.
    const text = `${a.headline} ${a.summary}`;
    const title = a.headline;
    const hits = new Map<string, NewsImpactRow>();

    // 1. The provider tagged the story with a symbol we hold. Strongest signal.
    if (a.taggedSymbol) {
      const row = bySymbol.get(a.taggedSymbol.toUpperCase());
      if (row) {
        hits.set(row.position.code, impactRow(row, "holding-feed", a.taggedSymbol));
      }
    }

    // 2. The holding's own ticker appears in the text.
    for (const [symbol, row] of bySymbol) {
      if (hits.has(row.position.code)) continue;
      if (mentions(text, symbol)) hits.set(row.position.code, impactRow(row, "ticker", symbol));
    }

    // 3. Theme keywords for that specific holding.
    for (const [code, words] of Object.entries(KEYWORDS)) {
      const row = byCode.get(code);
      if (!row || hits.has(row.position.code)) continue;
      const matched = words.find((w) => mentions(title, w));
      if (matched) hits.set(row.position.code, impactRow(row, "theme", matched.trim()));
    }

    // 4. Macro. Only applied when nothing more specific matched, so a Nvidia
    //    story does not get flagged as moving the entire book.
    if (hits.size === 0) {
      const macro = MACRO_KEYWORDS.find((w) => mentions(title, w));
      if (macro) {
        for (const row of rows) {
          if (row.quote) hits.set(row.position.code, impactRow(row, "macro", macro));
        }
      }
    }

    const impacts = [...hits.values()].sort(
      (x, y) => Math.abs(y.dailyPnl ?? 0) - Math.abs(x.dailyPnl ?? 0),
    );
    const netPnl = impacts.reduce((s, i) => s + (i.dailyPnl ?? 0), 0);

    // "Portfolio" is earned by touching a holding, not by matching a word.
    const categories: NewsCategory[] = impacts.length ? ["Portfolio"] : [];
    for (const [name, words] of Object.entries(CATEGORY_KEYWORDS)) {
      if (words.some((w) => mentions(title, w))) categories.push(name as NewsCategory);
    }

    // A story in no bucket at all is noise for this reader — drop it. Stories
    // that only match a market bucket are kept: the /news page is a filterable
    // feed, not just a portfolio-impact list.
    if (categories.length === 0) continue;

    out.push({
      id: a.id,
      headline: a.headline,
      summary: a.summary.slice(0, 280),
      source: a.source,
      url: a.url,
      publishedAt: a.publishedAt,
      ticker: a.taggedSymbol,
      categories,
      impacts,
      netPnl,
      netPct: totalValue > 0 ? (netPnl / totalValue) * 100 : 0,
    });
  }

  return out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
