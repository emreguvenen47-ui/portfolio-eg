"use client";

import { useEffect, useState } from "react";
import type { SetupStats } from "@/lib/engines/backtest";

/**
 * QUANT LAB — the deterministic backtest engine, user-driven.
 *
 * Runs the SAME V3 setup detector the live signals use over years of history,
 * with structural look-ahead prevention, next-bar-open fills, stop-first
 * same-bar resolution and non-overlapping positions. QuantConnect-style
 * research UX (adapted as a concept from MIT quantconnect-mcp); the engine is
 * local, deterministic and needs no external account.
 */

interface Trade {
  symbol: string;
  setup: string;
  entryDate: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  exit: "TARGET" | "STOP" | "TIMEOUT";
  exitDate: string;
  barsHeld: number;
  returnPct: number;
  mfePct: number;
  maePct: number;
}

interface Result {
  symbols: string[];
  perSymbol: Array<{ symbol: string; outcomes: number; bars: number }>;
  totalOutcomes: number;
  stats: SetupStats[];
  equity: Array<{ date: string; cum: number }>;
  trades: Trade[];
  error?: string;
}

function EquityCurve({ points }: { points: Array<{ date: string; cum: number }> }) {
  if (points.length < 5) return null;
  const W = 960;
  const H = 180;
  const vals = points.map((p) => p.cum);
  const lo = Math.min(...vals, 0);
  const hi = Math.max(...vals, 0);
  const span = hi - lo || 1;
  const y = (v: number) => H - 14 - ((v - lo) / span) * (H - 28);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${((i / (points.length - 1)) * W).toFixed(1)},${y(p.cum).toFixed(1)}`).join(" ");
  const final = vals[vals.length - 1]!;
  return (
    <div className="rounded border border-[var(--line)] p-2">
      <div className="flex items-baseline gap-2 px-1 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-2)]">Cumulative per-trade return (equal-weight, non-compounded)</span>
        <span className={`text-[12px] font-bold tabular-nums ${final >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {final >= 0 ? "+" : ""}{final.toFixed(1)}% over {points.length} trades
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="rgba(148,163,184,0.35)" strokeDasharray="3 4" />
        <path d={d} fill="none" stroke={final >= 0 ? "#34d399" : "#f87171"} strokeWidth={1.6} />
        <text x={4} y={12} fontSize={9} fill="rgba(148,163,184,0.8)">{points[0]!.date}</text>
        <text x={W - 70} y={12} fontSize={9} fill="rgba(148,163,184,0.8)">{points[points.length - 1]!.date}</text>
      </svg>
    </div>
  );
}

