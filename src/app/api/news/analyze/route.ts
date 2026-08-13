import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/server/context";
import { generateJson, isAiConfigured } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

/**
 * On-demand headline analysis.
 *
 * Reached only from an explicit AI ANALYZE click. The feed itself never calls
 * this — summarising every headline on arrival would spend tokens linearly in
 * how long the page is left open, for articles nobody read.
 *
 * The prompt carries the headline plus a one-line-per-position snapshot of the
 * book. That is a few hundred tokens; sending price history or the full
 * analytics bundle would be orders of magnitude more for no better answer.
 */

const Body = z.object({
  headline: z.string().min(3).max(500),
  summary: z.string().max(2000).optional(),
  source: z.string().max(120).optional(),
  /** Position codes the deterministic matcher already linked to this story. */
  codes: z.array(z.string().max(24)).max(30).optional(),
});

const SCHEMA = {
  type: "object",
  properties: {
    stance: { type: "string", enum: ["bullish", "bearish", "neutral"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    whyItMatters: { type: "string" },
    affected: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: "string" },
          direction: { type: "string", enum: ["positive", "negative", "unclear"] },
          note: { type: "string" },
        },
        required: ["code", "direction", "note"],
        additionalProperties: false,
      },
    },
    secondOrder: { type: "array", items: { type: "string" } },
  },
  required: ["stance", "confidence", "whyItMatters", "affected", "secondOrder"],
  additionalProperties: false,
} as const;

export interface NewsAnalysis {
  stance: "bullish" | "bearish" | "neutral";
  confidence: "low" | "medium" | "high";
  whyItMatters: string;
  affected: { code: string; direction: "positive" | "negative" | "unclear"; note: string }[];
  secondOrder: string[];
}

const SYSTEM = `You are an analyst on an investment committee reading a single headline for one specific portfolio.

Answer only about this portfolio. Be concrete and brief: whyItMatters is at most three sentences, each affected note at most one sentence, and at most three second-order effects.

Say "neutral" and "low" confidence when the headline genuinely does not move this book — a forced call is worse than no call. Only list a position under "affected" if the link is real; do not pad the list to cover the whole portfolio.`;

export async function POST(req: Request) {
  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured — AI analysis is disabled" },
      { status: 503 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { headline, summary, source, codes } = parsed.data;

  const ctx = await getContext({ markets: false });
  // One compact line per position — enough for the model to reason about
  // exposure without shipping the analytics bundle.
  const book = ctx.rows
    .map(
      (r) =>
        `${r.position.code} (${r.position.name}) · ${r.position.assetClass}/${r.position.region} · ${(r.currentWeight * 100).toFixed(1)}% of book · today ${(r.dailyPct * 100).toFixed(2)}%`,
    )
    .join("\n");

  const user = [
    `Headline: ${headline}`,
    source ? `Source: ${source}` : null,
    summary ? `Summary: ${summary}` : null,
    codes?.length ? `Positions our keyword matcher linked: ${codes.join(", ")}` : null,
    "",
    "Portfolio:",
    book || "(no positions loaded)",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const analysis = await generateJson<NewsAnalysis>({
      system: SYSTEM,
      user,
      schema: SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 2000,
      effort: "low",
    });
    return NextResponse.json(analysis);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Analysis failed" },
      { status: 502 },
    );
  }
}
