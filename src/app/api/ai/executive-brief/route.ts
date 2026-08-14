import { NextResponse } from "next/server";
import { AI_LIMIT, checkLimit, clientIdFrom, readJsonCapped } from "@/lib/server/rate-limit";
import { z } from "zod";
import { generateJson, isAiConfigured, describeAiError } from "@/lib/ai/client";
import { getQuotes, getHistories } from "@/lib/providers";
import { getMetrics, getFinancials, getRecommendations, getInsiders } from "@/lib/providers/fundamentals";
import { ordered, overview, earningsQuality } from "@/lib/research/statements";
import { analyseInsiders } from "@/lib/research/insiders";
import { analyseAnalysts } from "@/lib/research/analysts";
import { buildHealth } from "@/lib/research/health";
import { technicalState } from "@/lib/portfolio/alert-engine";
import { getCatalysts } from "@/lib/events/catalysts";
import { themesForAsset, chainsForAsset } from "@/lib/events/chains";
import { companyKind } from "@/lib/research/company-kind";
import { getContext } from "@/lib/server/context";

export const dynamic = "force-dynamic";

/**
 * Executive stock brief — POST only, so no page render or prefetch can trigger
 * it. This is one of the four explicit AI entry points in the app.
 *
 * The context sent to the model is deliberately small: a few dozen
 * pre-computed numbers and labels, never raw price history or full statements.
 * Everything factual is computed here and passed as fact; the model's job is
 * to organise and reason over it, not to recall figures.
 *
 * On attribution: the model is told it has no access to paywalled research and
 * must not imply otherwise. If it has no genuine public institutional view to
 * cite, it must say so rather than inventing a house call.
 */

const Body = z.object({ symbol: z.string().min(1).max(24) });

const SECTION = { type: "string" } as const;

const SCHEMA = {
  type: "object",
  properties: {
    executiveView: SECTION,
    investmentCase: SECTION,
    fundamentals: SECTION,
    valuation: SECTION,
    smartMoney: SECTION,
    ownership: SECTION,
    catalysts: SECTION,
    macroContext: SECTION,
    bullCase: SECTION,
    baseCase: SECTION,
    bearCase: SECTION,
    // Length limits live in the prompt, not here: the structured-output
    // schema rejects `maxItems` on an array and returns a 400 for the whole
    // request — which is why this endpoint failed on every call regardless of
    // account balance.
    topRisks: { type: "array", items: { type: "string" } },
    portfolioFit: SECTION,
    bottomLine: SECTION,
    sources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          basis: {
            type: "string",
            enum: ["FACT", "SOURCE-DERIVED VIEW", "AI INFERENCE"],
          },
          detail: { type: "string" },
        },
        required: ["claim", "basis", "detail"],
        additionalProperties: false,
      },
    },
    confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
    confidenceReason: SECTION,
  },
  required: [
    "executiveView",
    "investmentCase",
    "fundamentals",
    "valuation",
    "smartMoney",
    "ownership",
    "catalysts",
    "macroContext",
    "bullCase",
    "baseCase",
    "bearCase",
    "topRisks",
    "portfolioFit",
    "bottomLine",
    "sources",
    "confidence",
    "confidenceReason",
  ],
  additionalProperties: false,
} as const;

const SYSTEM = `You write equity research briefs for one private investor's own terminal.

Rules that override everything else:
- You have NO access to paywalled or private research. You may refer to publicly reported views from institutions such as Goldman Sachs or BlackRock ONLY where you genuinely recall a public report or widely-reported public comment, and you must say it is public and give the approximate period. If you have no genuine public view for this company, write that no specific public institutional view is available. Never invent a house call, a price target, or an attribution.
- Every figure in the FACTS block is real and computed from filings and market data. Use those numbers; never contradict them and never invent new ones. If a figure is absent, say it is unavailable.
- Label each entry in "sources": FACT for something taken from the FACTS block, SOURCE-DERIVED VIEW for something drawn from public reporting you genuinely recall, AI INFERENCE for your own reasoning.
- "topRisks": at most five entries. "sources": at most eight. These are stated here rather than in the schema, which does not accept length limits.
- The bull, base and bear cases must each be falsifiable and reference concrete drivers.
- No buy or sell recommendation. This is analysis for the reader to act on themselves.
- Be concise. Two to four sentences per section.`;

