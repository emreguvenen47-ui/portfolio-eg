import "server-only";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { writablePath } from "@/lib/server/writable-dir";
import type { Quote, PositionValuation, Thesis } from "@/lib/types";
import type { PortfolioTotals } from "./analytics";
import type { AppSettings } from "./settings";

/**
 * "What changed since last check" — rules only, no model.
 *
 * A snapshot of a handful of scalars is written to disk each time the panel is
 * read, and the next read diffs against it. Rules-based is the right call
 * here: the interesting changes are threshold crossings, which are exactly
 * what code is good at and what a language model would restate less reliably
 * and less cheaply.
 */

/**
 * One snapshot file per account.
 *
 * The previous single global file was correct for a tool on one machine and a
 * leak on a shared one: "what changed since your last visit" would have been
 * computed against whoever loaded the page last. The scope key is the signed-in
 * user's id, so two accounts never read each other's baseline.
 */
const storeFor = (scope: string) =>
  writablePath(`.snapshot-${scope.replace(/[^a-zA-Z0-9_-]/g, "")}.json`);

export interface Snapshot {
  at: string;
  totalValue: number;
  dailyPct: number;
  usdTry: number;
  vix: number | null;
  /** code -> drift in weight points. */
  drift: Record<string, number>;
  /** code -> thesis status. */
  thesis: Record<string, string>;
  /** symbol -> last close / 50-day moving average. */
  vs50dma: Record<string, number>;
}

export interface Change {
  key: string;
  tone: "pos" | "neg" | "warn" | "info";
  text: string;
}

function loadSnapshot(scope: string): Snapshot | null {
  try {
    return JSON.parse(readFileSync(storeFor(scope), "utf8")) as Snapshot;
  } catch {
    return null;
  }
}

function saveSnapshot(scope: string, s: Snapshot): void {
  try {
    mkdirSync(dirname(storeFor(scope)), { recursive: true });
    writeFileSync(storeFor(scope), JSON.stringify(s), "utf8");
  } catch {
    // A read-only filesystem just means the next read has no baseline.
  }
}

