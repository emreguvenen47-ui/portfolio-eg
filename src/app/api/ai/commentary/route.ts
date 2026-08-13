import { NextResponse } from "next/server";
import { AI_LIMIT, checkLimit, clientIdFrom, readJsonCapped } from "@/lib/server/rate-limit";
import { getContext } from "@/lib/server/context";
import { generateJson, isAiConfigured } from "@/lib/ai/client";
import { exposureBy } from "@/lib/portfolio/analytics";

export const dynamic = "force-dynamic";

/**
 * Portfolio commentary — POST only, fired from an explicit click.
 *
 * The prompt carries one line per position plus a dozen pre-computed
 * aggregates. Every number in it was calculated here; the model is asked to
 * interpret, not to compute, and no price history is sent.
 */

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    allocation: { type: "string" },
    concentration: { type: "string" },
    diversification: { type: "string" },
    currency: { type: "string" },
    themes: { type: "string" },
    overlaps: { type: "array", items: { type: "string" } },
    strongest: { type: "array", items: { type: "string" } },
    weakest: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    ideas: { type: "array", items: { type: "string" } },
  },
  required: [
    "headline",
    "allocation",
    "concentration",
    "diversification",
    "currency",
    "themes",
    "overlaps",
    "strongest",
    "weakest",
    "risks",
    "ideas",
  ],
  additionalProperties: false,
} as const;

const SYSTEM = `You are writing an investment-committee note on one portfolio you have been handed a summary of.

Every figure you cite must come from the data given — do not estimate, annualise, or add market context you were not supplied. Where the data does not support a claim, say so rather than filling the gap.

Each prose field is one or two sentences. At most three items in each list. Lead with the finding, not with the method.

This is commentary on structure and exposure, not advice: describe what the allocation implies and where it is fragile, and frame improvement ideas as options with their trade-off stated.`;

export interface PortfolioCommentary {
  headline: string;
  allocation: string;
  concentration: string;
  diversification: string;
  currency: string;
  themes: string;
  overlaps: string[];
  strongest: string[];
  weakest: string[];
  risks: string[];
  ideas: string[];
}

export async function POST(req: Request) {
  const limit = checkLimit(clientIdFrom(req), "ai/commentary", AI_LIMIT);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Too many requests. Try again in ${limit.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured — commentary is disabled" },
      { status: 503 },
    );
  }

  const ctx = await getContext({ markets: true });
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: 400 });

  const { rows, totals, risk, portfolio } = ctx;

  const positions = rows
    .map(
      (r) =>
        `${r.position.code} ${r.position.name} · ${r.position.assetClass}/${r.position.region} · ${(r.currentWeight * 100).toFixed(1)}% (target ${(r.targetWeight * 100).toFixed(1)}%) · themes: ${r.position.themes.join("/") || "none"}`,
    )
    .join("\n");

  const assetMix = exposureBy(rows, (p) => p.assetClass)
    .map((x) => `${x.label} ${(x.weight * 100).toFixed(1)}%`)
    .join(", ");
  const regionMix = exposureBy(rows, (p) => p.region)
    .map((x) => `${x.label} ${(x.weight * 100).toFixed(1)}%`)
    .join(", ");
  const themeMix = exposureBy(rows, (p) => p.themes[0] ?? "Untagged")
    .map((x) => `${x.label} ${(x.weight * 100).toFixed(1)}%`)
    .join(", ");

  const hhi = rows.reduce((s, r) => s + r.currentWeight ** 2, 0);

  const user = [
    `Portfolio: ${portfolio.meta.title}, ${rows.length} positions, $${totals.value.toFixed(0)}.`,
    `Asset class: ${assetMix}`,
    `Region: ${regionMix}`,
    `Theme: ${themeMix}`,
    `Currency: USD ${(totals.usdExposurePct * 100).toFixed(1)}%, TRY ${(totals.tryExposurePct * 100).toFixed(1)}%`,
    `Concentration: largest ${(Math.max(...rows.map((r) => r.currentWeight)) * 100).toFixed(1)}%, effective positions ${(1 / hhi).toFixed(1)} of ${rows.length}`,
    `Risk: annual vol ${(risk.annualVolatility * 100).toFixed(1)}%, Sharpe ${risk.sharpe.toFixed(2)}, 95% VaR ${(risk.var95 * 100).toFixed(1)}%, diversification benefit ${(risk.diversificationBenefit * 100).toFixed(1)}pp, method ${risk.method}`,
    `Top risk contributors: ${risk.riskContributions
      .slice(0, 4)
      .map((r) => `${r.code} ${(r.pctRc * 100).toFixed(0)}%`)
      .join(", ")}`,
    "",
    "Positions:",
    positions,
  ].join("\n");

  try {
    const commentary = await generateJson<PortfolioCommentary>({
      system: SYSTEM,
      user,
      schema: SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 4000,
      effort: "medium",
    });
    return NextResponse.json({ ...commentary, generatedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Commentary failed" },
      { status: 502 },
    );
  }
}
