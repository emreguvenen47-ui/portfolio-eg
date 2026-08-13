import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteScreen,
  duplicateScreen,
  listScreens,
  saveScreen,
} from "@/lib/server/saved-screens";
import { SECTOR_LIST } from "@/lib/scanner/score";
import { errorResponse } from "@/lib/server/api-error";

export const dynamic = "force-dynamic";

/** Saved screens: the question, stored. No results are persisted. */

const Criterion = z.object({
  id: z.string().max(64),
  metric: z.string().max(48),
  comparator: z.enum(["lt", "lte", "gt", "gte", "between"]),
  basis: z.enum([
    "absolute",
    "sectorMedian",
    "industryMedian",
    "sectorPercentile",
    "industryPercentile",
  ]),
  value: z.number().nullable(),
  value2: z.number().nullable(),
  enabled: z.boolean(),
});

const Body = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
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
  combinator: z.enum(["AND", "OR"]),
  criteria: z.array(Criterion).max(30),
  columns: z.array(z.string().max(48)).max(40).default([]),
});

const fail = (e: unknown) => errorResponse(e);

export async function GET() {
  try {
    return NextResponse.json({ screens: await listScreens() });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid screen" }, { status: 400 });
  try {
    const saved = await saveScreen(
      parsed.data as unknown as Parameters<typeof saveScreen>[0],
    );
    return NextResponse.json({ screen: saved });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => null)) as { id?: string } | null;
  const id = z.string().uuid().safeParse(body?.id);
  if (!id.success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    const copy = await duplicateScreen(id.data);
    if (!copy) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ screen: copy });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const id = z.string().uuid().safeParse(new URL(req.url).searchParams.get("id"));
  if (!id.success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    return NextResponse.json({ deleted: await deleteScreen(id.data) });
  } catch (e) {
    return fail(e);
  }
}
