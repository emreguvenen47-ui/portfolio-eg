import { NextResponse } from "next/server";
import { z } from "zod";
import "@/lib/providers/register";
import { getHistoricalPrices } from "@/lib/providers";
import { buildTechnicalReport } from "@/lib/engines/technical-report";
import { fibonacciFromSwings } from "@/lib/engines/indicators";

export const dynamic = "force-dynamic";

/**
 * NATURAL-LANGUAGE TECHNICAL COMMAND.
 *
 * intent → deterministic technical function → real OHLC calculation → overlay.
 * The language layer ONLY routes to functions; every number in the answer
 * comes from the same engines the chart and the report use. No model invents
 * a price, and an unrecognized command says so instead of guessing.
 */

const Body = z.object({
  symbol: z.string().min(1).max(24),
  text: z.string().min(1).max(300),
  tf: z.enum(["DAILY", "WEEKLY"]).default("DAILY"),
});

type Action =
  | { kind: "SHOW_LEVELS"; which: "SUPPORT" | "RESISTANCE" | "BOTH" }
  | { kind: "FIB" }
  | { kind: "ADD_MA"; period: number }
  | { kind: "ADD_INDICATOR"; id: string }
  | { kind: "TREND_CONFLICT" }
  | { kind: "BREAKOUT_CHECK" }
  | { kind: "INVALIDATION" }
  | { kind: "RR_ENTRIES"; min: number }
  | { kind: "SHOW_GROUP"; group: "ENTRY" | "STOP" | "TARGET" }
  | { kind: "UNKNOWN" };