function movingAverage(closes: number[], window: number): number | null {
  if (closes.length < window) return null;
  const slice = closes.slice(-window);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export interface ChangeInput {
  rows: PositionValuation[];
  totals: PortfolioTotals;
  quotes: Record<string, Quote>;
  histories: Record<string, { close: number }[]>;
  theses: Thesis[];
  usdTryRate: number;
  settings: AppSettings;
  /**
   * Whose baseline to diff against — the signed-in user's id, or "local" on an
   * instance with no accounts. Required rather than defaulted: a silent
   * default would be the shared-file bug again, just harder to see.
   */
  scope: string;
}

export interface ChangeReport {
  changes: Change[];
  since: string | null;
}

/**
 * Diff current state against the last snapshot, then persist the new one.
 *
 * Reading this panel is what advances the baseline — that is deliberate, so
 * "since last check" means since you last looked, not since some fixed clock.
 */
export function detectChanges(input: ChangeInput): ChangeReport {
  const { rows, totals, quotes, histories, theses, usdTryRate, settings } = input;

  const vs50dma: Record<string, number> = {};
  for (const [symbol, candles] of Object.entries(histories)) {
    const closes = candles.map((c) => c.close).filter(Number.isFinite);
    const ma = movingAverage(closes, 50);
    const last = closes.at(-1);
    if (ma && last) vs50dma[symbol] = last / ma;
  }

  const current: Snapshot = {
    at: new Date().toISOString(),
    totalValue: totals.value,
    dailyPct: totals.dailyPct,
    usdTry: usdTryRate,
    vix: quotes.VIX?.price ?? null,
    drift: Object.fromEntries(rows.map((r) => [r.position.code, r.drift])),
    thesis: Object.fromEntries(theses.map((t) => [t.code, t.status])),
    vs50dma,
  };

  const prev = loadSnapshot(input.scope);
  saveSnapshot(input.scope, current);

  if (!prev) return { changes: [], since: null };

  const changes: Change[] = [];
  const threshold = settings.driftThreshold;

  // Drift crossings — only report a position that changed side of the line.
  for (const r of rows) {
    const code = r.position.code;
    const before = prev.drift[code];
    if (before === undefined) continue;
    const wasOver = before > threshold;
    const isOver = r.drift > threshold;
    const wasUnder = before < -threshold;
    const isUnder = r.drift < -threshold;
    if (!wasOver && isOver) {
      changes.push({
        key: `drift-over-${code}`,
        tone: "warn",
        text: `${code} became overweight (+${(r.drift * 100).toFixed(1)}pp vs target)`,
      });
    } else if (!wasUnder && isUnder) {
      changes.push({
        key: `drift-under-${code}`,
        tone: "warn",
        text: `${code} became underweight (${(r.drift * 100).toFixed(1)}pp vs target)`,
      });
    } else if ((wasOver && !isOver) || (wasUnder && !isUnder)) {
      changes.push({
        key: `drift-ok-${code}`,
        tone: "pos",
        text: `${code} came back inside the drift band`,
      });
    }
  }

  // VIX threshold crossings, in both directions.
  if (prev.vix !== null && current.vix !== null) {
    for (const level of [20, 25, 30]) {
      if (prev.vix < level && current.vix >= level) {
        changes.push({
          key: `vix-up-${level}`,
          tone: "neg",
          text: `VIX crossed above ${level} (now ${current.vix.toFixed(1)})`,
        });
      } else if (prev.vix >= level && current.vix < level) {
        changes.push({
          key: `vix-down-${level}`,
          tone: "pos",
          text: `VIX fell back below ${level} (now ${current.vix.toFixed(1)})`,
        });
      }
    }
  }

  // FX move worth mentioning.
  if (prev.usdTry > 0 && usdTryRate > 0) {
    const pct = (usdTryRate / prev.usdTry - 1) * 100;
    if (Math.abs(pct) >= 1) {
      changes.push({
        key: "usdtry",
        tone: pct > 0 ? "neg" : "pos",
        text: `USD/TRY ${pct > 0 ? "increased" : "decreased"} ${Math.abs(pct).toFixed(1)}% to ${usdTryRate.toFixed(4)}`,
      });
    }
  }

  // Portfolio-level daily move.
  if (totals.dailyPct <= -0.01) {
    changes.push({
      key: "daily-loss",
      tone: "neg",
      text: `Portfolio daily loss exceeded 1% (${(totals.dailyPct * 100).toFixed(2)}%)`,
    });
  } else if (totals.dailyPct >= 0.01) {
    changes.push({
      key: "daily-gain",
      tone: "pos",
      text: `Portfolio gained more than 1% today (${(totals.dailyPct * 100).toFixed(2)}%)`,
    });
  }

  // 50-day moving-average crossings.
  for (const [symbol, ratio] of Object.entries(vs50dma)) {
    const before = prev.vs50dma[symbol];
    if (before === undefined) continue;
    if (before >= 1 && ratio < 1) {
      changes.push({
        key: `ma-down-${symbol}`,
        tone: "neg",
        text: `${symbol} moved below its 50-day moving average`,
      });
    } else if (before < 1 && ratio >= 1) {
      changes.push({
        key: `ma-up-${symbol}`,
        tone: "pos",
        text: `${symbol} moved back above its 50-day moving average`,
      });
    }
  }

  // Thesis transitions.
  for (const t of theses) {
    const before = prev.thesis[t.code];
    if (before && before !== t.status) {
      changes.push({
        key: `thesis-${t.code}`,
        tone: t.status === "RED" ? "neg" : t.status === "GREEN" ? "pos" : "warn",
        text: `${t.code} thesis indicator changed ${before} → ${t.status}`,
      });
    }
  }

  return { changes, since: prev.at };
}
