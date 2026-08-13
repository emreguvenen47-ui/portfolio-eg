import Link from "next/link";
import { getContext } from "@/lib/server/context";
import { SampleBanner } from "@/components/shell/sample-banner";
import { Chip, Kpi, Note, Panel } from "@/components/shell/ui";
import { buildTheses, THESIS_STATUS_COLOR } from "@/lib/portfolio/theses";
import { fmtPct, fmtPctPoints, signClass } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ThesesPage() {
  const ctx = await getContext();
  if (ctx.error) return <Panel title="Error"><Note tone="warn">{ctx.error}</Note></Panel>;

  const theses = buildTheses(ctx.portfolio);
  const byCode = new Map(ctx.rows.map((r) => [r.position.code, r]));
  const counts = {
    GREEN: theses.filter((t) => t.status === "GREEN").length,
    YELLOW: theses.filter((t) => t.status === "YELLOW").length,
    RED: theses.filter((t) => t.status === "RED").length,
  };
  const avgConfidence =
    theses.reduce((s, t) => s + t.confidence, 0) / (theses.length || 1);

  // Confidence weighted by capital tells you whether conviction is where the money is.
  const weighted = theses.reduce((s, t) => {
    const w = byCode.get(t.code)?.currentWeight ?? 0;
    return s + w * t.confidence;
  }, 0);

  return (
    <div className="flex flex-col gap-3">
      <SampleBanner portfolio={ctx.portfolio} />
      <Panel bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-5">
          <Kpi label="Theses Tracked" value={String(theses.length)} />
          <Kpi label="Green" value={String(counts.GREEN)} tone="pos" />
          <Kpi label="Yellow" value={String(counts.YELLOW)} tone="amber" />
          <Kpi label="Red" value={String(counts.RED)} tone="neg" />
          <Kpi
            label="Confidence"
            value={avgConfidence.toFixed(0)}
            sub={`${weighted.toFixed(0)} weighted by capital`}
          />
        </div>
      </Panel>

      <Note>
        Thesis text and risks are read directly from the workbook&apos;s rationale columns.
        Status, confidence, invalidation conditions and key indicators are analyst overlays —
        edit them as your view changes.
      </Note>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {theses.map((t) => {
          const row = byCode.get(t.code);
          return (
            <Panel
              key={t.code}
              title={t.code}
              subtitle={row?.position.name}
              actions={
                <div className="flex items-center gap-1.5">
                  {row && (
                    <span className="tnum text-[10px] text-[var(--ink-3)]">
                      {fmtPct(row.currentWeight, 1)}
                    </span>
                  )}
                  <span className={`chip ${THESIS_STATUS_COLOR[t.status]}`}>{t.status}</span>
                </div>
              }
            >
              <p className="text-[11px] leading-relaxed text-[var(--ink-2)]">{t.thesis}</p>

              <div className="mt-2.5">
                <div className="mb-1 flex items-center justify-between">
                  <span className="kpi-label">Confidence</span>
                  <span className="tnum text-[10px] text-[var(--ink-2)]">{t.confidence}/100</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-sm bg-[var(--panel-2)]">
                  <div
                    className={
                      t.confidence >= 70
                        ? "h-full bg-[var(--up)]"
                        : t.confidence >= 50
                          ? "h-full bg-[var(--warn)]"
                          : "h-full bg-[var(--down)]"
                    }
                    style={{ width: `${t.confidence}%` }}
                  />
                </div>
              </div>

              {row && (
                <div className="mt-2.5 grid grid-cols-3 gap-2 border-y border-[var(--line)] py-2 text-[10px]">
                  <div>
                    <div className="kpi-label">YTD</div>
                    <div className={`tnum ${signClass(row.ytdPct)}`}>
                      {row.ytdPct === null ? "—" : fmtPctPoints(row.ytdPct * 100)}
                    </div>
                  </div>
                  <div>
                    <div className="kpi-label">P&amp;L</div>
                    <div className={`tnum ${signClass(row.unrealizedPnlPct)}`}>
                      {fmtPctPoints(row.unrealizedPnlPct * 100)}
                    </div>
                  </div>
                  <div>
                    <div className="kpi-label">Drift</div>
                    <div className={`tnum ${signClass(row.drift)}`}>
                      {(row.drift * 100).toFixed(2)}pp
                    </div>
                  </div>
                </div>
              )}

              {t.drivers.length > 0 && (
                <div className="mt-2">
                  <div className="kpi-label mb-1">Drivers</div>
                  <ul className="space-y-0.5">
                    {t.drivers.map((d, i) => (
                      <li key={i} className="flex gap-1.5 text-[10.5px] leading-snug text-[var(--ink-2)]">
                        <span className="text-[var(--up)]">▸</span>
                        <span>{d}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {t.risks.length > 0 && (
                <div className="mt-2">
                  <div className="kpi-label mb-1">Risks</div>
                  <ul className="space-y-0.5">
                    {t.risks.map((d, i) => (
                      <li key={i} className="flex gap-1.5 text-[10.5px] leading-snug text-[var(--ink-2)]">
                        <span className="text-[var(--down)]">▸</span>
                        <span>{d}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-2 border-t border-[var(--line)] pt-2">
                <div className="kpi-label mb-1">Invalidation Condition</div>
                <p className="text-[10.5px] leading-snug text-[var(--ink-3)]">{t.invalidation}</p>
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                {t.keyIndicators.map((k) => (
                  <Chip key={k}>{k}</Chip>
                ))}
              </div>

              <div className="mt-2 flex items-center justify-between border-t border-[var(--line)] pt-1.5 text-[9.5px] text-[var(--ink-3)]">
                <span>Last review {t.lastReview}</span>
                <Link href={`/positions/${t.code}`} className="text-[var(--amber)] hover:underline">
                  Asset detail →
                </Link>
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
