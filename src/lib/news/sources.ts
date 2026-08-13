import "server-only";
import {
  fetchCompanyNewsBatch,
  fetchMarketNews,
  finnhubKey,
  type FinnhubArticle,
} from "@/lib/providers/finnhub";

/**
 * News ingestion.
 *
 * Two tiers, both institution-sourced:
 *  - Finnhub (needs a free key) gives per-symbol company news, which is the
 *    only way to know a headline is genuinely about a holding rather than
 *    merely mentioning its ticker in passing.
 *  - MarketWatch / Dow Jones RSS needs no key at all and covers market-wide
 *    headlines, so the panel still works before a key is configured.
 */

export interface RawArticle {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  /** Symbol the provider itself tagged the story with, when it did. */
  taggedSymbol?: string;
}

const TIMEOUT_MS = 8000;

/** Dow Jones feeds that are actually current; the others are years stale. */
const RSS_FEEDS = [
  { url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", source: "MarketWatch" },
  { url: "https://feeds.content.dowjones.io/public/rss/mw_bulletins", source: "MarketWatch" },
];

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(item: string, name: string): string {
  const m = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]) : "";
}

/**
 * Minimal RSS reader. These are two fixed, well-formed feeds, so a full XML
 * parser would be a dependency bought for nothing.
 */
async function fetchRss(url: string, source: string): Promise<RawArticle[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        Accept: "application/rss+xml, application/xml, text/xml",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${source}`);
    const xml = await res.text();

    const out: RawArticle[] = [];
    for (const m of xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)) {
      const item = m[1];
      const headline = tag(item, "title");
      if (!headline) continue;
      const link = tag(item, "link");
      const pub = tag(item, "pubDate");
      const when = pub ? new Date(pub) : new Date();
      out.push({
        id: tag(item, "guid") || link || headline,
        headline,
        summary: tag(item, "description"),
        source,
        url: link,
        publishedAt: (Number.isNaN(when.getTime()) ? new Date() : when).toISOString(),
      });
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

function fromFinnhub(a: FinnhubArticle, taggedSymbol?: string): RawArticle | null {
  const headline = a.headline?.trim();
  if (!headline) return null;
  return {
    id: String(a.id ?? a.url ?? headline),
    headline,
    summary: (a.summary ?? "").trim(),
    source: a.source ?? "Finnhub",
    url: a.url ?? "",
    publishedAt: new Date((a.datetime ?? Date.now() / 1000) * 1000).toISOString(),
    taggedSymbol,
  };
}

/**
 * Per-tier caches.
 *
 * Company news is the expensive tier — one request per holding — and a
 * given company does not produce a fresh headline every ninety seconds, so it
 * refreshes far more slowly than the market-wide sweep. Splitting the TTLs
 * this way is what keeps a full day of use inside the free per-minute budget.
 */
const MARKET_NEWS_TTL_MS = 5 * 60_000;
const COMPANY_NEWS_TTL_MS = 20 * 60_000;
const RSS_TTL_MS = 5 * 60_000;

const tierCache = new Map<string, { value: RawArticle[]; expires: number }>();

async function cachedTier(
  key: string,
  ttl: number,
  load: () => Promise<RawArticle[]>,
): Promise<RawArticle[]> {
  const hit = tierCache.get(key);
  if (hit && Date.now() < hit.expires) return hit.value;
  try {
    const value = await load();
    tierCache.set(key, { value, expires: Date.now() + ttl });
    return value;
  } catch (e) {
    // Serve the previous sweep rather than dropping a whole tier on one blip.
    if (hit) return hit.value;
    throw e;
  }
}

export interface NewsFetchResult {
  articles: RawArticle[];
  /** Feeds that answered, for display. */
  sources: string[];
  /** Feeds that failed, so the UI can say so instead of showing a short list. */
  errors: string[];
}

/**
 * Collect headlines from every configured source.
 *
 * `symbols` drives the per-holding Finnhub lookups; without a key those are
 * skipped and only the market-wide RSS tier runs.
 */
export async function fetchNews(symbols: string[]): Promise<NewsFetchResult> {
  const key = finnhubKey();
  const articles: RawArticle[] = [];
  const sources = new Set<string>();
  const errors: string[] = [];

  const tasks: Promise<void>[] = [];

  const collect = (raw: RawArticle[]) => {
    articles.push(...raw);
    for (const a of raw) sources.add(a.source);
  };

  if (key) {
    tasks.push(
      cachedTier("finnhub:market", MARKET_NEWS_TTL_MS, async () =>
        (await fetchMarketNews(key))
          .slice(0, 60)
          .map((a) => fromFinnhub(a))
          .filter((a): a is RawArticle => a !== null),
      )
        .then(collect)
        .catch((e: unknown) => {
          errors.push(`Finnhub market news: ${e instanceof Error ? e.message : "failed"}`);
        }),
    );
    tasks.push(
      cachedTier(`finnhub:company:${symbols.slice().sort().join(",")}`, COMPANY_NEWS_TTL_MS, async () => {
        const bySymbol = await fetchCompanyNewsBatch(key, symbols, 3);
        const out: RawArticle[] = [];
        for (const [symbol, raw] of Object.entries(bySymbol)) {
          for (const a of raw.slice(0, 12)) {
            const art = fromFinnhub(a, symbol);
            if (art) out.push(art);
          }
        }
        return out;
      })
        .then(collect)
        .catch((e: unknown) => {
          errors.push(`Finnhub company news: ${e instanceof Error ? e.message : "failed"}`);
        }),
    );
  }

  for (const feed of RSS_FEEDS) {
    tasks.push(
      cachedTier(`rss:${feed.url}`, RSS_TTL_MS, () => fetchRss(feed.url, feed.source))
        .then(collect)
        .catch((e: unknown) => {
          errors.push(`${feed.source}: ${e instanceof Error ? e.message : "failed"}`);
        }),
    );
  }

  await Promise.all(tasks);

  // The same story reaches us from several feeds; keep the first copy of each
  // headline and the earliest timestamp we saw for it.
  const seen = new Map<string, RawArticle>();
  for (const a of articles) {
    const dedupeKey = a.headline.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const prior = seen.get(dedupeKey);
    if (!prior) seen.set(dedupeKey, a);
    else if (!prior.taggedSymbol && a.taggedSymbol) seen.set(dedupeKey, a);
  }

  return {
    articles: [...seen.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
    sources: [...sources],
    errors,
  };
}

/** True when per-symbol company news is available. */
export function hasCompanyNews(): boolean {
  return finnhubKey() !== null;
}
