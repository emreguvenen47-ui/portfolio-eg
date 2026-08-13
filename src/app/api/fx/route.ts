import { NextResponse } from "next/server";
import { getFxRate } from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const pair = (url.searchParams.get("pair") ?? "USD/TRY").trim().toUpperCase();
  if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(pair)) {
    return NextResponse.json({ error: "pair must look like USD/TRY" }, { status: 400 });
  }
  return NextResponse.json(await getFxRate(pair));
}
