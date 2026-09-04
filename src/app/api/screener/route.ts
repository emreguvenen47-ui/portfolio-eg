import { NextResponse } from "next/server";
import { getUniverseMeta, queryUniverse, type UniverseQuery } from "@/lib/data/opportunities";

/** POST /api/screener — pure in-memory query over the precomputed table. */
export async function POST(req: Request) {
  const q = (await req.json().catch(() => ({}))) as UniverseQuery;
  const t0 = Date.now();
  const result = queryUniverse(q);
  return NextResponse.json({
    ...result,
    coverage: getUniverseMeta(),
    queryMs: Date.now() - t0,
  });
}