export async function POST(req: Request) {
  const limit = checkLimit(clientIdFrom(req), "ai/executive-brief", AI_LIMIT);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Too many requests. Try again in ${limit.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  if (!isAiConfigured()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 400 });
  }
  const parsed = Body.safeParse(await readJsonCapped(req));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const symbol = parsed.data.symbol.trim().toUpperCase();

  const [quotes, histories, metrics, financials, recs, insiders, catalysts, ctx] =
    await Promise.all([
      getQuotes([symbol]).catch(() => ({}) as Awaited<ReturnType<typeof getQuotes>>),
      getHistories([symbol], 400).catch(() => ({}) as Awaited<ReturnType<typeof getHistories>>),
      getMetrics(symbol).catch(() => null),
      getFinancials(symbol).catch(() => null),
      getRecommendations(symbol).catch(() => null),
      getInsiders(symbol).catch(() => null),
      getCatalysts(symbol).catch(() => []),
      getContext().catch(() => null),
    ]);

  const candles = histories[symbol]?.candles ?? [];
  const quote = quotes[symbol] ?? null;
  const price = quote?.price ?? candles.at(-1)?.close ?? null;
  const periods = ordered(financials ?? [], 8);
  const health = buildHealth(metrics, periods, symbol);
  const analysts = analyseAnalysts(recs);
  const insiderReport = insiders?.length ? analyseInsiders(insiders) : null;
  const tech = technicalState(candles, price);
  const quality = earningsQuality(periods);
  const kind = companyKind(symbol);

  // Only the labelled headline numbers go to the model — not the statements.
  const facts = {
    symbol,
    companyType: kind,
    price,
    currency: quote?.currency ?? null,
    dataStatus: quote?.status ?? null,
    overview: overview(periods, metrics, symbol).map((s) => ({
      section: s.title,
      items: s.items
        .filter((i) => i.value !== null)
        .map((i) => `${i.label}: ${typeof i.value === "number" ? i.value.toFixed(2) : i.value}`),
    })),
    financialQuality: health.total,
    qualityPillars: health.pillars.map((p) => `${p.label}: ${p.score ?? "N/A"}`),
    strengths: health.strengths.map((s) => s.text),
    watchItems: health.watch.map((s) => s.text),
    earningsQuality: { verdict: quality.verdict, ocfToNetIncome: quality.ocfToNi },
    analystConsensus: analysts.label,
    analystMomentum: analysts.momentum,
    analystCoverage: analysts.latest?.total ?? null,
    priceTargets: "unavailable on the configured data plan",
    insiderSignal: insiderReport?.signal ?? "no filings",
    insiderRationale: insiderReport?.rationale ?? null,
    institutionalOwnership: "unavailable on the configured data plan",
    technical: tech?.state ?? null,
    upcomingCatalysts: catalysts.slice(0, 4).map((c) => `${c.date}: ${c.title}`),
    worldEventThemes: themesForAsset(symbol).map((t) => `${t.theme.label} (${t.exposure.kind}): ${t.exposure.why}`),
    transmissionChains: chainsForAsset(symbol).map((c) => `${c.chain.title}: ${c.nodes.map((n) => n.label).join(" → ")}`),
    heldInPortfolio: ctx?.rows.find((r) => r.position.symbol === symbol)
      ? {
          weight: ctx.rows.find((r) => r.position.symbol === symbol)!.currentWeight,
          unrealizedPnlPct: null,
        }
      : null,
    portfolioContext: ctx
      ? {
          totalValue: ctx.totals.value,
          annualVolatility: ctx.risk.annualVolatility,
        }
      : null,
  };

  try {
    const result = await generateJson({
      system: SYSTEM,
      user: `Write an executive brief for ${symbol}.\n\nFACTS (all real, computed from filings and market data):\n${JSON.stringify(facts, null, 1)}`,
      schema: SCHEMA,
      maxTokens: 6000,
      effort: "medium",
    });
    return NextResponse.json({ brief: result, generatedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { error: describeAiError(e).message },
      { status: describeAiError(e).status },
    );
  }
}
