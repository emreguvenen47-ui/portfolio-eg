import { NextResponse } from "next/server";
import { z } from "zod";
import { getUniverseMeta, queryUniverse, type UniverseQuery } from "@/lib/data/opportunities";

export const dynamic = "force-dynamic";

/**
 * NATURAL-LANGUAGE SCREENER.
 *
 * text → structured UniverseQuery → the SAME deterministic in-memory screener
 * over the precomputed universe. The language layer never picks stocks; it
 * only builds filters, and the interpretation it used is returned verbatim so
 * the user can see (and correct) how the sentence was read.
 */

const Body = z.object({ text: z.string().min(2).max(400) });

interface Parsed {
  query: UniverseQuery;
  interpretation: string[];
  unrecognized: string[];
}

const SECTOR_WORDS: Array<[RegExp, string]> = [
  [/teknoloji|technology|tech\b/i, "Technology"],
  [/sağlık|health/i, "Healthcare"],
  [/finans|financial|banka|bank/i, "Financial Services"],
  [/enerji|energy/i, "Energy"],
  [/sanayi|industrial/i, "Industrials"],
  [/emlak|real estate|reit/i, "Real Estate"],
  [/tüketici döngüsel|consumer cyclical/i, "Consumer Cyclical"],
  [/temel tüketici|consumer defensive|staple/i, "Consumer Defensive"],
  [/iletişim|communication/i, "Communication Services"],
  [/hammadde|materials/i, "Basic Materials"],
  [/utility|utilities|elektrik/i, "Utilities"],
];

