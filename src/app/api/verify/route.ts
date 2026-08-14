import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getCredits,
  getGoogleFinance,
  isSearchApiConfigured,
} from "@/lib/providers/searchapi-finance";
import { AI_LIMIT, checkLimit, clientIdFrom } from "@/lib/server/rate-limit";
import "@/lib/providers/register";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Third-source verification for one company.
 *
 * POST only, so nothing on a page render or a prefetch can reach it — the same
 * discipline the AI endpoints use, and for the same reason: this one costs a
 * credit from a fixed pool.
 *
 * GET reports the remaining balance, which costs nothing.
 */

const Body = z.object({
  symbol: z.string().min(1).max(12),
  /** Google needs the venue; NASDAQ and NYSE cover almost everything here. */
  exchange: z.string().min(2).max(12).default("NASDAQ"),
});

export async function GET() {
  if (!isSearchApiConfigured()) {
    return NextResponse.json({ configured: false, remaining: null });
  }
  const c = await getCredits();
  return NextResponse.json({ configured: true, ...c });
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }

  // Rate limited like the AI routes: a click costs real money here too.
  const gate = checkLimit(clientIdFrom(req), "verify", AI_LIMIT);
  if (!gate.ok) {
    return NextResponse.json({ error: "Too many verification requests." }, { status: 429 });
  }

  const out = await getGoogleFinance(parsed.data.symbol, parsed.data.exchange, true);

  switch (out.status) {
    case "OK":
      return NextResponse.json({
        symbol: out.data.symbol,
        fromCache: out.fromCache,
        creditsLeft: out.creditsLeft,
        data: out.data,
      });
    case "NOT_CONFIGURED":
      return NextResponse.json(
        { error: "No third source configured on this deployment." },
        { status: 503 },
      );
    case "EXHAUSTED":
      return NextResponse.json(
        {
          error: `Third-source credits are exhausted (${out.creditsLeft ?? 0} left, a small reserve is held back). Top up the SearchApi plan to verify more companies.`,
        },
        { status: 402 },
      );
    default:
      return NextResponse.json(
        { error: out.status === "FAILED" ? out.reason : "Verification failed" },
        { status: 502 },
      );
  }
}
