import { NextResponse } from "next/server";
import { z } from "zod";
import { getOptionChain } from "@/lib/providers/yahoo-options";
import "@/lib/providers/register";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Option chain for one symbol and expiry. Public market data; no model call. */

const Query = z.object({
  symbol: z.string().min(1).max(12),
  expiry: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Query.safeParse({
    symbol: url.searchParams.get("symbol") ?? "",
    expiry: url.searchParams.get("expiry") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid symbol or expiry" }, { status: 400 });
  }

  const chain = await getOptionChain(parsed.data.symbol, parsed.data.expiry).catch(() => null);
  if (!chain) {
    return NextResponse.json(
      {
        error:
          "No option chain available for this symbol. Not every listing has one, and the " +
          "source may also be refusing requests just now.",
      },
      { status: 404 },
    );
  }
  return NextResponse.json(chain);
}
