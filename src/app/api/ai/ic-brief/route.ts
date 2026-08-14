import { NextResponse } from "next/server";
import { AI_LIMIT, checkLimit, clientIdFrom, readJsonCapped } from "@/lib/server/rate-limit";
import { getContext } from "@/lib/server/context";
import { getHistories } from "@/lib/providers";
import { generateJson, isAiConfigured, describeAiError } from "@/lib/ai/client";
import { CRISES, runCrisis } from "@/lib/portfolio/crisis";
import { buildCalendar } from "@/lib/events/calendar";
import { evaluateAlerts } from "@/lib/portfolio/alert-engine";
import { listRules } from "@/lib/server/alert-store";
import { buildXray } from "@/lib/portfolio/xray";

export const dynamic = "force-dynamic";

/**
 * Investment committee brief — POST only, so it cannot fire on a render.
 *
 * The model receives a compact digest of figures this app already computed:
 * weights, risk, drift, crisis coverage, triggered alerts, upcoming events.
 * No price history, no statements, no news bodies.
 */

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    positioning: { type: "string" },
    // `maxItems` is not accepted in a structured-output schema — it makes the
    // API reject the request outright. The counts are stated in the prompt.
    risks: { type: "array", items: { type: "string" } },
    opportunities: { type: "array", items: { type: "string" } },
    actions: { type: "array", items: { type: "string" } },
    watchlist: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
  },
  required: ["summary", "positioning", "risks", "opportunities", "actions", "watchlist", "confidence"],
  additionalProperties: false,
} as const;

const SYSTEM = `
At most five entries each in risks, opportunities, actions and watchlist — the schema does not accept length limits, so keep to it here.
You prepare the discussion note for a one-person investment committee reviewing their own portfolio.

Rules:
- Every figure in the FACTS block is real and already computed. Use those numbers; never invent one, and never contradict them.
- "actions" are discussion points, not instructions. Phrase them as questions or considerations the reader should resolve — this application executes nothing.
- Be specific and short. Name positions and numbers rather than generalities.
- Where data is marked unavailable, say the question cannot be answered from current data rather than guessing.
- No recommendation to buy or sell.`;

export async function POST(req: Request) {
  const limit = checkLimit(clientIdFrom(req), "ai/ic-brief", AI_LIMIT);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Too many requests. Try again in ${limit.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  if (!isAiConfigured()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 400 });
  }

  const ctx = await getContext({ markets: true });
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: 500 });

  const { rows, totals, risk, settings, series, bundle } = ctx;
  const quotable = rows.filter((r) => r.position.symbol);
  const symbols = [...new Set(quotable.map((r) => r.position.symbol!))];
  const benchmark: string = settings.benchmark || "SPY";

  const [histories, rules] = await Promise.all([
    getHistories([...symbols, benchmark], 5000).catch(
      () => ({}) as Awaited<ReturnType<typeof getHistories>>,
    ),
    listRules().catch(() => []),
  ]);

  const positions = quotable.map((r) => ({
    symbol: r.position.symbol!,
    weight: r.currentWeight,
    candles: histories[r.position.symbol!]?.candles ?? [],
  }));

  const candleMap: Record<string, import("@/lib/types").Candle[]> = Object.fromEntries(
    Object.entries(histories).map(([k, v]) => [k, v.candles]),
  );

  const crises = CRISES.map((c) => runCrisis(c, positions, histories[benchmark]?.candles ?? []))
    .filter((r) => r.coverage >= 0.5)
    .map((r) => ({
      episode: r.crisis.name,
      coverage: Number((r.coverage * 100).toFixed(0)),
      totalReturn: r.totalReturn === null ? null : Number(r.totalReturn.toFixed(1)),
      maxDrawdown: r.maxDrawdown === null ? null : Number(r.maxDrawdown.toFixed(1)),
    }));

  const hits = evaluateAlerts(rules, {
    rows,
    quotes: bundle?.quotes ?? {},
    histories: candleMap,
    totals,
    portfolioSeries: series,
  }).filter((h) => h.triggered);

  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const upcoming = buildCalendar(0, 2)
    .filter((e) => e.date >= today && e.date <= horizon)
    .slice(0, 6)
    .map((e) => `${e.date} ${e.title} (${e.importance})`);

  const sorted = [...rows].sort((a, b) => b.currentWeight - a.currentWeight);
  const xray = buildXray(rows);

  const facts = {
    portfolioValue: Number(totals.value.toFixed(0)),
    annualVolatility: Number((risk.annualVolatility * 100).toFixed(2)),
    var95: Number((risk.var95 * 100).toFixed(2)),
    maxDrawdown: Number((risk.maxDrawdown * 100).toFixed(2)),
    sharpe: Number(risk.sharpe.toFixed(2)),
    beta: risk.beta === null ? null : Number(risk.beta.toFixed(2)),
    benchmark,
    top5Weight: Number((sorted.slice(0, 5).reduce((s, r) => s + r.currentWeight, 0) * 100).toFixed(1)),
    largestPositions: sorted.slice(0, 6).map((r) => `${r.position.code} ${(r.currentWeight * 100).toFixed(1)}%`),
    effectiveExposures: xray.effective.map((e) => `${e.label} ${(e.weight * 100).toFixed(1)}%`),
    riskConcentration: [...risk.riskContributions]
      .sort((a, b) => b.pctRc - a.pctRc)
      .slice(0, 5)
      .map((r) => `${r.code}: ${(r.pctRc * 100).toFixed(1)}% of risk on ${(r.weight * 100).toFixed(1)}% of capital`),
    drifted: rows
      .filter((r) => Math.abs(r.drift) > 0.02)
      .map((r) => `${r.position.code} ${(r.drift * 100).toFixed(1)}pp from target`),
    triggeredAlerts: hits.map((h) => `${h.subject}: ${h.detail}`),
    upcomingEvents: upcoming,
    crisisSensitivity: crises,
    lookThrough: "unavailable — ETF holdings are not on the configured data plan",
    institutionalOwnership: "unavailable on the configured data plan",
  };

  try {
    const brief = await generateJson({
      system: SYSTEM,
      user: `Prepare the committee note.\n\nFACTS:\n${JSON.stringify(facts, null, 1)}`,
      schema: SCHEMA,
      maxTokens: 4000,
      effort: "medium",
    });
    return NextResponse.json({ brief, generatedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { error: describeAiError(e).message },
      { status: describeAiError(e).status },
    );
  }
}
