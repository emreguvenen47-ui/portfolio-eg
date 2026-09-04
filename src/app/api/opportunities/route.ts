import { NextResponse } from "next/server";
import { getOpportunities, OPPORTUNITY_VIEWS } from "@/lib/data/opportunities";

/** GET /api/opportunities?view=best — reads ONLY the precomputed table. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "best";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const t0 = Date.now();
  const data = getOpportunities(view, limit);
  return NextResponse.json({
    view,
    views: OPPORTUNITY_VIEWS.map((v) => ({ key: v.key, label: v.label })),
    queryMs: Date.now() - t0,
    ...data,
  });
}
