import type { MarketQuery } from "@/lib/providers/polymarket";

/** Category filters for the standalone Polymarket page. */
export const MARKET_CATEGORIES: { id: string; label: string; query: MarketQuery }[] = [
  { id: "trending", label: "TRENDING", query: { limit: 40 } },
  { id: "fed", label: "FED", query: { anyOf: ["fed", "fomc", "interest rate", "rate cut", "rate hike"], limit: 30 } },
  { id: "macro", label: "MACRO", query: { anyOf: ["inflation", "cpi", "recession", "gdp", "unemployment", "jobs report"], limit: 30 } },
  { id: "politics", label: "POLITICS", query: { anyOf: ["election", "president", "congress", "senate", "house", "nominee"], limit: 30 } },
  { id: "geopolitics", label: "GEOPOLITICS", query: { anyOf: ["ukraine", "russia", "israel", "iran", "china", "taiwan", "nato", "ceasefire"], limit: 30 } },
  { id: "ai", label: "AI", query: { anyOf: ["ai ", "openai", "gpt", "anthropic", "artificial intelligence", "agi"], limit: 30 } },
  { id: "energy", label: "ENERGY", query: { anyOf: ["oil", "opec", "gas", "crude", "energy"], limit: 30 } },
  { id: "china", label: "CHINA", query: { anyOf: ["china", "taiwan", "yuan", "beijing"], limit: 30 } },
];
