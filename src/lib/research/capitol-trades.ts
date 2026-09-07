import "server-only";
import type { CongressSource, CongressTrade } from "./alt-data";

/**
 * CAPITOL TRADES source — congressional trading disclosures from the same
 * public backend capitoltrades.com's own site reads (approach adapted from
 * MIT-licensed mcp-capitol-trades; reimplemented against the JSON backend
 * rather than scraping rendered HTML).
 *
 * Reachability is environment-dependent: the backend sits behind CloudFront
 * and refuses some networks outright (verified 503/429 from this development
 * machine). The source therefore fails SOFT — an unreachable backend yields
 * an empty list and the page keeps its honest blocker; it never fabricates
 * rows and never breaks the page.
 */

const BFF = "https://bff.capitoltrades.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TIMEOUT_MS = 10_000;
const TTL_MS = 30 * 60_000; // disclosures are lagged by law; 30m is plenty

const KEY = Symbol.for("pcc.capitoltrades");
const cache: Map<string, { at: number; rows: CongressTrade[] }> = ((
  globalThis as unknown as Record<symbol, Map<string, { at: number; rows: CongressTrade[] }>>
)[KEY] ??= new Map());

interface BffTrade {
  txDate?: string;
  pubDate?: string;
  txType?: string;
  value?: number | null;
  size?: string | null;
  politician?: { firstName?: string; lastName?: string; chamber?: string };
  issuer?: { issuerTicker?: string | null };
}

/** Capitol Trades publishes ranges as "1K–15K" style size buckets. */
function sizeToRange(size: string | null | undefined, value: number | null | undefined): [number | null, number | null] {
  if (typeof value === "number" && Number.isFinite(value)) return [value, value];
  if (!size) return [null, null];
  const num = (t: string): number | null => {
    const m = /^([\d.]+)([KM]?)$/i.exec(t.trim());
    if (!m) return null;
    const base = Number(m[1]);
    return m[2]?.toUpperCase() === "M" ? base * 1e6 : m[2]?.toUpperCase() === "K" ? base * 1e3 : base;
  };
  const parts = size.split(/[–\-]/);
  return [num(parts[0] ?? "") ?? null, num(parts[1] ?? parts[0] ?? "") ?? null];
}

async function fetchTrades(ticker: string): Promise<CongressTrade[]> {
  const key = ticker || "__all__";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ per_page: "60", page: "1" });
    if (ticker) params.set("ticker", `${ticker.toUpperCase()}:US`);
    const res = await fetch(`${BFF}/trades?${params}`, {
      signal: ctl.signal,
      cache: "no-store",
      headers: {
        "user-agent": UA,
        accept: "application/json",
        origin: "https://www.capitoltrades.com",
        referer: "https://www.capitoltrades.com/",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data?: BffTrade[] };
    const rows: CongressTrade[] = (json.data ?? [])
      .map((t) => {
        const side = (t.txType ?? "").toLowerCase();
        const [lo, hi] = sizeToRange(t.size, t.value);
        return {
          politician: [t.politician?.firstName, t.politician?.lastName].filter(Boolean).join(" ") || "Unknown",
          chamber: (t.politician?.chamber ?? "").toLowerCase().startsWith("sen") ? ("Senate" as const) : ("House" as const),
          ticker: t.issuer?.issuerTicker?.split(":")[0] ?? "",
          side: side === "sell" ? ("SELL" as const) : ("BUY" as const),
          transactionDate: t.txDate ?? "",
          disclosureDate: t.pubDate?.slice(0, 10) ?? "",
          valueLow: lo,
          valueHigh: hi,
        };
      })
      .filter((r) => r.ticker && r.transactionDate && (side_ok(r.side)));
    cache.set(key, { at: Date.now(), rows });
    return rows;
  } catch {
    cache.set(key, { at: Date.now(), rows: hit?.rows ?? [] });
    return hit?.rows ?? [];
  } finally {
    clearTimeout(timer);
  }
}

const side_ok = (s: string) => s === "BUY" || s === "SELL";

export const capitolTradesSource: CongressSource = {
  name: "capitol-trades",
  trades: fetchTrades,
};
