"use client";

import usePoll from "@/lib/use-poll";
import { Chip } from "@/components/shell/ui";
import { cn } from "@/lib/utils";
import { currencySymbol } from "@/lib/format-currency";
import { compactMoney } from "./primitives";
import type { ScanRow } from "@/lib/scanner/engine";

const PILLAR_LABEL: Record<string, string> = {
  quality: "Quality",
  growth: "Growth",
  valuation: "Valuation",
  profitability: "Profitability",
  balanceSheet: "Balance Sheet",
  momentum: "Momentum",
  sentiment: "Sentiment",
  risk: "Risk",
};

const tone = (s: number | null) =>
  s === null ? "text-[var(--ink-3)]" : s >= 70 ? "text-emerald-400" : s <= 35 ? "text-rose-400" : "";

/**
 * Where this name sits against its peers.
 *
 * Fed by the same engine as the scanner, so the score here and the score on
 * the screener cannot disagree. Cached server-side; this polls slowly because
 * peer statistics move on the pace of quarterly filings, not ticks.
 */
export function PeerPanel({ symbol }: { symbol: string }) {
  const { data, loading } = usePoll<{ row: ScanRow | null }>(
    `/api/peer?symbol=${encodeURIComponent(symbol)}`,
    30 * 60_000,
  );

  if (loading) return <div className="p-3 text-[11px] text-[var(--ink-3)]">Building peer group…</div>;
  const row = data?.row;
  if (!row || row.result.score === null) {
    return (
      <div className="px-3 py-3 text-[10.5px] leading-snug text-[var(--ink-3)]">
        N/A — not enough fundamental coverage or too few peers to rank this name against its
        industry. Nothing is scored from partial data to fill the gap.
      </div>
    );
  }

  const sym = currencySymbol(row.currency);
  const r = row.result;

  return (
    <div>
      <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-4">
        <Cell label="Opportunity Score" value={String(r.score)} tone={tone(r.score)} />
        <Cell
          label={`${r.peer.basis === "industry" ? "Industry" : "Sector"} percentile`}
          value={r.industryPercentile !== null ? `${r.industryPercentile}th` : r.sectorPercentile !== null ? `${r.sectorPercentile}th` : "N/A"}
        />
        <Cell label="Peer sample" value={`${r.peer.label} · ${r.peer.n}`} />
        <Cell label="Coverage" value={`${r.coverage.have}/${r.coverage.total}`} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-1.5">
        <Chip tone={r.confidence === "HIGH" ? "pos" : r.confidence === "LOW" ? "warn" : "neutral"}>
          {r.confidence} CONFIDENCE
        </Chip>
        {row.fair.available && (
          <>
            <span className="text-[10px] text-[var(--ink-3)]">Model fair value</span>
            <span className="text-[11px] font-semibold tabular-nums">
              {compactMoney(row.fair.low, sym)}–{compactMoney(row.fair.high, sym)}
            </span>
            <span
              className={cn(
                "text-[10px] tabular-nums",
                (row.fair.upsideLow ?? 0) > 0 ? "text-emerald-400" : "text-rose-400",
              )}
            >
              {row.fair.upsideLow === null ? "" : `${row.fair.upsideLow > 0 ? "+" : ""}${row.fair.upsideLow.toFixed(0)}% to ${row.fair.upsideHigh!.toFixed(0)}%`}
            </span>
            <Chip tone={row.fair.confidence === "HIGH" ? "pos" : row.fair.confidence === "LOW" ? "warn" : "neutral"}>
              {row.fair.confidence}
            </Chip>
          </>
        )}
      </div>

      <table className="grid-table">
        <thead>
          <tr>
            <th className="tl">Pillar</th>
            <th>Percentile</th>
            <th className="tl">Contributing metrics</th>
          </tr>
        </thead>
        <tbody>
          {r.pillars.map((p) => (
            <tr key={p.pillar}>
              <td className="tl">{PILLAR_LABEL[p.pillar] ?? p.pillar}</td>
              <td className={cn("tabular-nums font-medium", tone(p.score))}>{p.score ?? "N/A"}</td>
              <td className="tl text-[9.5px] text-[var(--ink-3)]">
                {p.parts.length
                  ? p.parts.map((x) => `${x.metric} ${x.percentile.toFixed(0)}`).join(" · ")
                  : "no peer-comparable metric reported"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid grid-cols-1 divide-y divide-[var(--line)] border-t border-[var(--line)] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="px-3 py-2">
          <div className="mb-1 text-[9.5px] uppercase tracking-wide text-emerald-400">
            Why we like it
          </div>
          <ul className="list-disc space-y-0.5 pl-4">
            {row.explanation.likes.map((l, i) => (
              <li key={i} className="text-[10px] leading-snug">{l}</li>
            ))}
            {!row.explanation.likes.length && (
              <li className="list-none text-[10px] text-[var(--ink-3)]">Nothing stands out.</li>
            )}
          </ul>
        </div>
        <div className="px-3 py-2">
          <div className="mb-1 text-[9.5px] uppercase tracking-wide text-rose-400">Risks</div>
          <ul className="list-disc space-y-0.5 pl-4">
            {row.explanation.dislikes.map((l, i) => (
              <li key={i} className="text-[10px] leading-snug">{l}</li>
            ))}
            {!row.explanation.dislikes.length && (
              <li className="list-none text-[10px] text-[var(--ink-3)]">Nothing ranks badly.</li>
            )}
          </ul>
        </div>
      </div>

      <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] leading-snug text-[var(--ink-3)]">
        Percentiles are against {r.peer.n} {r.peer.basis} peers ({r.peer.label}). The fair-value
        range is a peer-multiple model, not a price target and not an analyst estimate.
      </div>
    </div>
  );
}

function Cell({ label, value, tone: t }: { label: string; value: string; tone?: string }) {
  return (
    <div className="px-3 py-2">
      <div className="text-[9.5px] text-[var(--ink-3)]">{label}</div>
      <div className={cn("text-[13px] font-semibold tabular-nums", t)}>{value}</div>
    </div>
  );
}
