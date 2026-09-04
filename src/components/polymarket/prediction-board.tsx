import Link from "next/link";
import {
  getProbabilityHistory,
  type PolymarketMarket,
  type ProbabilityPoint,
} from "@/lib/providers/polymarket";

/**
 * PREDICTION BOARD — Polymarket-feel market cards: probability dominant,
 * YES/NO contract bars, odds movement, expiry, and a probability trend
 * sparkline for the highest-volume markets. Read-only; only data the public
 * API actually returned is shown — no invented odds, no placeholder numbers.
 */

const fmtVol = (v: number | null): string =>
  v === null ? "—" : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v.toFixed(0)}`;

const fmtDate = (iso: string | null): string => (iso ? iso.slice(0, 10) : "no expiry");

function daysTo(iso: string | null): string | null {
  if (!iso) return null;
  const d = Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
  if (!Number.isFinite(d)) return null;
  return d <= 0 ? "closing" : `${d}d left`;
}

function Spark({ points }: { points: ProbabilityPoint[] }) {
  if (points.length < 3) return null;
  const W = 220;
  const H = 42;
  const ps = points.slice(-120);
  const min = Math.min(...ps.map((p) => p.p));
  const max = Math.max(...ps.map((p) => p.p));
  const pad = Math.max(0.02, (max - min) * 0.1);
  const lo = Math.max(0, min - pad);
  const hi = Math.min(1, max + pad);
  const x = (i: number) => (i / (ps.length - 1)) * W;
  const y = (p: number) => H - ((p - lo) / (hi - lo)) * H;
  const d = ps.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.p).toFixed(1)}`).join(" ");
  const rising = ps[ps.length - 1]!.p >= ps[0]!.p;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-9 w-full" aria-hidden>
      <path d={d} fill="none" stroke={rising ? "#34d399" : "#f87171"} strokeWidth="1.4" />
    </svg>
  );
}

function Movement({ label, v }: { label: string; v: number | null }) {
  if (v === null) return null;
  const pts = v * 100;
  return (
    <span className={`tabular-nums ${pts >= 0.5 ? "text-emerald-400" : pts <= -0.5 ? "text-rose-400" : "text-[var(--ink-3)]"}`}>
      {label} {pts >= 0 ? "+" : ""}
      {pts.toFixed(1)}pp
    </span>
  );
}

function MarketCard({
  m,
  category,
  spark,
}: {
  m: PolymarketMarket;
  category: string;
  spark: ProbabilityPoint[] | null;
}) {
  const top = [...m.outcomes].sort((a, b) => b.probability - a.probability);
  const primary = top[0] ?? null;
  const binary =
    m.outcomes.length === 2 &&
    m.outcomes.some((o) => /^yes$/i.test(o.label)) &&
    m.outcomes.some((o) => /^no$/i.test(o.label));
  const yes = binary ? m.outcomes.find((o) => /^yes$/i.test(o.label))! : null;

  return (
    <div className="flex flex-col rounded border border-[var(--line)] p-3 transition-colors hover:border-indigo-400/50">
      <div className="flex items-start gap-2">
        <a
          href={m.url}
          target="_blank"
          rel="noreferrer"
          className="text-[12px] font-medium leading-snug hover:text-indigo-300 hover:underline"
        >
          {m.question}
        </a>
        <span className="ml-auto shrink-0 rounded border border-indigo-400/40 px-1.5 py-0.5 text-[8.5px] uppercase tracking-wider text-indigo-300">
          {category}
        </span>
      </div>

      {/* Probability, dominant */}
      {binary && yes ? (
        <div className="mt-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[26px] font-bold tabular-nums leading-none text-indigo-300">
              {(yes.probability * 100).toFixed(0)}%
            </span>
            <span className="text-[10px] uppercase tracking-wider text-[var(--ink-3)]">chance</span>
          </div>
          <div className="mt-1.5 flex h-2 overflow-hidden rounded bg-rose-500/25">
            <div className="h-full bg-emerald-500/70" style={{ width: `${yes.probability * 100}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[9.5px] tabular-nums">
            <span className="text-emerald-400">YES {(yes.probability * 100).toFixed(1)}¢</span>
            <span className="text-rose-400">NO {((1 - yes.probability) * 100).toFixed(1)}¢</span>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-1">
          {top.slice(0, 4).map((o) => (
            <div key={o.label} className="flex items-center gap-2">
              <span className="w-32 truncate text-[10px] text-[var(--ink-2)]" title={o.label}>
                {o.label}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-[var(--line)]">
                <div className="h-full bg-indigo-400/70" style={{ width: `${o.probability * 100}%` }} />
              </div>
              <span className="w-10 text-right text-[10.5px] font-semibold tabular-nums text-indigo-300">
                {(o.probability * 100).toFixed(0)}%
              </span>
            </div>
          ))}
          {top.length > 4 && (
            <div className="text-[9px] text-[var(--ink-3)]">+{top.length - 4} more outcomes</div>
          )}
        </div>
      )}

      {/* Odds movement + trend */}
      {spark && spark.length >= 3 && <Spark points={spark} />}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 pt-2 text-[9px] text-[var(--ink-3)]">
        <Movement label="24h" v={primary?.change24h ?? null} />
        <Movement label="7d" v={primary?.change7d ?? null} />
        <span>vol {fmtVol(m.volume)}</span>
        {m.liquidity !== null && <span>liq {fmtVol(m.liquidity)}</span>}
        <span className="ml-auto" title={fmtDate(m.endDate)}>
          {daysTo(m.endDate) ?? fmtDate(m.endDate)}
        </span>
      </div>
    </div>
  );
}

export async function PredictionBoard({
  markets,
  categories,
  active,
  activeLabel,
}: {
  markets: PolymarketMarket[];
  categories: Array<{ id: string; label: string }>;
  active: string;
  activeLabel: string;
}) {
  // Probability history for the top markets only — cached an hour upstream,
  // and never a blocking requirement: a missing track renders no sparkline.
  const sparkTargets = markets.slice(0, 6);
  const sparks = await Promise.all(
    sparkTargets.map((m) => {
      const token = m.outcomes[0]?.clobTokenId ?? null;
      return token ? getProbabilityHistory(token).catch(() => []) : Promise.resolve([]);
    }),
  );
  const sparkBy = new Map(sparkTargets.map((m, i) => [m.id, sparks[i] ?? []]));

  return (
    <div className="flex flex-col gap-3">
      {/* Category rail */}
      <div className="flex flex-wrap gap-1.5">
        {categories.map((c) => {
          const on = c.id === active;
          return (
            <Link
              key={c.id}
              href={`/polymarket?c=${c.id}`}
              className={`rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider transition-colors ${
                on
                  ? "border-indigo-400/70 bg-indigo-500/15 text-indigo-300"
                  : "border-[var(--line)] text-[var(--ink-3)] hover:text-[var(--ink-1,inherit)]"
              }`}
            >
              {c.label}
            </Link>
          );
        })}
      </div>

      {markets.length === 0 ? (
        <div className="rounded border border-[var(--line)] p-4 text-[11px] text-[var(--ink-3)]">
          No open market matched the {activeLabel} filter right now — honest zero from the public
          discovery API, nothing synthesized.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {markets.map((m) => (
            <MarketCard key={m.id} m={m} category={activeLabel} spark={sparkBy.get(m.id) ?? null} />
          ))}
        </div>
      )}
    </div>
  );
}
