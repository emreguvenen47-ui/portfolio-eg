import { NextResponse } from "next/server";
import { AI_LIMIT, checkLimit, clientIdFrom, readJsonCapped } from "@/lib/server/rate-limit";
import { z } from "zod";
import { getContext } from "@/lib/server/context";
import { generateJson, isAiConfigured, describeAiError } from "@/lib/ai/client";
import {
  buildPortfolio,
  compare,
  type AiDraft,
  type AiPosition,
} from "@/lib/ai/portfolio-model";

export const dynamic = "force-dynamic";

const ASSET_CLASSES = ["Cash", "Equity", "Commodity", "Alternative", "Unallocated"] as const;
const REGIONS = ["Turkey", "US", "Europe", "China", "EM", "Global", "Unallocated"] as const;
const ROLES = [
  "CORE",
  "GROWTH",
  "DEFENSIVE",
  "INCOME",
  "HEDGE",
  "DIVERSIFIER",
  "LIQUIDITY",
] as const;

const Body = z.object({
  description: z.string().max(4000).default(""),
  amount: z.number().positive().max(1e12).default(100_000),
  currency: z.enum(["USD", "TRY", "EUR"]).default("USD"),
  horizon: z.enum(["<2y", "2-5y", "5-10y", "10y+"]).optional(),
  risk: z.enum(["Conservative", "Moderate", "Growth", "Aggressive"]).optional(),
  liquidity: z.enum(["Low", "Medium", "High"]).optional(),
  preferences: z.array(z.string().max(40)).max(20).default([]),
  compareWithMine: z.boolean().default(true),
});

/** Response schema. Enums keep the model inside the vocabulary the UI renders. */
const SCHEMA = {
  type: "object",
  properties: {
    investorProfile: {
      type: "object",
      properties: {
        investorType: { type: "string" },
        riskScore: { type: "integer" },
        timeHorizon: { type: "string" },
        liquidityRequirement: { type: "string", enum: ["Low", "Medium", "High"] },
        primaryObjective: { type: "string" },
        keyConcerns: { type: "array", items: { type: "string" } },
        suggestedEquityRange: { type: "string" },
        suggestedDefensiveRange: { type: "string" },
        suggestedCashRange: { type: "string" },
      },
      required: [
        "investorType",
        "riskScore",
        "timeHorizon",
        "liquidityRequirement",
        "primaryObjective",
        "keyConcerns",
        "suggestedEquityRange",
        "suggestedDefensiveRange",
        "suggestedCashRange",
      ],
      additionalProperties: false,
    },
    portfolio: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          name: { type: "string" },
          weight: { type: "number" },
          assetClass: { type: "string", enum: ASSET_CLASSES },
          region: { type: "string", enum: REGIONS },
          role: { type: "string", enum: ROLES },
          reason: { type: "string" },
        },
        required: ["ticker", "name", "weight", "assetClass", "region", "role", "reason"],
        additionalProperties: false,
      },
    },
    risk: {
      type: "object",
      properties: {
        expectedRisk: { type: "string", enum: ["LOW", "MODERATE", "HIGH"] },
        largestRisk: { type: "string" },
        mainDrawdownDriver: { type: "string" },
        inflationProtection: { type: "string", enum: ["Low", "Medium", "Strong"] },
        currencyDiversification: { type: "string", enum: ["Weak", "Medium", "Strong"] },
        liquidity: { type: "string", enum: ["Low", "Medium", "High"] },
        topRisks: { type: "array", items: { type: "string" } },
        topStrengths: { type: "array", items: { type: "string" } },
        invalidations: { type: "array", items: { type: "string" } },
      },
      required: [
        "expectedRisk",
        "largestRisk",
        "mainDrawdownDriver",
        "inflationProtection",
        "currencyDiversification",
        "liquidity",
        "topRisks",
        "topStrengths",
        "invalidations",
      ],
      additionalProperties: false,
    },
  },
  required: ["investorProfile", "portfolio", "risk"],
  additionalProperties: false,
} as const;

const SYSTEM = `You are a portfolio strategist producing a modelled example allocation for one investor. This is research and modelling output, not personalised financial advice, and the interface says so.

Return between 5 and 12 positions using liquid, widely-available exchange-traded instruments — real tickers only, no bespoke products, no single stocks unless the investor explicitly asked for one. Weights are percentages and must sum to exactly 100.

Give each position a role and a reason tied to something the investor actually said. Do not restate the asset class as the reason.

Reflect stated constraints literally: a near-term liquidity need means genuinely liquid short-duration holdings, and a stated valuation concern means underweighting that exposure, not omitting it entirely.

Keep every free-text field to one or two sentences. List at most three items in keyConcerns, topRisks, topStrengths and invalidations.`;

export async function POST(req: Request) {
  const limit = checkLimit(clientIdFrom(req), "ai/build", AI_LIMIT);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Too many requests. Try again in ${limit.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured — the builder is disabled" },
      { status: 503 },
    );
  }

  const parsed = Body.safeParse(await readJsonCapped(req));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const input = parsed.data;

  if (!input.description.trim() && !input.risk && !input.horizon) {
    return NextResponse.json(
      { error: "Describe your goals, or pick a risk level and time horizon" },
      { status: 400 },
    );
  }

  const user = [
    input.description.trim() ? `Investor's own words:\n${input.description.trim()}` : null,
    `Amount: ${input.amount.toLocaleString("en-US")} ${input.currency}`,
    input.horizon ? `Time horizon: ${input.horizon}` : null,
    input.risk ? `Risk preference: ${input.risk}` : null,
    input.liquidity ? `Liquidity need: ${input.liquidity}` : null,
    input.preferences.length ? `Stated preferences: ${input.preferences.join(", ")}` : null,
    "",
    "Where the structured fields and the investor's own words disagree, follow the words and note the tension in keyConcerns.",
  ]
    .filter(Boolean)
    .join("\n");

  let draft: AiDraft;
  try {
    draft = await generateJson<AiDraft>({
      system: SYSTEM,
      user,
      schema: SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 8000,
      effort: "medium",
    });
  } catch (e) {
    return NextResponse.json(
      { error: describeAiError(e).message },
      { status: describeAiError(e).status },
    );
  }

  // Validate semantics the schema cannot express.
  const positions = (draft.portfolio ?? []).filter(
    (p): p is AiPosition =>
      Boolean(p?.ticker) && Number.isFinite(p.weight) && p.weight > 0,
  );
  if (positions.length < 3) {
    return NextResponse.json(
      { error: "Model returned too few usable positions — try rephrasing" },
      { status: 502 },
    );
  }
  if (positions.length > 12) positions.length = 12;

  const built = buildPortfolio(positions, input.amount, input.currency);

  // Comparison runs against the real book, using the same exposure buckets.
  let comparison = null;
  if (input.compareWithMine) {
    try {
      const ctx = await getContext({ markets: false });
      if (!ctx.error && ctx.rows.length) {
        comparison = compare(built, ctx.rows, ctx.risk.annualVolatility);
      }
    } catch {
      // The generated portfolio stands on its own without a comparison.
    }
  }

  return NextResponse.json({
    investorProfile: draft.investorProfile,
    risk: draft.risk,
    built,
    comparison,
    generatedAt: new Date().toISOString(),
  });
}
