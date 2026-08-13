import { NextResponse } from "next/server";
import { scoreOne } from "@/lib/scanner/engine";
import { isBistSymbol } from "@/lib/providers/bist";
import "@/lib/providers/register";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Peer position for one symbol. Arithmetic only — no model is called. */
export async function GET(req: Request) {
  const symbol = (new URL(req.url).searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!symbol || symbol.length > 24) {
    return NextResponse.json({ row: null, error: "Missing symbol" }, { status: 400 });
  }
  try {
    const row = await scoreOne(symbol, isBistSymbol(symbol) ? "BIST" : "US");
    return NextResponse.json({ row });
  } catch {
    return NextResponse.json({ row: null });
  }
}
