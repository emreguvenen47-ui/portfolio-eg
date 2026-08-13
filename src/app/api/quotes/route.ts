import { NextResponse } from "next/server";
import { z } from "zod";
import { aggregateStatus, getQuotes } from "@/lib/providers";

export const dynamic = "force-dynamic";

const Query = z.object({
  symbols: z
    .string()
    .min(1)
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 40),
    ),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Query.safeParse({ symbols: url.searchParams.get("symbols") ?? "" });
  if (!parsed.success) {
    return NextResponse.json({ error: "symbols query parameter is required" }, { status: 400 });
  }

  const quotes = await getQuotes(parsed.data.symbols);
  return NextResponse.json({
    quotes,
    status: aggregateStatus(Object.values(quotes)),
    updatedAt: new Date().toISOString(),
  });
}
