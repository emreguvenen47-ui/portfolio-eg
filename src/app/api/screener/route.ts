import { NextResponse } from "next/server";
import { z } from "zod";
import { runScreen } from "@/lib/screener/run";
import { SECTOR_LIST } from "@/lib/scanner/score";
import type { PoolFilters } from "@/lib/scanner/engine";
import type { Screen } from "@/lib/screener/filter";
import "@/lib/providers/register";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Custom screen execution. Arithmetic over cached data; no model is called. */

const Criterion = z.object({
  id: z.string().max(64),
  metric: z.string().max(48),
  comparator: z.enum(["lt", "lte", "gt", "gte", "between"]),
  basis: z.enum(["absolute", "sectorMedian", "industryMedian", "sectorPercentile", "industryPercentile"]),
  value: z.number().nullable(),
  value2: z.number().nullable(),
  enabled: z.boolean(),
});

const Body = z.object({
  pool: z.object({
    regions: z.array(z.enum(["US", "BIST"])).default(["US"]),
    sectors: z.array(z.enum(SECTOR_LIST as [string, ...string[]])).default([]),
    industries: z.array(z.string().max(120)).max(40).default([]),
    buckets: z.array(z.enum(["MICRO", "SMALL", "MID", "LARGE", "MEGA"])).default([]),
    minMarketCap: z.number().nonnegative().nullable().default(null),
    maxMarketCap: z.number().nonnegative().nullable().default(null),
    minDollarVolume: z.number().nonnegative().nullable().default(null),
    minPrice: z.number().nonnegative().nullable().default(null),
  }),
  screen: z.object({
    id: z.string().max(64),
    name: z.string().max(120),
    combinator: z.enum(["AND", "OR"]),
    criteria: z.array(Criterion).max(30),
  }),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid screen" }, { status: 400 });
  }
  try {
    const result = await runScreen(
      parsed.data.pool as PoolFilters,
      parsed.data.screen as unknown as Screen,
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { rows: [], eligible: 0, dataAvailable: 0, matches: 0, analyzing: 0, universe: 0,
        error: e instanceof Error ? e.message : "Screen failed" },
      { status: 200 },
    );
  }
}
