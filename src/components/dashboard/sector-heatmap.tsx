import Link from "next/link";
import { getUniverseRows } from "@/lib/data/opportunities";

/**
 * SECTOR HEATMAP — the 6,900-company precomputed universe rolled up by
 * sector: median model upside (valid valuations only), average technical
 * score, and how many names pass each bar. A tile click opens the screener
 * pre-filtered to that sector. Zero provider calls — pure table math.
 */

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

export function SectorHeatmap() {
  const rows = getUniverseRows();
  if (rows.length === 0) return null;

  const bySector = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.sector) continue;
    const g = bySector.get(r.sector) ?? [];
    g.push(r);
    bySector.set(r.sector, g);
  }

  const tiles = [...bySector.entries()]
    .map(([sector, g]) => {
      const upside = median(g.map((r) => r.upsidePct).filter((v): v is number => v !== null));
      const tech = median(g.map((r) => r.technicalScore).filter((v): v is number => v !== null));
      const buys = g.filter((r) => ["STRONG_BUY", "BUY", "BREAKOUT_BUY", "BUY_ON_RETEST", "TACTICAL_BUY"].includes(r.technicalSignal ?? "")).length;
      return { sector, count: g.length, upside, tech, buys };
    })
    .filter((t) => t.count >= 30)
    .sort((a, b) => (b.upside ?? -99) - (a.upside ?? -99));

  if (!tiles.length) return null;

  const bg = (u: number | null): string => {
    if (u === null) return "rgba(148,163,184,0.08)";
    const x = Math.max(-30, Math.min(30, u)) / 30; // −30..+30% → −1..1
    return x >= 0 ? `rgba(16,185,129,${0.08 + x * 0.28})` : `rgba(244,63,94,${0.08 - x * 0.28})`;
  };

  return (
    <div className="rounded border border-[var(--line)]">
      <div className="flex items-baseline gap-2 border-b border-[var(--line)] px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider">Sector Heatmap</span>
        <span className="text-[9.5px] text-[var(--ink-3)]">
          median model upside per sector across {rows.length.toLocaleString()} precomputed companies — click a tile to screen it
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1 p-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <Link
            key={t.sector}
            href={`/screener?sector=${encodeURIComponent(t.sector)}`}
            className="rounded border border-[var(--line)] p-2 transition-transform hover:scale-[1.02]"
            style={{ background: bg(t.upside) }}
          >
            <div className="truncate text-[10.5px] font-semibold" title={t.sector}>{t.sector}</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className={`text-[15px] font-bold tabular-nums ${(t.upside ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                {t.upside === null ? "—" : `${t.upside >= 0 ? "+" : ""}${t.upside.toFixed(0)}%`}
              </span>
              <span className="text-[9px] text-[var(--ink-3)]">upside</span>
            </div>
            <div className="mt-0.5 text-[9px] tabular-nums text-[var(--ink-3)]">
              tech {t.tech ?? "—"} · {t.buys} buy signals · {t.count} names
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