function parse(text: string): Parsed {
  const t = text.toLowerCase();
  const q: UniverseQuery = { limit: 100 };
  const why: string[] = [];
  const unrecognized: string[] = [];

  const numAfter = (re: RegExp): number | null => {
    const m = re.exec(t);
    return m ? Number(m[1]) : null;
  };

  // Valuation
  const pe = numAfter(/(?:pe|f\/k|p\/e)[^\d]{0,12}(\d{1,3})\s*(?:altı|under|below|<|less)/i) ?? numAfter(/(?:altında|under|below|<)\s*(\d{1,3})\s*(?:pe|p\/e|f\/k)/i);
  if (pe !== null) {
    q.maxPe = pe;
    why.push(`P/E < ${pe}`);
  }
  const fpe = numAfter(/forward\s*p?\/?e[^\d]{0,10}(\d{1,3})\s*(?:altı|under|below|<)/i);
  if (fpe !== null) {
    q.maxForwardPe = fpe;
    why.push(`Forward P/E < ${fpe}`);
  }
  const pb = numAfter(/p\/?b[^\d]{0,10}(\d{1,3}(?:\.\d+)?)\s*(?:altı|under|below|<)/i);
  if (pb !== null) {
    q.maxPb = pb;
    why.push(`P/B < ${pb}`);
  }

  // Quality / returns. "ROIC yüksek" — universe rows carry ROE; high-ROIC maps
  // to the closest stored field and the interpretation SAYS so honestly.
  if (/roic.{0,12}(yüksek|high)|high.{0,6}roic/i.test(t) || /roe.{0,12}(yüksek|high)|high.{0,6}roe/i.test(t)) {
    q.minRoe = 0.15;
    why.push("ROE ≥ 15% (high capital returns; screener row carries ROE)");
  }
  const roeN = numAfter(/roe[^\d]{0,10}(\d{1,3})\s*(?:üstü|üzeri|over|above|>)/i);
  if (roeN !== null) {
    q.minRoe = roeN / 100;
    why.push(`ROE ≥ ${roeN}%`);
  }

  // Growth
  if (/(revenue|ciro|gelir).{0,20}(büyü|grow)/i.test(t)) {
    const g = numAfter(/(?:%|yüzde)\s*(\d{1,3}).{0,20}büyü/i) ?? numAfter(/grow(?:ing|th)?[^\d]{0,12}(\d{1,3})\s*%/i);
    q.minRevenueGrowth = g !== null ? g / 100 : 0.08;
    why.push(`Revenue growth ≥ ${((q.minRevenueGrowth ?? 0) * 100).toFixed(0)}%`);
  }
  if (/(eps|kazanç|earnings).{0,20}(büyü|grow)/i.test(t)) {
    q.minEpsGrowth = 0.08;
    why.push("EPS growth ≥ 8%");
  }

  // Profitability
  if (/(kâr|karlı|profitable|net margin)/i.test(t) && !/margin\s*<|düşük/i.test(t)) {
    q.minNetMargin = 0.05;
    why.push("Net margin ≥ 5%");
  }
  if (/fcf|serbest nakit/i.test(t)) {
    q.minFcfYield = 0.03;
    why.push("FCF yield ≥ 3%");
  }

  // Technical
  if (/(desteğe yakın|near support|destek üstü)/i.test(t)) {
    q.maxDistanceToSupportPct = 4;
    q.minTechnicalScore = 40;
    why.push("Within 4% of primary support (technical score ≥ 40)");
  }
  if (/breakout|kırılım/i.test(t)) {
    q.setups = ["BREAKOUT", "BREAKOUT_RETEST"];
    why.push("Breakout / breakout-retest setups");
  }
  if (/uptrend|yükselen trend|yükseliş/i.test(t)) {
    q.weeklyRegimes = ["UPTREND", "RECOVERY"];
    why.push("Weekly regime UPTREND/RECOVERY");
  }
  const rr = numAfter(/r[:\/ ]?r[^\d]{0,8}([\d.]+)/i);
  if (rr !== null) {
    q.minRiskReward = rr;
    why.push(`R:R ≥ ${rr}`);
  }
  if (/(buy sinyal|buy signal|alım sinyal)/i.test(t)) {
    q.signals = ["STRONG_BUY", "BUY", "BREAKOUT_BUY", "BUY_ON_RETEST", "TACTICAL_BUY"];
    why.push("Signal in the BUY family");
  }

  // Size
  if (/large.?cap|büyük şirket/i.test(t)) {
    q.minMarketCap = 10e9;
    why.push("Market cap ≥ $10B");
  }
  if (/small.?cap|küçük şirket/i.test(t)) {
    q.maxMarketCap = 2e9;
    why.push("Market cap ≤ $2B");
  }
  const mcapB = numAfter(/(\d{1,4})\s*(?:milyar|billion|b)\b.{0,12}(?:üstü|üzeri|over|above|>)/i);
  if (mcapB !== null) {
    q.minMarketCap = mcapB * 1e9;
    why.push(`Market cap ≥ $${mcapB}B`);
  }

  // Valuation state
  if (/(ucuz|cheap|value|iskonto|discount|upside)/i.test(t)) {
    q.minUpsidePct = 15;
    q.valuationConfidence = ["HIGH", "MEDIUM"];
    why.push("Model upside ≥ 15% with usable valuation confidence");
  }
  if (/(revizyon|revision)/i.test(t)) {
    q.minRevisionScore = 60;
    why.push("Revision score ≥ 60");
  }

  // Sectors
  for (const [re, sector] of SECTOR_WORDS) {
    if (re.test(t)) {
      q.sectors = [...(q.sectors ?? []), sector];
      why.push(`Sector: ${sector}`);
    }
  }

  if (why.length === 0) unrecognized.push(text);
  return { query: q, interpretation: why, unrecognized };
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const { query, interpretation, unrecognized } = parse(parsed.data.text);
  if (interpretation.length === 0) {
    return NextResponse.json({
      interpretation: [],
      unrecognized,
      answer:
        "Could not extract any filter from that sentence. Examples: “PE 20 altı, ROIC yüksek, revenue büyüyen, desteğe yakın teknoloji şirketleri”, “breakout setups with R:R 2, large cap”.",
      rows: [],
      total: 0,
    });
  }
  const t0 = Date.now();
  const result = queryUniverse(query);
  return NextResponse.json({
    interpretation,
    unrecognized,
    query,
    ...result,
    coverage: getUniverseMeta(),
    queryMs: Date.now() - t0,
  });
}
