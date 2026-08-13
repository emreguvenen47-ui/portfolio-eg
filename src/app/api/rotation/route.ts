import { NextResponse } from "next/server";
import { runRotation, rotationMap } from "@/lib/rotation/engine";
import { TIMEFRAMES, type Timeframe } from "@/lib/rotation/sectors";
import "@/lib/providers/register";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Sector rotation. Price, volume and breadth only — no model is called. */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("tf") ?? "1W";
  const tf = (TIMEFRAMES.find((t) => t.key === raw)?.key ?? "1W") as Timeframe;
  try {
    const result = await runRotation(tf);
    return NextResponse.json({ ...result, map: rotationMap(result.groups, tf) });
  } catch (e) {
    return NextResponse.json(
      { groups: [], benchmark: "SPY", timeframe: tf, actualFlowGroups: 0, signalGroups: 0, warming: 0,
        map: { out: [], into: [], supported: false, note: "" },
        error: e instanceof Error ? e.message : "Rotation failed" },
      { status: 200 },
    );
  }
}
