import "server-only";
import { eodhdGet } from "./client";
import { diskCache } from "@/lib/server/disk-cache";
import { classifyNews, dedupeNews, type ClassifiedNews } from "@/lib/engines/news-classify";
import { toEodhdCode } from "@/lib/providers/eodhd";

/** EODHD company news → classified, deduped. Cached 15 minutes. */

const TTL_MS = 15 * 60_000;
// Persisted so restarts and provider-quota days keep serving the last pull.
const disk = diskCache<ClassifiedNews[]>("eodhd-news", 24 * 60 * 60_000);
const KEY = Symbol.for("pcc.eodhd.news");
type Entry = { at: number; value: ClassifiedNews[] };
const cache: Map<string, Entry> = ((
  globalThis as unknown as Record<symbol, Map<string, Entry>>
)[KEY] ??= new Map());

interface RawNews {
  date: string;
  title: string;
  link: string;
  source?: string;
  symbols?: string[];
  content?: string;
}

export async function getClassifiedNews(symbol: string, limit = 25, companyName?: string | null): Promise<ClassifiedNews[]> {
  const code = toEodhdCode(symbol);
  if (!code || !code.endsWith(".US")) return [];
  const k = `${symbol}:${limit}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    // Shorter timeout than the 20s default: observed live at 15-20s for
    // heavily-covered tickers (NVDA), and a caller-side race already treats
    // anything past a few seconds as "no news yet" — no point holding the
    // connection open for the full default window once that race has fired.
    const raw = await eodhdGet<RawNews[]>(`/news`, { s: code, limit: String(limit) }, 8_000);
    // Relevance: the story must actually be ABOUT this company — the ticker
    // or a distinctive name token appears in the title or lead paragraph.
    const nameToken = (companyName ?? "").split(/\s+/)[0]?.toLowerCase() ?? "";
    const relevant = raw.filter((r) => {
      if (!r.title || !r.date) return false;
      const hay = (r.title + " " + (r.content ?? "").slice(0, 400)).toLowerCase();
      return (
        hay.includes(symbol.toLowerCase()) ||
        (nameToken.length >= 3 && hay.includes(nameToken))
      );
    });
    const classified = dedupeNews(
      relevant.map((r) => {
        const c = classifyNews({ title: r.title, date: r.date, url: r.link, source: r.source ?? null });
        const raw0 = (r.content ?? "").replace(/\s+/g, " ").trim();
        return { ...c, summary: raw0 ? raw0.slice(0, 220) + (raw0.length > 220 ? "…" : "") : null };
      }),
    );
    cache.set(k, { at: Date.now(), value: classified });
    disk.set(k, classified);
    return classified;
  } catch {
    return hit?.value ?? disk.get(k) ?? [];
  }
}
