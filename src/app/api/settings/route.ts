import { NextResponse } from "next/server";
import { z } from "zod";
import { getSettings, saveSettings } from "@/lib/server/settings-store";

export const dynamic = "force-dynamic";

const Patch = z
  .object({
    ppfTlYield: z.number().min(-0.5).max(5),
    expectedUsdTryChange: z.number().min(-0.9).max(5),
    usdTryOverride: z.number().positive().max(10_000).nullable(),
    inceptionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    riskFreeRate: z.number().min(0).max(1),
    benchmark: z.enum(["SPX", "XU100", "NONE"]),
    driftThreshold: z.number().min(0).max(0.2),
  })
  .partial();

export async function GET() {
  return NextResponse.json(await getSettings());
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const parsed = Patch.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid settings", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  return NextResponse.json(await saveSettings(parsed.data));
}