/** Deterministic bilingual (TR/EN) intent parser — keyword rules, no model. */
function parseIntent(raw: string): Action {
  const t = raw.toLowerCase();
  const maMatch = /(?:ma|sma|ema|ortalama)\s*-?\s*(\d{1,3})/.exec(t);
  if (maMatch && (t.includes("ekle") || t.includes("add") || t.includes("göster") || t.includes("show") || t.includes("aç")))
    return { kind: "ADD_MA", period: Math.min(400, Math.max(2, Number(maMatch[1]))) };
  if (/(rsi)/.test(t)) return { kind: "ADD_INDICATOR", id: "rsi" };
  if (/(macd)/.test(t)) return { kind: "ADD_INDICATOR", id: "macd" };
  if (/(bollinger|bant)/.test(t)) return { kind: "ADD_INDICATOR", id: "bb" };
  if (/(fib|fibonacci)/.test(t)) return { kind: "FIB" };
  if (/(weekly|haftalık).*(daily|günlük)|çelişiyor|çelişki|conflict/.test(t)) return { kind: "TREND_CONFLICT" };
  if (/(breakout|kırılım).*(gerçek|real|geçerli|valid)|gerçek mi/.test(t)) return { kind: "BREAKOUT_CHECK" };
  if (/(invalidation|geçersiz|iptal|bozul)/.test(t)) return { kind: "INVALIDATION" };
  const rrMatch = /r[:\/ ]?r\s*(?:>|üstü|above|en az|min)?\s*([\d.]+)/.exec(t);
  if (rrMatch) return { kind: "RR_ENTRIES", min: Number(rrMatch[1]) };
  if (/(stop)/.test(t)) return { kind: "SHOW_GROUP", group: "STOP" };
  if (/(target|hedef)/.test(t)) return { kind: "SHOW_GROUP", group: "TARGET" };
  if (/(entry|giriş)/.test(t)) return { kind: "SHOW_GROUP", group: "ENTRY" };
  if (/(direnç|resistance)/.test(t) && /(destek|support)/.test(t)) return { kind: "SHOW_LEVELS", which: "BOTH" };
  if (/(direnç|resistance)/.test(t)) return { kind: "SHOW_LEVELS", which: "RESISTANCE" };
  if (/(destek|support)/.test(t)) return { kind: "SHOW_LEVELS", which: "SUPPORT" };
  return { kind: "UNKNOWN" };
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const { symbol, text, tf } = parsed.data;

  const action = parseIntent(text);
  if (action.kind === "UNKNOWN") {
    return NextResponse.json({
      intent: "UNKNOWN",
      answer:
        "Command not recognized. Try: “ana destekleri göster”, “fibonacci çiz”, “MA200 ekle”, “RSI aç”, “weekly ile daily çelişiyor mu”, “bu breakout gerçek mi”, “en mantıklı invalidation neresi”, “R:R > 2 entry göster”.",
      overlays: [],
      clientOps: [],
    });
  }

  const history = await getHistoricalPrices(symbol.toUpperCase(), 1300);
  const report = buildTechnicalReport(symbol.toUpperCase(), history.candles, tf);
  if (!report) return NextResponse.json({ error: "not enough history" }, { status: 200 });

  const num = (v: number | null | undefined) => (v == null ? "N/A" : v.toFixed(2));
  /** clientOps tell the chart what to toggle; overlays add price lines. */
  const res: { intent: string; answer: string; overlays: typeof report.overlays; clientOps: Array<Record<string, unknown>> } = {
    intent: action.kind,
    answer: "",
    overlays: [],
    clientOps: [],
  };

  switch (action.kind) {
    case "SHOW_LEVELS": {
      const s = report.overlays.filter((o) => o.kind === "SUPPORT");
      const r = report.overlays.filter((o) => o.kind === "RESISTANCE");
      res.overlays = action.which === "SUPPORT" ? s : action.which === "RESISTANCE" ? r : [...s, ...r];
      res.answer =
        action.which === "SUPPORT"
          ? `Supports: ${s.map((x) => x.price).join(", ") || "none detected"}.`
          : action.which === "RESISTANCE"
            ? `Resistances: ${r.map((x) => x.price).join(", ") || "none detected"}.`
            : `Supports: ${s.map((x) => x.price).join(", ") || "—"} · Resistances: ${r.map((x) => x.price).join(", ") || "—"}.`;
      break;
    }
    case "FIB": {
      const fib = fibonacciFromSwings(tf === "WEEKLY" ? history.candles : history.candles, 253);
      if (!fib) {
        res.answer = "No meaningful swing pair found in the last year — no Fibonacci drawn.";
        break;
      }
      res.overlays = report.overlays.filter((o) => o.kind === "FIB");
      res.clientOps = [
        {
          op: "add-fib",
          high: { time: fib.swingHigh.date, price: fib.swingHigh.price },
          low: { time: fib.swingLow.date, price: fib.swingLow.price },
        },
      ];
      res.answer = `Fibonacci drawn on the dominant swing: low ${fib.swingLow.price.toFixed(2)} (${fib.swingLow.date}) → high ${fib.swingHigh.price.toFixed(2)} (${fib.swingHigh.date}). ${report.fibonacci.nearest ?? ""}`;
      break;
    }
    case "ADD_MA":
      res.clientOps = [{ op: "add-ma", period: action.period }];
      res.answer = `MA${action.period} added to the chart.`;
      break;
    case "ADD_INDICATOR":
      res.clientOps = [{ op: "add-indicator", id: action.id }];
      res.answer = `${action.id.toUpperCase()} pane opened.`;
      break;
    case "TREND_CONFLICT":
      res.answer = report.structure.counterTrend
        ? `YES — conflict: daily is ${report.structure.dailyTrend.replaceAll("_", " ")} while weekly is ${report.structure.weeklyTrend.replaceAll("_", " ")}. Counter-trend setups are tactical only.`
        : `No — aligned: daily ${report.structure.dailyTrend.replaceAll("_", " ")}, weekly ${report.structure.weeklyTrend.replaceAll("_", " ")}.`;
      break;
    case "BREAKOUT_CHECK": {
      const vol = report.volume.lastVsAvg;
      const above = report.levels.breakoutLevel !== null && report.price > report.levels.breakoutLevel;
      res.answer = above
        ? `Price ${num(report.price)} is above the breakout level ${num(report.levels.breakoutLevel)}. Volume ${vol !== null ? `${vol.toFixed(2)}× the 20-bar average` : "N/A"} — ${vol !== null && vol >= 1.3 ? "expansion CONFIRMS the move" : "no volume confirmation yet; a retest of the level is the higher-quality entry"}. Setup freshness: ${report.verdict.freshness}.`
        : `No active breakout: price ${num(report.price)} is below the breakout level ${num(report.levels.breakoutLevel)}. Watch a daily close above it on ≥1.3× volume.`;
      break;
    }
    case "INVALIDATION": {
      const std = report.stops.find((s) => s.kind === "STANDARD") ?? report.stops[0];
      res.answer = std
        ? `Most logical invalidation: ${num(std.price)} — ${std.reason} (risk ${std.riskPct}%, ${std.atrDistance} ATR below the reference). A daily close below it voids the current structure.`
        : `No published stop (no actionable structure). Structural breakdown level: ${num(report.levels.breakdownLevel)}.`;
      res.overlays = report.overlays.filter((o) => o.kind === "STOP");
      break;
    }
    case "RR_ENTRIES": {
      const combos = report.riskReward.filter((c) => c.rr >= action.min);
      res.answer = combos.length
        ? `Entry/stop combinations with R:R ≥ ${action.min}: ${combos.map((c) => `${c.combo} → R:R ${c.rr}`).join(" · ")}.`
        : `No entry/stop/T1 combination currently reaches R:R ${action.min}. Best available: ${report.riskReward[0] ? `${report.riskReward[0].combo} at ${report.riskReward[0].rr}` : "none (missing structure)"}.`;
      res.overlays = report.overlays.filter((o) => o.kind === "ENTRY" || o.kind === "STOP" || o.kind === "TARGET");
      break;
    }
    case "SHOW_GROUP":
      res.overlays = report.overlays.filter((o) => o.kind === action.group);
      res.answer = `${action.group} levels: ${res.overlays.map((o) => `${o.label} ${o.price}`).join(" · ") || "none published"}.`;
      break;
  }

  return NextResponse.json(res);
}
