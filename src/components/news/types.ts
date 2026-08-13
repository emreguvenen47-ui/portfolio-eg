export type NewsCategory =
  | "Portfolio"
  | "US Markets"
  | "Technology / AI"
  | "Europe"
  | "China / EM"
  | "Commodities"
  | "Macro";

export interface ImpactRow {
  code: string;
  reason: "ticker" | "holding-feed" | "theme" | "macro";
  matched: string;
  dailyPct: number | null;
  dailyPnl: number | null;
  weight: number;
}

export interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  ticker?: string;
  categories: NewsCategory[];
  impacts: ImpactRow[];
  netPnl: number;
  netPct: number;
}

export interface NewsPayload {
  items: NewsItem[];
  scanned: number;
  categories: NewsCategory[];
  sources: string[];
  errors: string[];
  companyNews: boolean;
  aiConfigured: boolean;
  refreshMs: number;
  updatedAt: string;
}

export interface NewsAnalysis {
  stance: "bullish" | "bearish" | "neutral";
  confidence: "low" | "medium" | "high";
  whyItMatters: string;
  affected: { code: string; direction: "positive" | "negative" | "unclear"; note: string }[];
  secondOrder: string[];
}

export function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
