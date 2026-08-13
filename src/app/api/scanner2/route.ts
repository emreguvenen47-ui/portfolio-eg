import { NextResponse } from "next/server";
import { z } from "zod";
import { runScan, type PoolFilters } from "@/lib/scanner/engine";
import { SECTOR_LIST } from "@/lib/scanner/score";
import "@/lib/providers/register";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scanner results for one filter set.
 *
 * Filters are applied on the server, before any scoring, so the response can
 * only ever contain companies that satisfy them. Everything is arithmetic over
 * cached provider data — no model is called.
 */

const Body = z.object({
  regions: z.array(z.enum(["US", "BIST"])).default(["US"]),
  sectors: z.array(z.enum(SECTOR_LIST as [string, ...string[]])).default([]),
  industries: z.array(z.string().max(120)).max(40).default([]),
  buckets: z.array(z.enum(["MICRO", "SMALL", "MID", "LARGE", "MEGA"])).default([]),
  minMarketCap: z.number().nonnegative().nullable().default(null),
  maxMarketCap: z.number().nonnegative().nullable().default(null),
  minDollarVolume: z.number().nonnegative().nullable().default(null),
  minPrice: z.number().nonnegative().nullable().default(null),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid filters" }, { status: 400 });
  }

  try {
    const result = await runScan(parsed.data as PoolFilters);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        rows: [],
        eligible: 0,
        analyzed: 0,
        rankable: 0,
        warming: 0,
        universe: 0,
        coverage: { assembled: 0, tradable: 0 },
        error: e instanceof Error ? e.message : "Scan failed",
      },
      { status: 200 },
    );
  }
}
