import { NextResponse } from "next/server";
import { AI_LIMIT, checkLimit, clientIdFrom, readJsonCapped } from "@/lib/server/rate-limit";
import { z } from "zod";
import { getQuotes } from "@/lib/providers";
import {
  addBaselinePrices,
  deletePortfolio,
  duplicatePortfolio,
  getPortfolio,
  listPortfolios,
  renamePortfolio,
  savePortfolio,
  updateAllocation,
  type Baseline,
  type SavedPosition,
} from "@/lib/server/ai-portfolios";
import { normaliseTo100 } from "@/lib/ai/portfolio-performance";
import type { BuiltPortfolio } from "@/lib/ai/portfolio-model";

export const dynamic = "force-dynamic";

/**
 * CRUD for saved AI portfolios. Nothing here touches the real book, and
 * nothing here calls a model — saving, editing and normalising are all
 * arithmetic plus a market-data lookup.
 */

const ROLES = [
  "CORE",
  "GROWTH",
  "DEFENSIVE",
  "INCOME",
  "HEDGE",
  "DIVERSIFIER",
  "LIQUIDITY",
] as const;
const ASSET_CLASSES = ["Cash", "Equity", "Commodity", "Alternative", "Unallocated"] as const;
const REGIONS = ["Turkey", "US", "Europe", "China", "EM", "Global", "Unallocated"] as const;

const PositionSchema = z.object({
  ticker: z.string().min(1).max(24),
  name: z.string().max(120).default(""),
  weight: z.number().min(0).max(1),
  originalWeight: z.number().min(0).max(1).nullable().default(null),
  assetClass: z.enum(ASSET_CLASSES).default("Equity"),
  region: z.enum(REGIONS).default("Global"),
  role: z.enum(ROLES).default("CORE"),
  reason: z.string().max(600).default(""),
  source: z.enum(["ai", "manual"]).default("manual"),
  addedAt: z.string().default(() => new Date().toISOString()),
});

const SaveBody = z.object({
  action: z.literal("save"),
  name: z.string().min(1).max(120),
  profile: z.unknown(),
  risk: z.unknown(),
  built: z.unknown(),
});

const MutateBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rename"), id: z.string().min(1), name: z.string().min(1).max(120) }),
  z.object({ action: z.literal("duplicate"), id: z.string().min(1) }),
  z.object({ action: z.literal("delete"), id: z.string().min(1) }),
  z.object({
    action: z.literal("update"),
    id: z.string().min(1),
    positions: z.array(PositionSchema).min(1).max(40),
    /** Rescale to exactly 100% instead of rejecting a total that is off. */
    normalize: z.boolean().default(false),
    note: z.string().max(120).default("manual edit"),
  }),
]);

/** Capture the real price of every ticker, for use as the return baseline. */
async function captureBaseline(
  tickers: string[],
  amount: number,
  currency: string,
): Promise<Baseline> {
  const quotes = await getQuotes(tickers);
  const prices: Baseline["prices"] = {};
  for (const t of tickers) {
    const q = quotes[t];
    // A ticker with no real quote is stored as null, not skipped: the absence
    // is the record that this position has no valid baseline yet.
    prices[t] = q
      ? { price: q.price, provider: q.provider, timestamp: q.timestamp }
      : null;
  }
  return { at: new Date().toISOString(), amount, currency, prices };
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const p = await getPortfolio(id);
    return p
      ? NextResponse.json({ portfolio: p })
      : NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ portfolios: await listPortfolios() });
}

export async function POST(req: Request) {
  const limit = checkLimit(clientIdFrom(req), "ai/portfolios", AI_LIMIT);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Too many requests. Try again in ${limit.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const body = await readJsonCapped(req);

  const save = SaveBody.safeParse(body);
  if (save.success) {
    const built = save.data.built as BuiltPortfolio;
    const baseline = await captureBaseline(
      built.positions.map((p) => p.ticker),
      built.amount,
      built.currency,
    );
    const saved = await savePortfolio({
      name: save.data.name,
      // Shapes were validated when the builder produced them; re-validating the
      // whole nested structure here would duplicate that schema for no gain.
      profile: save.data.profile as never,
      risk: save.data.risk as never,
      built,
      baseline,
    });
    return NextResponse.json({ portfolio: saved });
  }

  const mutate = MutateBody.safeParse(body);
  if (!mutate.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  switch (mutate.data.action) {
    case "rename": {
      const p = await renamePortfolio(mutate.data.id, mutate.data.name);
      return p
        ? NextResponse.json({ portfolio: p })
        : NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    case "duplicate": {
      const p = await duplicatePortfolio(mutate.data.id);
      return p
        ? NextResponse.json({ portfolio: p })
        : NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    case "delete": {
      const ok = await deletePortfolio(mutate.data.id);
      return NextResponse.json({ deleted: ok });
    }
    case "update": {
      const { id, normalize, note } = mutate.data;
      let positions = mutate.data.positions as SavedPosition[];

      const total = positions.reduce((s, p) => s + p.weight, 0);
      if (normalize) {
        positions = normaliseTo100(positions);
      } else if (Math.abs(total - 1) > 0.00005) {
        // "Save as entered" is only offered at exactly 100%; enforce it here
        // too so a direct API call cannot store a book that does not add up.
        return NextResponse.json(
          {
            error: `Weights total ${(total * 100).toFixed(2)}% — must be exactly 100% to save as entered`,
            total: total * 100,
          },
          { status: 400 },
        );
      }

      // New tickers need a baseline of their own, struck at the moment they
      // enter. Without it their return would be measured from the portfolio's
      // creation date, crediting them with a move they were not there for.
      const existing = await getPortfolio(id);
      if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

      const missing = positions
        .map((p) => p.ticker)
        .filter((t) => !(t in existing.baseline.prices));
      if (missing.length) {
        await addBaselinePrices(id, (await captureBaseline(missing, 0, "USD")).prices);
      }

      const updated = await updateAllocation(id, positions, note);
      return updated
        ? NextResponse.json({ portfolio: updated })
        : NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }
}
