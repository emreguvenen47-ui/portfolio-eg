import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteRule, listRules, saveRule, toggleRule } from "@/lib/server/alert-store";

export const dynamic = "force-dynamic";

const KINDS = [
  "price_above",
  "price_below",
  "pct_move",
  "drawdown_from_high",
  "cross_20dma",
  "cross_50dma",
  "cross_200dma",
  "cross_20_50",
  "cross_50_200",
  "rsi_above",
  "rsi_below",
  "breakout_52w",
  "volume_spike",
  "volatility_spike",
  "weight_above",
  "weight_below",
  "portfolio_drawdown",
  "concentration",
  "currency_exposure",
] as const;

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    subject: z.string().min(1).max(24),
    kind: z.enum(KINDS),
    threshold: z.number().finite(),
    note: z.string().max(200).optional(),
  }),
  z.object({ action: z.literal("delete"), id: z.string().min(1) }),
  z.object({ action: z.literal("toggle"), id: z.string().min(1), enabled: z.boolean() }),
]);

export async function GET() {
  return NextResponse.json({ rules: await listRules() });
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const body = parsed.data;

  if (body.action === "create") {
    return NextResponse.json({
      rule: await saveRule({
        subject: body.subject.toUpperCase(),
        kind: body.kind,
        threshold: body.threshold,
        enabled: true,
        note: body.note,
      }),
    });
  }
  if (body.action === "delete") {
    return NextResponse.json({ deleted: await deleteRule(body.id) });
  }
  const rule = await toggleRule(body.id, body.enabled);
  return rule
    ? NextResponse.json({ rule })
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}
