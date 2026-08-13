import { NextResponse } from "next/server";
import { z } from "zod";
import { getQuotes } from "@/lib/providers";
import {
  addTrade,
  createVirtual,
  deleteTrade,
  deleteVirtual,
  getVirtual,
  listVirtual,
  renameVirtual,
} from "@/lib/server/virtual-portfolios";
import { currentAllocation, getPortfolio } from "@/lib/server/ai-portfolios";

export const dynamic = "force-dynamic";

/** Paper-trading CRUD. Arithmetic and market data only — no model calls. */

const TradeInput = z.object({
  ticker: z.string().min(1).max(24),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().positive().max(1e9),
  price: z.number().positive().max(1e9),
  fees: z.number().min(0).max(1e7).default(0),
  currency: z.string().max(8).default("USD"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(200).default(""),
});

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().min(1).max(120),
    currency: z.string().max(8).default("USD"),
    initialCash: z.number().min(0).max(1e12).default(100_000),
  }),
  z.object({
    action: z.literal("seed-from-ai"),
    aiPortfolioId: z.string().min(1),
    name: z.string().min(1).max(120).optional(),
  }),
  z.object({ action: z.literal("rename"), id: z.string().min(1), name: z.string().min(1).max(120) }),
  z.object({ action: z.literal("delete"), id: z.string().min(1) }),
  z.object({ action: z.literal("trade"), id: z.string().min(1), trade: TradeInput }),
  z.object({ action: z.literal("delete-trade"), id: z.string().min(1), tradeId: z.string().min(1) }),
]);

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const p = await getVirtual(id);
    return p
      ? NextResponse.json({ portfolio: p })
      : NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ portfolios: await listVirtual() });
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const body = parsed.data;

  switch (body.action) {
    case "create":
      return NextResponse.json({ portfolio: await createVirtual(body) });

    case "seed-from-ai": {
      // Turn a modelled allocation into opening trades at TODAY's real prices.
      // Back-dating them to the AI portfolio's creation would claim fills at
      // prices this paper book never traded at.
      const ai = await getPortfolio(body.aiPortfolioId);
      if (!ai) return NextResponse.json({ error: "AI portfolio not found" }, { status: 404 });

      const alloc = currentAllocation(ai);
      const quotes = await getQuotes(alloc.positions.map((p) => p.ticker));
      const today = new Date().toISOString().slice(0, 10);
      const amount = ai.baseline.amount || ai.built.amount || 100_000;

      const trades = alloc.positions
        .map((p) => {
          const q = quotes[p.ticker];
          if (!q) return null;
          const shares = (amount * p.weight) / q.price;
          return {
            ticker: p.ticker,
            side: "BUY" as const,
            quantity: Number(shares.toFixed(4)),
            price: q.price,
            fees: 0,
            currency: q.currency,
            date: today,
            note: `Seeded from AI portfolio "${ai.name}"`,
          };
        })
        .filter((t): t is NonNullable<typeof t> => t !== null);

      if (trades.length === 0) {
        return NextResponse.json(
          { error: "No position could be priced — nothing to seed" },
          { status: 400 },
        );
      }

      const skipped = alloc.positions.length - trades.length;
      const portfolio = await createVirtual({
        name: body.name ?? `${ai.name} (paper)`,
        currency: ai.baseline.currency || "USD",
        initialCash: amount,
        sourceAiPortfolioId: ai.id,
        trades,
      });
      return NextResponse.json({
        portfolio,
        skipped: skipped > 0 ? skipped : undefined,
      });
    }

    case "rename": {
      const p = await renameVirtual(body.id, body.name);
      return p
        ? NextResponse.json({ portfolio: p })
        : NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    case "delete":
      return NextResponse.json({ deleted: await deleteVirtual(body.id) });

    case "trade": {
      const result = await addTrade(body.id, body.trade);
      if (result === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if ("error" in result) return NextResponse.json(result, { status: 400 });
      return NextResponse.json({ portfolio: result });
    }

    case "delete-trade": {
      const p = await deleteTrade(body.id, body.tradeId);
      return p
        ? NextResponse.json({ portfolio: p })
        : NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }
}
