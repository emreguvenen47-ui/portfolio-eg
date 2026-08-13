import { NextResponse } from "next/server";
import { getContext } from "@/lib/server/context";
import { fetchNews, hasCompanyNews } from "@/lib/news/sources";
import { attachImpacts, NEWS_CATEGORIES } from "@/lib/news/impact";
import { isAiConfigured } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

/** Headlines change on the order of minutes, not seconds. */
const TTL_MS = 90_000;

interface Cached {
  payload: unknown;
  expires: number;
}
let cached: Cached | null = null;
let inflight: Promise<unknown> | null = null;

async function build() {
  const ctx = await getContext({ markets: false });
  const symbols = ctx.portfolio.positions
    .map((p) => p.symbol)
    .filter((s): s is string => Boolean(s));

  const { articles, sources, errors } = await fetchNews(symbols);
  const items = attachImpacts(articles, ctx.rows, ctx.totals.value);

  return {
    items: items.slice(0, 80),
    /** Headlines fetched vs. those that landed in at least one bucket. */
    scanned: articles.length,
    categories: NEWS_CATEGORIES,
    sources,
    errors,
    companyNews: hasCompanyNews(),
    aiConfigured: isAiConfigured(),
    refreshMs: TTL_MS,
    updatedAt: new Date().toISOString(),
  };
}

export async function GET() {
  const now = Date.now();
  if (cached && now < cached.expires) return NextResponse.json(cached.payload);

  // One upstream sweep even if several tabs ask at once.
  inflight ??= build()
    .then((payload) => {
      cached = { payload, expires: Date.now() + TTL_MS };
      return payload;
    })
    .finally(() => {
      inflight = null;
    });

  try {
    return NextResponse.json(await inflight);
  } catch (e) {
    // Serve the last good sweep rather than an empty panel.
    if (cached) return NextResponse.json(cached.payload);
    return NextResponse.json(
      {
        items: [],
        scanned: 0,
        categories: NEWS_CATEGORIES,
        sources: [],
        errors: [e instanceof Error ? e.message : String(e)],
        companyNews: false,
        aiConfigured: isAiConfigured(),
        refreshMs: TTL_MS,
        updatedAt: new Date().toISOString(),
      },
      { status: 200 },
    );
  }
}