export function QuantLab({ initial }: { initial: string }) {
  const [input, setInput] = useState(initial);
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (csv: string) => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/quant/backtest?symbols=${encodeURIComponent(csv)}`);
      const j = (await r.json()) as Result;
      if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
      setRes(j);
      window.history.replaceState(null, "", `/quant?symbols=${csv.replaceAll(" ", "")}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void run(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct = (v: number | null, d = 0) => (v === null ? "—" : `${(v * 100).toFixed(d)}%`);

  return (
    <div className="flex flex-col gap-3" style={{ ["--tab-accent" as string]: "#4ade80" }}>
      <div className="flex flex-wrap items-center gap-2 rounded border border-[var(--line)] px-3 py-2">
        <h1 className="text-[14px] font-semibold tracking-tight">Quant Lab</h1>
        <span className="text-[10px] text-[var(--ink-3)]">
          backtest the LIVE signal engine over history — no look-ahead, next-bar fills, stop-first same-bar, non-overlapping
        </span>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void run(input)}
            placeholder="AAPL, NVDA, MU (max 5)"
            className="w-64 rounded border border-[var(--line)] bg-transparent px-2 py-1 text-[11px] outline-none focus:border-emerald-500/60"
          />
          <button
            type="button"
            onClick={() => void run(input)}
            disabled={loading}
            className="rounded border border-emerald-500/60 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300 disabled:opacity-50"
          >
            {loading ? "Running…" : "Run Backtest"}
          </button>
        </div>
      </div>

      {err && <div className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[10.5px] text-rose-300">{err}</div>}
      {loading && !res && (
        <div className="rounded border border-[var(--line)] p-4 text-[11px] text-[var(--ink-3)]">
          Walking ~5 years of daily bars through the detector (each evaluation sees only its own past)…
        </div>
      )}

      {res && (
        <>
          <div className="flex flex-wrap gap-2 text-[10px] text-[var(--ink-3)]">
            {res.perSymbol.map((p) => (
              <span key={p.symbol} className="rounded border border-[var(--line)] px-2 py-0.5 tabular-nums">
                {p.symbol}: {p.outcomes} trades / {p.bars} bars
              </span>
            ))}
            <span className="rounded border border-emerald-500/40 px-2 py-0.5 tabular-nums text-emerald-400">total {res.totalOutcomes} outcomes</span>
          </div>

          <EquityCurve points={res.equity} />

          {/* Per-setup stats */}
          <div className="overflow-x-auto rounded border border-[var(--line)]">
            <table className="grid-table w-full">
              <thead>
                <tr>
                  <th className="tl">Setup</th>
                  <th>Samples</th>
                  <th>Target hit</th>
                  <th>Stopped</th>
                  <th>Timeout</th>
                  <th>Median return</th>
                  <th>Avg MFE</th>
                  <th>Avg MAE</th>
                  <th>Median bars</th>
                  <th className="tl">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {res.stats.map((s) => (
                  <tr key={s.setup}>
                    <td className="tl font-semibold">{s.setup.replaceAll("_", " ")}</td>
                    <td className="tabular-nums">{s.samples}</td>
                    <td className="tabular-nums text-emerald-400">{pct(s.target1HitRate)}</td>
                    <td className="tabular-nums text-rose-400">{pct(s.stopHitRate)}</td>
                    <td className="tabular-nums text-[var(--ink-3)]">{pct(s.timeoutRate)}</td>
                    <td className={`tabular-nums ${(s.medianReturnPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {s.medianReturnPct === null ? "—" : `${s.medianReturnPct >= 0 ? "+" : ""}${s.medianReturnPct.toFixed(2)}%`}
                    </td>
                    <td className="tabular-nums">{s.meanMfePct === null ? "—" : `+${s.meanMfePct.toFixed(1)}%`}</td>
                    <td className="tabular-nums">{s.meanMaePct === null ? "—" : `${s.meanMaePct.toFixed(1)}%`}</td>
                    <td className="tabular-nums">{s.medianBarsHeld ?? "—"}</td>
                    <td className="tl">
                      <span className={s.verdict === "USABLE" ? "text-emerald-400" : "text-amber-400"}>{s.verdict}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Recent trades */}
          <div className="overflow-x-auto rounded border border-[var(--line)]">
            <table className="grid-table w-full">
              <thead>
                <tr>
                  <th className="tl">Symbol</th>
                  <th className="tl">Setup</th>
                  <th className="tl">Entry</th>
                  <th>@</th>
                  <th>Stop</th>
                  <th>Target</th>
                  <th className="tl">Exit</th>
                  <th>Bars</th>
                  <th>Return</th>
                  <th>MFE</th>
                  <th>MAE</th>
                </tr>
              </thead>
              <tbody>
                {res.trades.map((t, i) => (
                  <tr key={`${t.symbol}-${t.entryDate}-${i}`}>
                    <td className="tl font-semibold">{t.symbol}</td>
                    <td className="tl text-[10px]">{t.setup.replaceAll("_", " ").toLowerCase()}</td>
                    <td className="tl tabular-nums">{t.entryDate}</td>
                    <td className="tabular-nums">{t.entryPrice.toFixed(2)}</td>
                    <td className="tabular-nums text-amber-400">{t.stopPrice.toFixed(2)}</td>
                    <td className="tabular-nums text-emerald-400">{t.targetPrice.toFixed(2)}</td>
                    <td className="tl">
                      <span className={t.exit === "TARGET" ? "text-emerald-400" : t.exit === "STOP" ? "text-rose-400" : "text-[var(--ink-3)]"}>
                        {t.exit}
                      </span>
                      <span className="ml-1 text-[9px] text-[var(--ink-3)]">{t.exitDate}</span>
                    </td>
                    <td className="tabular-nums">{t.barsHeld}</td>
                    <td className={`tabular-nums font-medium ${t.returnPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {t.returnPct >= 0 ? "+" : ""}{t.returnPct}%
                    </td>
                    <td className="tabular-nums text-[var(--ink-3)]">+{t.mfePct}%</td>
                    <td className="tabular-nums text-[var(--ink-3)]">{t.maePct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[9.5px] leading-snug text-[var(--ink-3)]">
            Method: the detector runs on candles.slice(0, i+1) only (look-ahead structurally impossible; verified
            by the garbage-future regression test). Entries fill at the NEXT bar's open. When one bar spans both
            stop and target, the STOP counts first — never flattering. Positions don't overlap. INSUFFICIENT_DATA
            means the setup produced fewer than the minimum samples; no verdict is invented from thin evidence.
            Costs/slippage are not modeled. QuantConnect-style research flow adapted as a concept (MIT
            quantconnect-mcp); the engine here is local and deterministic — no external account involved.
          </p>
        </>
      )}
    </div>
  );
}
