/**
 * News Intelligence — deterministic classifier (master spec §17).
 *
 * Keyword-rule classification; the LLM may later EXPLAIN a story, but the
 * category/impact/sentiment tags come from here so they are reproducible and
 * free. News maps to assumption hints, never directly to fair-value deltas.
 */

export type NewsCategory =
  | "EARNINGS_GUIDANCE"
  | "PRODUCT"
  | "M_A"
  | "REGULATION"
  | "LAWSUIT"
  | "MANAGEMENT"
  | "CONTRACT_ORDER"
  | "CAPEX"
  | "SUPPLY_CHAIN"
  | "MACRO"
  | "COMPETITOR"
  | "ANALYST_ACTION"
  | "OTHER";

export interface ClassifiedNews {
  title: string;
  date: string;
  url: string;
  source: string | null;
  category: NewsCategory;
  sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  impact: "HIGH" | "MEDIUM" | "LOW";
  valuationRelevant: boolean;
  /** Which model assumption this story plausibly touches. */
  assumptionHint: string | null;
  /** Provider-supplied lead text, trimmed. Null when absent. */
  summary?: string | null;
}

const CATEGORY_RULES: Array<[NewsCategory, RegExp]> = [
  ["EARNINGS_GUIDANCE", /\b(earnings|eps|guidance|outlook|quarter(ly)? results|forecast raise|forecast cut|revenue beat|misses|beats)\b/i],
  ["M_A", /\b(acquir\w*|merger|takeover|buyout|deal to buy|acquisition)\b/i],
  ["ANALYST_ACTION", /\b(upgrade\w*|downgrade\w*|price target|initiat\w* coverage|overweight|underweight|reiterat\w*)\b/i],
  ["LAWSUIT", /\b(lawsuit|sues?|litigation|settle(ment|s)?|court|antitrust probe)\b/i],
  ["REGULATION", /\b(regulat\w*|sec probe|ftc|doj|export control|tariff|sanction\w*|ban)\b/i],
  ["MANAGEMENT", /\b(ceo|cfo|resign\w*|appoint\w*|steps down|names new|executive)\b/i],
  ["CONTRACT_ORDER", /\b(contract|order[s]? worth|wins deal|awarded|supply agreement|partnership)\b/i],
  ["CAPEX", /\b(capex|capital spending|new (plant|fab|factory)|expansion|investment plan|datacenter build)\b/i],
  ["SUPPLY_CHAIN", /\b(supply|shortage|inventory|capacity constraint|production halt)\b/i],
  ["PRODUCT", /\b(launch\w*|unveil\w*|new (chip|product|model|service)|releases)\b/i],
  ["MACRO", /\b(fed|inflation|cpi|rates?|recession|gdp|macro|treasury yields)\b/i],
  ["COMPETITOR", /\b(rival\w*|competitor\w*|market share battle)\b/i],
];

const POSITIVE = /\b(beat|beats|record|surge\w*|raise[sd]?|upgrade[sd]?|wins?|strong|tops|above expectations|accelerat\w*|expand\w*)\b/i;
const NEGATIVE = /\b(miss|misses|cut[s]?|downgrade[sd]?|falls?|weak\w*|probe|lawsuit|recall\w*|halt\w*|slump\w*|below expectations|warns?|layoff\w*)\b/i;

const HIGH_IMPACT: NewsCategory[] = ["EARNINGS_GUIDANCE", "M_A", "REGULATION"];
const MEDIUM_IMPACT: NewsCategory[] = ["ANALYST_ACTION", "CONTRACT_ORDER", "LAWSUIT", "MANAGEMENT", "CAPEX"];

const ASSUMPTION_HINT: Partial<Record<NewsCategory, string>> = {
  EARNINGS_GUIDANCE: "Forward EPS / revenue assumptions",
  M_A: "Share count / net debt / strategic value",
  CONTRACT_ORDER: "Revenue growth assumption",
  CAPEX: "Capex and FCF margin assumptions",
  SUPPLY_CHAIN: "Gross margin assumption",
  REGULATION: "Risk premium / addressable market",
  ANALYST_ACTION: "Street consensus inputs",
  LAWSUIT: "Contingent liability / risk premium",
};

export function classifyNews(item: {
  title: string;
  date: string;
  url: string;
  source?: string | null;
}): ClassifiedNews {
  const text = item.title;
  let category: NewsCategory = "OTHER";
  for (const [cat, re] of CATEGORY_RULES) {
    if (re.test(text)) {
      category = cat;
      break;
    }
  }
  const pos = POSITIVE.test(text);
  const neg = NEGATIVE.test(text);
  const sentiment = pos && !neg ? "POSITIVE" : neg && !pos ? "NEGATIVE" : "NEUTRAL";
  const impact = HIGH_IMPACT.includes(category)
    ? "HIGH"
    : MEDIUM_IMPACT.includes(category)
      ? "MEDIUM"
      : "LOW";
  return {
    title: item.title,
    date: item.date,
    url: item.url,
    source: item.source ?? null,
    category,
    sentiment,
    impact,
    valuationRelevant: category in ASSUMPTION_HINT,
    assumptionHint: ASSUMPTION_HINT[category] ?? null,
  };
}

/** Cluster near-duplicate headlines (same story from many outlets). */
export function dedupeNews<T extends { title: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const key = it.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).slice(0, 6).join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}
