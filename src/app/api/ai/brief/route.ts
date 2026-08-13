import { NextResponse } from "next/server";
import { AI_LIMIT, checkLimit, clientIdFrom, readJsonCapped } from "@/lib/server/rate-limit";
import { getContext } from "@/lib/server/context";
import { generateJson, isAiConfigured } from "@/lib/ai/client";
import { assessHealth } from "@/lib/portfolio/health";
import { buildTheses } from "@/lib/portfolio/theses";
import { fetchNews } from "@/lib/news/sources";
import { attachImpacts } from "@/lib/news/impact";

export const dynamic = "force-dynamic";

/**
 * Daily brief — POST only, so it cannot be triggered by a page render or a
 * prefetch. Everything sent to the model is pre-aggregated here: eight or so
 * numbers, the top movers, and a handful of headline strings. The full
 * analytics bundle and all price history stay server-side.
 */

const SCHEMA = {
  type: "object",
  properties: {
    bullets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            enum: [
              "portfolio-move",
              "largest-contributor",
              "largest-detractor",
              "market-move",
              "news",
              "risk-change",
              "thesis-warning",
              "to-monitor",
            ],
          },
          text: { type: "string" },
        },
        required: ["topic", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["bullets"],
  additionalProperties: false,
} as const;

export interface DailyBrief {
  bullets: { topic: string; text: string }[];
  generatedAt: string;
}

const SYSTEM = `You write the morning brief for one investor's own portfolio, in the register of an investment committee note.

Produce at most eight bullets, at most one per topic, one or two sentences each. Cover only topics the supplied data actually supports — if there is no thesis warning in the data, omit that bullet rather than inventing one.

Every number you state must come from the data given. Do not estimate, extrapolate, or add market context you were not given. Write plainly, lead with what happened, and skip preamble.`;

export async function POST(req: Request) {
  const limit = checkLimit(clientIdFrom(req), "ai/brief", AI_LIMIT);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Too many requests. Try again in ${limit.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured — AI features are disabled" },
      { status: 503 },
    );
  }

  const ctx = await getContext({ markets: true });
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: 400 });

  const { rows, totals, bundle, risk, settings, portfolio } = ctx;
  const theses = buildTheses(portfolio);
  const health = assessHealth(rows, risk, bundle.quotes, theses, settings);

  const byContribution = [...rows].sort((a, b) => b.dailyPnl - a.dailyPnl);
  const top = byContribution[0];
  const bottom = byContribution.at(-1);

  // Headlines are already filtered to those touching the book; send only the
  // strings, not the impact objects.
  let headlines: string[] = [];
  try {
    const symbols = portfolio.positions
      .map((p) => p.symbol)
      .filter((s): s is string => Boolean(s));
    const { articles } = await fetchNews(symbols);
    headlines = attachImpacts(articles, rows, totals.value)
      .filter((i) => i.impacts.length > 0)
      .slice(0, 6)
      .map((i) => `${i.headline} (${i.source})`);
  } catch {
    // A brief without news is still a brief.
  }

  const marketLines = ["SPX", "NDX", "VIX", "DXY", "USDTRY", "GOLD", "COPPER"]
    .map((k) => {
      const q = bundle.quotes[k];
      return q ? `${k} ${q.price.toFixed(2)} (${q.changePercent.toFixed(2)}%)` : null;
    })
    .filter(Boolean)
    .join(", ");

  const user = [
    `Portfolio value: $${totals.value.toFixed(0)}, today ${(totals.dailyPct * 100).toFixed(2)}% ($${totals.dailyPnl.toFixed(0)}), YTD ${(totals.ytdPct * 100).toFixed(2)}%.`,
    top ? `Largest contributor today: ${top.position.code} ${(top.dailyPct * 100).toFixed(2)}% ($${top.dailyPnl.toFixed(0)}).` : null,
    bottom && bottom !== top
      ? `Largest detractor today: ${bottom.position.code} ${(bottom.dailyPct * 100).toFixed(2)}% ($${bottom.dailyPnl.toFixed(0)}).`
      : null,
    `Annual volatility ${(risk.annualVolatility * 100).toFixed(1)}%, 95% VaR ${(risk.var95 * 100).toFixed(1)}%, Sharpe ${risk.sharpe.toFixed(2)}.`,
    `Health score ${health.score}/100 — ${health.signals.map((s) => `${s.label}: ${s.state}`).join(", ")}.`,
    marketLines ? `Market: ${marketLines}.` : null,
    theses.filter((t) => t.status !== "GREEN").length
      ? `Theses not green: ${theses
          .filter((t) => t.status !== "GREEN")
          .map((t) => `${t.code} ${t.status}`)
          .join(", ")}.`
      : "All theses green.",
    headlines.length ? `Headlines touching the book:\n- ${headlines.join("\n- ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const brief = await generateJson<{ bullets: { topic: string; text: string }[] }>({
      system: SYSTEM,
      user,
      schema: SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 3000,
      effort: "low",
    });
    return NextResponse.json({
      bullets: brief.bullets.slice(0, 8),
      generatedAt: new Date().toISOString(),
    } satisfies DailyBrief);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Brief generation failed" },
      { status: 502 },
    );
  }
}
