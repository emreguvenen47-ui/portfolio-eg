import { NextResponse } from "next/server";
import { z } from "zod";
import { diskCache } from "@/lib/server/disk-cache";
import { getSessionUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/**
 * CHART DRAWINGS PERSISTENCE — per user + ticker + timeframe.
 *
 * Drawings survive navigation and restarts (disk-backed store; keyed by the
 * session user when auth is configured, an anonymous bucket otherwise). The
 * payload is the client's declarative drawing list — times and prices, never
 * pixels — so a drawing stays glued to the same candles at any zoom.
 */

const Point = z.object({ time: z.string().max(24), price: z.number() });
const Drawing = z.object({
  id: z.string().max(40),
  type: z.enum([
    "trendline",
    "hline",
    "vline",
    "ray",
    "extended",
    "channel",
    "rect",
    "text",
    "price-range",
    "date-range",
    "fib-retracement",
    "fib-extension",
  ]),
  points: z.array(Point).min(1).max(4),
  text: z.string().max(200).optional(),
  color: z.string().max(24).optional(),
  hidden: z.boolean().optional(),
});
export type StoredDrawing = z.infer<typeof Drawing>;

const Body = z.object({
  symbol: z.string().min(1).max(24),
  tf: z.string().min(1).max(12),
  drawings: z.array(Drawing).max(300),
});

const store = diskCache<StoredDrawing[]>("chart-drawings", Number.POSITIVE_INFINITY);

async function keyFor(symbol: string, tf: string): Promise<string> {
  const user = await getSessionUser().catch(() => null);
  return `${user?.id ?? "anon"}:${symbol.toUpperCase()}:${tf.toUpperCase()}`;
}

// Durable layer: Supabase when configured (serverless /tmp does not survive
// cold starts); disk stays the hot path and the local-instance fallback.
async function sbLoad(key: string): Promise<StoredDrawing[] | null> {
  try {
    const { getSupabaseAdmin, isMissingTable } = await import("@/lib/server/supabase");
    const sb = getSupabaseAdmin();
    if (!sb) return null;
    const { data, error } = await sb.from("chart_drawings").select("drawings").eq("key", key).maybeSingle();
    if (error) {
      if (!isMissingTable(error)) console.error("[drawings] load failed:", error.message);
      return null;
    }
    return (data?.drawings ?? null) as StoredDrawing[] | null;
  } catch {
    return null;
  }
}

async function sbSave(key: string, drawings: StoredDrawing[]): Promise<void> {
  try {
    const { getSupabaseAdmin, isMissingTable } = await import("@/lib/server/supabase");
    const sb = getSupabaseAdmin();
    if (!sb) return;
    const { error } = await sb
      .from("chart_drawings")
      .upsert({ key, drawings, updated_at: new Date().toISOString() });
    if (error && !isMissingTable(error)) console.error("[drawings] save failed:", error.message);
  } catch {
    /* optional layer */
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").trim();
  const tf = (url.searchParams.get("tf") ?? "D").trim();
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  const key = await keyFor(symbol, tf);
  let drawings = store.get(key) ?? null;
  if (drawings === null) {
    drawings = await sbLoad(key);
    if (drawings) store.set(key, drawings);
  }
  return NextResponse.json({ drawings: drawings ?? [] });
}

export async function PUT(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const { symbol, tf, drawings } = parsed.data;
  const key = await keyFor(symbol, tf);
  store.set(key, drawings);
  store.flushNow();
  await sbSave(key, drawings);
  return NextResponse.json({ ok: true, saved: drawings.length });
}
