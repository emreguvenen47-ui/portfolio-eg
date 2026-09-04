import { NextResponse } from "next/server";
import "@/lib/providers/register";
import { eodhdGet, eodhdNum } from "@/lib/data/eodhd/client";
import { MACRO_TICKERS } from "@/lib/data/macro-tickers";

export const dynamic = "force-dynamic";

/**
 * TICKER TAPE — the rotating strip in the header.
 *
 * One bulk real-time call covers crypto/index/ETF instruments; FOREX spot
 * series (gold/silver/Brent) do not stream on this plan, so their price and
 * day change come from the last two EOD closes — labeled data, not a guess.
 * Cached 60s server-side; the tape is ambience, not an execution feed.
 */

interface TapeItem {
  alias: string;
  label: string;
  price: number | null;
  changePct: number | null;
  kind: string;
}

const KEY = Symbol.for("pcc.tape");
const cache: { at: number; items: TapeItem[] } = ((globalThis as unknown as Record<symbol, { at: number; items: TapeItem[] }>)[KEY] ??= {
  at: 0,
  items: [],
});

export async function GET() {
  if (Date.now() - cache.at < 60_000 && cache.items.length) {
    return NextResponse.json({ items: cache.items, cached: true });
  }
  const rt = MACRO_TICKERS.filter((t) => !t.code.endsWith(".FOREX"));
  const fx = MACRO_TICKERS.filter((t) => t.code.endsWith(".FOREX"));

  const items: TapeItem[] = [];

  // Bulk real-time for everything that streams.
  try {
    const first = rt[0]!.code;
    const rest = rt.slice(1).map((t) => t.code).join(",");
    const rows = await eodhdGet<Array<Record<string, unknown>> | Record<string, unknown>>(
      `/real-time/${encodeURIComponent(first)}`,
      rest ? { s: rest } : {},
    );
    const list = Array.isArray(rows) ? rows : [rows];
    for (const t of rt) {
      const row = list.find((r) => String(r["code"]) === t.code);
      items.push({
        alias: t.alias,
        label: t.label,
        price: eodhdNum(row?.["close"]),
        changePct: eodhdNum(row?.["change_p"]),
        kind: t.kind,
      });
    }
  } catch {
    for (const t of rt) items.push({ alias: t.alias, label: t.label, price: null, changePct: null, kind: t.kind });
  }

  // FOREX spot: last two EOD closes.
  for (const t of fx) {
    try {
      const rows = await eodhdGet<Array<{ close: number | string }>>(
        `/eod/${encodeURIComponent(t.code)}`,
        { order: "d", limit: "2" },
      );
      const c0 = eodhdNum(rows[0]?.close);
      const c1 = eodhdNum(rows[1]?.close);
      items.push({
        alias: t.alias,
        label: t.label,
        price: c0,
        changePct: c0 !== null && c1 !== null && c1 > 0 ? ((c0 / c1 - 1) * 100) : null,
        kind: t.kind,
      });
    } catch {
      items.push({ alias: t.alias, label: t.label, price: null, changePct: null, kind: t.kind });
    }
  }

  // Preserve the configured display order.
  const order = new Map(MACRO_TICKERS.map((t, i) => [t.alias, i]));
  items.sort((a, b) => (order.get(a.alias) ?? 99) - (order.get(b.alias) ?? 99));

  cache.at = Date.now();
  cache.items = items;
  return NextResponse.json({ items });
}
