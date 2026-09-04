import { NextResponse } from "next/server";
import { z } from "zod";
import "@/lib/providers/register";
import { getHistoricalPrices } from "@/lib/providers";
import { buildEgBundle } from "@/lib/engines/eg-bundle";
import { buildTechnicalDecision } from "@/lib/engines/technical-v3";
import {
  addTrade,
  createVirtual,
  listVirtual,
  type Trade,
} from "@/lib/server/virtual-portfolios";

export const dynamic = "force-dynamic";

/**
 * OPEN PAPER TRADE from a technical setup.
 *
 * Books the trade into the dedicated "Paper Trades — Technical" ledger
 * (created on first use) and freezes an IMMUTABLE snapshot of what every
 * engine said at entry. Signals that change later never rewrite this record —
 * that is the whole point of keeping it.
 */

const Body = z.object({
  symbol: z.string().min(1).max(24),
  side: z.enum(["BUY", "SELL"]).default("BUY"),
  quantity: z.number().positive().max(1e7),
  entry: z.number().positive().max(1e7),
  stop: z.number().positive().max(1e7).nullable().default(null),
  target1: z.number().positive().max(1e7).nullable().default(null),
  target2: z.number().positive().max(1e7).nullable().default(null),
  note: z.string().max(200).default(""),
});

const LEDGER_NAME = "Paper Trades — Technical";

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const b = parsed.data;
  const symbol = b.symbol.toUpperCase();

  // Snapshot the engines AT ENTRY (candles + fundamentals as of right now).
  const history = await getHistoricalPrices(symbol, 1300);
  const d = buildTechnicalDecision(symbol, history.candles);
  const eg = await buildEgBundle(symbol, null, history.candles).catch(() => null);
  const stdStop = d.stops.find((s) => s.kind === "STANDARD") ?? d.stops[0] ?? null;

  const snapshot: NonNullable<Trade["technicalSnapshot"]> = {
    asOf: new Date().toISOString(),
    signal: d.signal,
    setup: d.setup,
    score: d.score?.total ?? null,
    confidence: d.confidence,
    weeklyRegime: d.weeklyTrend,
    valuationView: eg?.decision.view ?? null,
    primarySupport: d.daily.primarySupport,
    primaryResistance: d.daily.primaryResistance,
    stopStandard: stdStop?.price ?? null,
    target1: d.target1,
    target2: d.target2,
    riskReward: d.riskReward,
  };

  // Find or create the dedicated ledger.
  const all = await listVirtual();
  let ledger = all.find((p) => p.name === LEDGER_NAME) ?? null;
  if (!ledger) {
    ledger = await createVirtual({ name: LEDGER_NAME, currency: "USD", initialCash: 100_000 });
  }

  const result = await addTrade(ledger.id, {
    ticker: symbol,
    side: b.side,
    quantity: b.quantity,
    price: b.entry,
    fees: 0,
    currency: "USD",
    date: new Date().toISOString().slice(0, 10),
    note: b.note || `Opened from technical workstation (${d.signal})`,
    plan: { stop: b.stop ?? stdStop?.price ?? null, target1: b.target1 ?? d.target1, target2: b.target2 ?? d.target2 },
    technicalSnapshot: snapshot,
  });

  if (!result) return NextResponse.json({ error: "ledger not found" }, { status: 500 });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  const trade = result.trades[result.trades.length - 1]!;
  return NextResponse.json({
    ok: true,
    portfolioId: result.id,
    tradeId: trade.id,
    snapshot: trade.technicalSnapshot,
    plan: trade.plan,
  });
}
