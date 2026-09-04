/**
 * BACKTEST WEIGHT CALIBRATION (sprint spec).
 *
 * Tests the current score weights {trend .22, structure .20, momentum .15,
 * volume .13, multiTimeframe .15, riskReward .15} against candidates, using
 * the no-lookahead backtest engine, with:
 *   - per-setup separation and minimum-sample gates,
 *   - WALK-FORWARD split: candidates are ranked on the IN-SAMPLE window and
 *     judged ONLY on the OUT-OF-SAMPLE window (entries after the cutoff),
 *   - Spearman rank correlation between entry score and forward return.
 * Rule: current weights are kept unless the winning candidate beats them
 * out-of-sample by a MATERIAL margin (>0.05 absolute rho) with ≥100 OOS
 * samples — insufficient evidence changes nothing.
 *
 * Run: npx tsx --conditions=react-server scripts/calibrate-weights.mts
 */
import { backtestSetups, type SetupOutcome } from "../src/lib/engines/backtest";

const P = "/Users/emreguvenen/n8n/pcc/src/lib";
const { getUniverseRows } = await import(P + "/data/opportunities");
const { getHistoricalPrices } = await import(P + "/providers");
await import(P + "/providers/register");

const CUTOFF = "2025-09-01"; // in-sample before, out-of-sample after
const CURRENT = { trend: 0.22, structure: 0.2, momentum: 0.15, volume: 0.13, multiTimeframe: 0.15, riskReward: 0.15 };
type W = typeof CURRENT;
const KEYS = Object.keys(CURRENT) as Array<keyof W>;

// Liquid, sector-mixed sample: top-by-mcap with a per-sector cap of 8.
const rows = getUniverseRows();
const bySector = new Map<string, number>();
const SAMPLE: string[] = [];
for (const r of rows) {
  const sec = r.sector ?? "?";
  if ((bySector.get(sec) ?? 0) >= 8) continue;
  bySector.set(sec, (bySector.get(sec) ?? 0) + 1);
  SAMPLE.push(r.symbol);
  if (SAMPLE.length >= 72) break;
}
console.log(`[calib] sample ${SAMPLE.length} symbols across ${bySector.size} sectors`);

const all: SetupOutcome[] = [];
let done = 0;
for (const sym of SAMPLE) {
  try {
    const h = await getHistoricalPrices(sym, 1300);
    if (h.candles.length >= 400) {
      all.push(...backtestSetups(sym, h.candles, { stride: 3, horizon: 40 }));
    }
  } catch {
    /* skip symbol */
  }
  done++;
  if (done % 12 === 0) console.log(`[calib] ${done}/${SAMPLE.length} symbols, ${all.length} outcomes`);
  await new Promise((r) => setTimeout(r, 250));
}

const scored = all.filter((o) => o.score);
const inS = scored.filter((o) => o.entryDate < CUTOFF);
const oos = scored.filter((o) => o.entryDate >= CUTOFF);
console.log(`[calib] outcomes: total ${all.length}, scored ${scored.length}, in-sample ${inS.length}, OOS ${oos.length}`);

function spearman(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 20) return null;
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const rk = new Array<number>(n);
    idx.forEach(([, i], r) => (rk[i] = r));
    return rk;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const mean = (n - 1) / 2;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i]! - mean) * (ry[i]! - mean);
    dx += (rx[i]! - mean) ** 2;
    dy += (ry[i]! - mean) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

/** Reweight the stored components; components are already 0-100 subscores. */
function scoreWith(o: SetupOutcome, w: W): number {
  const s = o.score!;
  const parts: Array<[number, number]> = [
    [s.trend, w.trend], [s.structure, w.structure], [s.momentum, w.momentum],
    [s.volume, w.volume], [s.multiTimeframe, w.multiTimeframe], [s.riskReward, w.riskReward],
  ];
  const wsum = parts.reduce((a, [, x]) => a + x, 0);
  return parts.reduce((a, [v, x]) => a + v * (x / wsum), 0);
}

function rho(outcomes: SetupOutcome[], w: W): number | null {
  // Per-setup correlation, sample-weighted — a weight set must not win by
  // exploiting a single setup's base rate.
  const groups = new Map<string, SetupOutcome[]>();
  for (const o of outcomes) {
    const g = groups.get(o.setup) ?? [];
    g.push(o);
    groups.set(o.setup, g);
  }
  let acc = 0, wsum = 0;
  for (const [, g] of groups) {
    if (g.length < 15) continue; // minimum-sample gate per setup
    const r = spearman(g.map((o) => scoreWith(o, w)), g.map((o) => o.returnPct));
    if (r === null) continue;
    acc += r * g.length;
    wsum += g.length;
  }
  return wsum ? acc / wsum : null;
}

// Candidates: current + axis perturbations + random simplex draws (seeded LCG
// — deterministic, no Math.random dependence on run time).
let seed = 42;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const candidates: Array<{ name: string; w: W }> = [{ name: "CURRENT", w: CURRENT }];
for (const k of KEYS) {
  for (const delta of [-0.08, +0.08]) {
    const w = { ...CURRENT };
    w[k] = Math.max(0.02, w[k] + delta);
    candidates.push({ name: `${k}${delta > 0 ? "+" : "-"}`, w });
  }
}
for (let i = 0; i < 150; i++) {
  const raw = KEYS.map(() => -Math.log(1 - rand()));
  const sum = raw.reduce((a, b) => a + b, 0);
  const w = Object.fromEntries(KEYS.map((k, j) => [k, raw[j]! / sum])) as W;
  candidates.push({ name: `rand${i}`, w });
}

const ranked = candidates
  .map((c) => ({ ...c, inRho: rho(inS, c.w) }))
  .filter((c) => c.inRho !== null)
  .sort((a, b) => (b.inRho ?? -9) - (a.inRho ?? -9));

const currentIn = ranked.find((c) => c.name === "CURRENT")?.inRho ?? null;
const best = ranked[0]!;
const currentOos = rho(oos, CURRENT);
const bestOos = rho(oos, best.w);

console.log("\n===== WEIGHT CALIBRATION REPORT =====");
console.log(`In-sample (entries < ${CUTOFF}): n=${inS.length}   OOS: n=${oos.length}`);
console.log(`CURRENT weights  ${JSON.stringify(CURRENT)}`);
console.log(`  in-sample rho ${currentIn?.toFixed(4) ?? "N/A"} · OOS rho ${currentOos?.toFixed(4) ?? "N/A"}`);
console.log(`BEST in-sample candidate: ${best.name} ${JSON.stringify(Object.fromEntries(Object.entries(best.w).map(([k, v]) => [k, Number(v.toFixed(3))])))}`);
console.log(`  in-sample rho ${best.inRho?.toFixed(4)} · OOS rho ${bestOos?.toFixed(4) ?? "N/A"}`);
console.log("\nTop-5 in-sample:");
for (const c of ranked.slice(0, 5)) console.log(`  ${c.name.padEnd(18)} in ${c.inRho!.toFixed(4)} oos ${rho(oos, c.w)?.toFixed(4) ?? "N/A"}`);

const material = currentOos !== null && bestOos !== null && oos.length >= 100 && bestOos - currentOos > 0.05;
console.log(
  `\nVERDICT: ${material
    ? "PROPOSED CHANGE — the best candidate beats CURRENT out-of-sample by a material margin (apply manually after review)."
    : "KEEP CURRENT WEIGHTS — no candidate shows a material, out-of-sample, multi-setup improvement. Insufficient evidence changes nothing."}`,
);
