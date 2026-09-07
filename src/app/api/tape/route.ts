import { NextResponse } from "next/server";
import "@/lib/providers/register";
import { getMacroTape } from "@/lib/data/macro-tape";

export const dynamic = "force-dynamic";

/** TICKER TAPE — delegates to the shared macro-tape lib (60s server cache). */
export async function GET() {
  return NextResponse.json({ items: await getMacroTape() });
}
