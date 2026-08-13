import { NextResponse } from "next/server";
import { finnhubKey } from "@/lib/providers/finnhub";
import { searchBist, bistListing, registerBistTickers } from "@/lib/providers/bist";
import { loadBistUniverse, searchUniverse } from "@/lib/providers/bist-universe";

export const dynamic = "force-dynamic";

/**
 * Symbol search by ticker or company name.
 *
 * Finnhub's search endpoint covers the whole US listed universe, so this is
 * not limited to holdings — any S&P 500 name or listed ETF resolves. Results
 * are cached per query because the mapping from "apple" to AAPL does not
 * change between keystrokes, let alone between sessions.
 *
 * Borsa İstanbul is matched locally against the curated BIST universe and
 * placed first: Finnhub does not carry Istanbul listings on this plan, so a
 * user typing THYAO would otherwise get nothing.
 */

const CACHE_TTL_MS = 60 * 60_000;
const CACHE_KEY = Symbol.for("pcc.search.cache");
const cache: Map<string, { at: number; results: SearchResult[] }> = ((
  globalThis as unknown as Record<symbol, Map<string, { at: number; results: SearchResult[] }>>
)[CACHE_KEY] ??= new Map());

export interface SearchResult {
  symbol: string;
  description: string;
  type: string;
  /** Coarse instrument class, so the picker can label each row. */
  kind: "US STOCK" | "BIST" | "ETF" | "INDEX";
}

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 1) return NextResponse.json({ results: [] });

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({ results: hit.results, cached: true });
  }

  // Full exchange listing, cached weekly. The curated entries still win on a
  // tie because they carry a clean display name and the bank flag.
  const universe = await loadBistUniverse().catch(() => []);
  if (universe.length) registerBistTickers(universe.map((u) => u.ticker));

  const curated = searchBist(q).map((b) => ({
    symbol: b.symbol,
    description: b.name,
    type: b.sector,
    kind: "BIST" as const,
  }));
  const seen = new Set(curated.map((c) => c.symbol));
  const discovered = searchUniverse(universe, q, 10)
    .filter((u) => !seen.has(u.ticker))
    .map((u) => ({
      symbol: u.ticker,
      description: u.companyName,
      type: u.instrumentType,
      kind: "BIST" as const,
    }));
  const bist: SearchResult[] = [...curated, ...discovered].slice(0, 10);

  const token = finnhubKey();
  if (!token) {
    // BIST search is local, so it still works with no Finnhub key at all.
    return NextResponse.json(
      bist.length
        ? { results: bist }
        : { results: [], error: "Symbol search needs FINNHUB_API_KEY" },
      { status: 200 },
    );
  }

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&exchange=US&token=${token}`,
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      result?: { symbol?: string; description?: string; displaySymbol?: string; type?: string }[];
    };

    const results: SearchResult[] = (json.result ?? [])
      // Drop the noisy non-US-listing variants Finnhub returns alongside the
      // primary line (AAPL.MX, AAPL.SW, ...) — they are not what anyone typing
      // "apple" is after.
      .filter((r) => r.symbol && !r.symbol.includes(".") && !r.symbol.includes(":"))
      .slice(0, 12)
      .map((r) => {
        const type = r.type ?? "";
        // Finnhub's type field distinguishes funds from common stock; indices
        // arrive as their own type. Anything else is a listed equity.
        const kind: SearchResult["kind"] = /etf|etp|fund/i.test(type)
          ? "ETF"
          : /index/i.test(type)
            ? "INDEX"
            : "US STOCK";
        return {
          symbol: (r.displaySymbol ?? r.symbol)!.toUpperCase(),
          description: r.description ?? "",
          type,
          kind,
        };
      });

    const merged = [...bist, ...results].slice(0, 14);
    cache.set(key, { at: Date.now(), results: merged });
    return NextResponse.json({ results: merged });
  } catch (e) {
    // A Finnhub outage must not take BIST search down with it.
    if (bist.length) return NextResponse.json({ results: bist });
    return NextResponse.json(
      { results: [], error: e instanceof Error ? e.message : "Search failed" },
      { status: 200 },
    );
  }
}
