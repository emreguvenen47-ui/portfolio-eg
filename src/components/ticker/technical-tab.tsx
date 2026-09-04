import Link from "next/link";
import { Panel } from "@/components/shell/ui";
import { Workstation } from "@/components/chart/workstation";
import type { TechnicalDecision } from "@/lib/engines/technical-v3";
import type { Candle } from "@/lib/types";

/**
 * TECHNICAL TAB — trading-terminal theme: the V3 decision rendered as a
 * levels-annotated chart plus decision/risk/target/market-state grids.
 * Everything is deterministic engine output; nothing is recomputed here.
 */

const money = (v: number | null, d = 2) => (v === null ? "N/A" : `$${v.toFixed(d)}`);

/** Server-rendered SVG: closing prices with S/R, entry, stops and targets. */
function LevelsChart({ candles, t }: { candles: Candle[]; t: TechnicalDecision }) {
  const view = candles.slice(-220);
  if (view.length < 30) return <div className="p-3 text-[11px] text-[var(--ink-3)]">Not enough history to chart.</div>;

  const W = 980;
  const H = 340;
  const PAD_R = 74; // room for level labels
  const closes = view.map((c) => c.close);

  const levels: Array<{ price: number | null; label: string; color: string; dash?: string }> = [
    { price: t.daily.majorSupport, label: "MAJOR SUP", color: "#64748b", dash: "2 3" },
    { price: t.daily.primarySupport, label: "SUPPORT", color: "#34d399" },
    { price: t.daily.primaryResistance, label: "RESIST", color: "#f87171" },
    { price: t.daily.secondaryResistance, label: "RESIST 2", color: "#f87171", dash: "2 3" },
    { price: t.entry, label: "ENTRY", color: "#22d3ee" },
    { price: t.retestLevel, label: "RETEST", color: "#22d3ee", dash: "2 3" },
    ...t.stops.map((s) => ({
      price: s.price as number | null,
      label: `STOP ${s.kind[0]}`,
      color: "#fbbf24",
      dash: s.kind === "STANDARD" ? undefined : "3 3",
    })),
    { price: t.target1, label: "T1", color: "#4ade80" },
    { price: t.target2, label: "T2", color: "#4ade80", dash: "3 3" },
    { price: t.runnerTarget, label: "RUNNER", color: "#4ade80", dash: "1 3" },
  ];
  const lv = levels.filter((l): l is { price: number; label: string; color: string; dash?: string } => l.price !== null);

  const lo = Math.min(...closes, ...lv.map((l) => l.price)) * 0.985;
  const hi = Math.max(...closes, ...lv.map((l) => l.price)) * 1.015;
  const x = (i: number) => (i / (view.length - 1)) * (W - PAD_R);
  const y = (p: number) => H - 18 - ((p - lo) / (hi - lo)) * (H - 36);

  const path = closes.map((c, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(c).toFixed(1)}`).join(" ");
  const area = `${path} L${x(view.length - 1).toFixed(1)},${H - 18} L0,${H - 18} Z`;

  // De-collide labels: sort by y, push down when overlapping.
  const labeled = lv
    .map((l) => ({ ...l, ly: y(l.price) }))
    .sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < labeled.length; i++) {
    if (labeled[i].ly - labeled[i - 1].ly < 11) labeled[i].ly = labeled[i - 1].ly + 11;
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="price with technical levels">
      <defs>
        <linearGradient id="tt-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#tt-fill)" />
      <path d={path} fill="none" stroke="#22d3ee" strokeWidth="1.6" />
      {lv.map((l) => (
        <line
          key={l.label + l.price}
          x1={0}
          x2={W - PAD_R}
          y1={y(l.price)}
          y2={y(l.price)}
          stroke={l.color}
          strokeWidth="1"
          strokeDasharray={l.dash ?? "0"}
          opacity="0.8"
        />
      ))}
      {labeled.map((l) => (
        <text key={"t" + l.label + l.price} x={W - PAD_R + 4} y={l.ly + 3} fontSize="9" fill={l.color}>
          {l.label} {l.price.toFixed(l.price > 500 ? 0 : 2)}
        </text>
      ))}
      {/* last price marker */}
      <circle cx={x(view.length - 1)} cy={y(closes[closes.length - 1])} r="2.6" fill="#fff" />
    </svg>
  );
}

function Cell({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  return (
    <div className="px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">{label}</div>
      <div
        className={`mt-0.5 text-[12.5px] font-semibold tabular-nums ${
          tone === "pos" ? "text-emerald-400" : tone === "neg" ? "text-rose-400" : ""
        }`}
      >
        {value}
      </div>
      {sub ? <div className="text-[9.5px] text-[var(--ink-3)]">{sub}</div> : null}
    </div>
  );
}

export function TechnicalTab({ decision: t, candles }: { decision: TechnicalDecision; candles: Candle[] }) {
  const stops = t.stops;
  return (
    <div className="flex flex-col gap-3" style={{ ["--tab-accent" as string]: "#22d3ee" }}>
      {/* Interactive charting workstation (candles/zoom/pan/crosshair/indicators);
          FULL SCREEN opens the Command Chart with drawing tools + EG Analyze. */}
      <Panel
        title="Chart"
        subtitle="candlestick workstation — indicators, log scale, crosshair"
        actions={
          <Link
            href={`/chart/${encodeURIComponent(t.symbol)}`}
            className="rounded border border-cyan-500/70 bg-cyan-500/10 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-cyan-300"
          >
            ⛶ Full Screen
          </Link>
        }
        bodyClassName="p-0"
      >
        <Workstation symbol={t.symbol} compact />
      </Panel>

      {/* Decision strip */}
      <Panel title="Decision" subtitle={`as of ${t.asOf} · deterministic V3 engine · daily + weekly`} bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
          <Cell
            label="Signal"
            value={t.signal.replaceAll("_", " ")}
            tone={["STRONG_BUY", "BUY", "BREAKOUT_BUY", "BUY_ON_RETEST", "TACTICAL_BUY"].includes(t.signal) ? "pos" : ["SELL", "REDUCE", "INVALIDATED"].includes(t.signal) ? "neg" : undefined}
          />
          <Cell label="Setup" value={t.setup === "NONE" ? "—" : t.setup.replaceAll("_", " ")} sub={t.counterTrend ? "counter-trend — tactical only" : undefined} />
          <Cell label="Score" value={t.score ? `${t.score.total}/100` : "N/A"} />
          <Cell label="Confidence" value={t.confidence} />
          <Cell label="Freshness" value={t.freshness} sub={t.setupAgeBars !== null ? `${t.setupAgeBars} bars old` : undefined} />
          <Cell label="Weekly regime" value={t.weeklyTrend.replaceAll("_", " ")} sub={t.counterTrend ? "conflicts with daily" : "aligned with daily"} />
        </div>
      </Panel>

      {/* Chart with levels */}
      <Panel title="Technical Map" subtitle="support / resistance / entry / stops / targets — drawn on price" bodyClassName="p-0">
        <div className="bg-black/20 p-2">
          <LevelsChart candles={candles} t={t} />
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-t border-[var(--line)] sm:grid-cols-4 lg:grid-cols-8">
          <Cell label="Price" value={money(t.price)} />
          <Cell label="Entry zone" value={money(t.entry)} sub={t.retestLevel !== null ? `retest ${money(t.retestLevel)}` : undefined} />
          <Cell label="Support" value={money(t.daily.primarySupport)} sub={t.daily.majorSupport !== null ? `major ${money(t.daily.majorSupport)}` : undefined} />
          <Cell label="Resistance" value={money(t.daily.primaryResistance)} sub={t.daily.secondaryResistance !== null ? `next ${money(t.daily.secondaryResistance)}` : undefined} />
          <Cell label="Breakout level" value={money(t.daily.primaryResistance)} />
          <Cell label="Invalidation" value={money(t.daily.invalidation)} tone="neg" />
          <Cell label="Weekly support" value={money(t.weeklyPrimarySupport)} />
          <Cell label="Weekly resistance" value={money(t.weeklyPrimaryResistance)} />
        </div>
      </Panel>

      {/* Risk plan + targets */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Risk Plan" subtitle="structural stops — placed under structure, not percentages" bodyClassName="p-0">
          {stops.length ? (
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Stop</th>
                  <th>Price</th>
                  <th>Risk %</th>
                  <th>ATR dist</th>
                  <th className="tl">Why there</th>
                </tr>
              </thead>
              <tbody>
                {stops.map((s) => (
                  <tr key={s.kind}>
                    <td className="tl font-semibold">{s.kind}</td>
                    <td className="tabular-nums">{money(s.price)}</td>
                    <td className="tabular-nums text-rose-400">{s.riskPct}%</td>
                    <td className="tabular-nums">{s.atrDistance}</td>
                    <td className="tl text-[10px] text-[var(--ink-3)]">{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-3 text-[11px] text-[var(--ink-3)]">No actionable structure — no stop is published for a setup that does not exist.</div>
          )}
        </Panel>
        <Panel title="Targets" subtitle="structural objectives with the reward math" bodyClassName="p-0">
          <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3">
            <Cell label="T1" value={money(t.target1)} tone="pos" />
            <Cell label="T2" value={money(t.target2)} tone="pos" />
            <Cell label="Runner" value={money(t.runnerTarget)} sub="measured move" />
            <Cell label="Reward" value={t.rewardPct !== null ? `+${t.rewardPct}%` : "N/A"} tone="pos" />
            <Cell label="Risk" value={t.riskPct !== null ? `−${t.riskPct}%` : "N/A"} tone="neg" />
            <Cell label="R : R" value={t.riskReward !== null ? `${t.riskReward}` : "N/A"} />
          </div>
        </Panel>
      </div>

      {/* Market state */}
      <Panel title="Market State" bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
          <Cell label="Momentum" value={t.momentum.replaceAll("_", " ")} />
          <Cell label="Volume" value={t.volumeState} />
          <Cell label="Realized vol" value={t.realizedVolAnnualPct !== null ? `${t.realizedVolAnnualPct.toFixed(0)}% ann.` : "N/A"} />
          <Cell label="ATR (14)" value={t.daily.atr14 !== null ? t.daily.atr14.toFixed(2) : "N/A"} />
          <Cell label="Daily trend" value={t.daily.trend.replaceAll("_", " ")} />
          <Cell label="Weekly trend" value={t.weeklyTrend.replaceAll("_", " ")} />
        </div>
        {t.score && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--line)] px-3 py-1.5 text-[10px] text-[var(--ink-3)]">
            <span className="font-medium text-[var(--ink-1,inherit)]">Score composition</span>
            <span>Trend {t.score.trend} (w .22)</span>
            <span>Structure {t.score.structure} (w .20)</span>
            <span>Momentum {t.score.momentum} (w .15)</span>
            <span>Volume {t.score.volume} (w .13)</span>
            <span>Multi-TF {t.score.multiTimeframe} (w .15)</span>
            <span>R:R {t.score.riskReward} (w .15)</span>
          </div>
        )}
      </Panel>

      {/* Explanation */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Why this signal?" bodyClassName="p-3">
          {t.reasons.length ? (
            <ul className="list-disc pl-4 text-[11.5px] leading-snug">
              {t.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : (
            <div className="text-[11px] text-[var(--ink-3)]">No qualifying conditions — the engine is honestly on WAIT.</div>
          )}
        </Panel>
        <Panel title="What invalidates it?" bodyClassName="p-3">
          {t.invalidators.length ? (
            <ul className="list-disc pl-4 text-[11.5px] leading-snug">
              {t.invalidators.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : (
            <div className="text-[11px] text-[var(--ink-3)]">N/A</div>
          )}
        </Panel>
      </div>
    </div>
  );
}
