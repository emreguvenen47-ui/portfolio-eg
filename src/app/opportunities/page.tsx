import "@/lib/providers/register";
import Link from "next/link";
import { Chip, Note, Panel } from "@/components/shell/ui";
import {
  OPPORTUNITY_VIEWS,
  getOpportunities,
  getUniverseMeta,
  type OpportunitySnapshot,
} from "@/lib/data/opportunities";

export const dynamic = "force-dynamic";
export const metadata = { title: "Opportunities" };

/**
 * OPPORTUNITIES — discovery desk over the PRECOMPUTED canonical universe.
 *
 * The full supported US universe (~7k names) is computed by the background
 * sweep and stored in one table. Opening this page and switching views are
 * pure in-memory reads: NO provider call, NO recompute, NO incremental
 * "loading more companies". If the current refresh is unfinished, the last
 * successful snapshot is what renders — honestly time-stamped in the header.
 */

const mcap = (v: number | null): string => {
  if (v === null) return "—";
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  return `${(v / 1e6).toFixed(0)}M`;
};
const num = (v: number | null, d = 1) => (v === null ? "—" : v.toFixed(d));
const pctf = (v: number | null, d = 0) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const frac = (v: number | null, d = 0) => (v === null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);

function signalTone(sig: string | null): "pos" | "neg" | "neutral" {
  if (!sig) return "neutral";
  if (["STRONG_BUY", "BUY", "BREAKOUT_BUY", "BUY_ON_RETEST", "TACTICAL_BUY"].includes(sig)) return "pos";
  if (["SELL", "REDUCE", "INVALIDATED"].includes(sig)) return "neg";
  return "neutral";
}

/** Why-it's-here line: the score parts the engines actually recorded. */
function whyLine(o: OpportunitySnapshot, viewKey: string): string {
  if (o.scoreParts.length) return o.scoreParts.join(" + ");
  // Views whose criterion is not part of the blended score explain themselves.
  switch (viewKey) {
    case "near-support":
      return `${num(o.distanceToSupportPct)}% above support ${num(o.primarySupport, 2)}`;
    case "breakout":
      return `${(o.setupType ?? "").replaceAll("_", " ").toLowerCase()} · resistance ${num(o.primaryResistance, 2)}`;
    case "contrarian":
      return `${pctf(o.upsidePct)} model upside against a weak tape`;
    default:
      return "meets the view's published filter";
  }
}

export default async function OpportunitiesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await props.searchParams;
  const viewKey =
    (typeof sp.view === "string" && OPPORTUNITY_VIEWS.find((v) => v.key === sp.view)?.key) || "best";
  const view = OPPORTUNITY_VIEWS.find((v) => v.key === viewKey)!;
  const meta = getUniverseMeta();
  const { rows } = getOpportunities(viewKey, 50);
  const cards = rows.slice(0, 9);
  const table = rows.slice(9);

  return (
    <div className="flex flex-col gap-3" style={{ ["--tab-accent" as string]: "#f59e0b" }}>
      {/* Universe header — coverage is stated, never implied */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-[var(--line)] px-3 py-2">
        <h1 className="text-[14px] font-semibold tracking-tight">Opportunities</h1>
        <span className="text-[10.5px] text-[var(--ink-3)]">
          ranked discovery over the precomputed universe — no loading, no partial coverage
        </span>
        <div className="ml-auto flex items-center gap-2 text-[10.5px] tabular-nums text-[var(--ink-2)]">
          <Chip tone="pos">UNIVERSE {meta.rows.toLocaleString()}</Chip>
          <span className="text-[var(--ink-3)]">
            last refreshed {meta.newest ? meta.newest.slice(0, 16).replace("T", " ") : "N/A"}
          </span>
        </div>
      </div>

      {meta.rows === 0 && (
        <Note tone="warn">
          <span>
            <strong>UNIVERSE NOT BUILT YET.</strong> Run the background sweep
            (<code>scripts/sweep-universe.mts</code>) once; this page then opens instantly from the
            stored table.
          </span>
        </Note>
      )}

      {/* View selector — each is a published filter, not a vibe */}
      <div className="flex flex-wrap gap-1.5">
        {OPPORTUNITY_VIEWS.map((v) => {
          const on = v.key === viewKey;
          return (
            <Link
              key={v.key}
              href={`/opportunities?view=${v.key}`}
              className={`rounded border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider transition-colors ${
                on
                  ? "border-amber-500/60 bg-amber-500/10 text-amber-400"
                  : "border-[var(--line)] text-[var(--ink-3)] hover:text-[var(--ink-1,inherit)]"
              }`}
            >
              {v.label}
            </Link>
          );
        })}
      </div>

      {/* Top of the list as ranked cards with WHY IT'S HERE */}
      {cards.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((o, i) => (
            <Link
              key={o.symbol}
              href={`/ticker/${o.symbol}`}
              className="group rounded border border-[var(--line)] p-2.5 transition-colors hover:border-amber-500/50"
            >
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] tabular-nums text-[var(--ink-3)]">#{i + 1}</span>
                <span className="text-[13px] font-semibold group-hover:text-amber-400">{o.symbol}</span>
                <span className="truncate text-[10px] text-[var(--ink-3)]">{o.name ?? ""}</span>
                <span className="ml-auto text-[11px] font-semibold tabular-nums">
                  {o.egSetupScore !== null ? `${o.egSetupScore}` : "—"}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9.5px] text-[var(--ink-3)]">
                <span>{o.sector ?? "—"}</span>
                <span>· {mcap(o.marketCap)}</span>
                <Chip tone={signalTone(o.technicalSignal)}>
                  {(o.technicalSignal ?? "N/A").replaceAll("_", " ")}
                </Chip>
                {o.upsidePct !== null && (
                  <span className={o.upsidePct >= 0 ? "text-emerald-400" : "text-rose-400"}>
                    {pctf(o.upsidePct)} upside
                  </span>
                )}
                {o.riskReward !== null && <span>R:R {o.riskReward}</span>}
              </div>
              <div className="mt-1.5 border-t border-[var(--line)] pt-1.5 text-[10px] leading-snug text-[var(--ink-2)]">
                <span className="text-[9px] uppercase tracking-wider text-amber-500/80">Why it&apos;s here · </span>
                {whyLine(o, viewKey)}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Rest of the list as a dense table */}
      <Panel
        title={view.label}
        subtitle={`rows ${rows.length} · filters run in memory over ${meta.rows.toLocaleString()} precomputed companies`}
        bodyClassName="p-0"
      >
        {rows.length === 0 ? (
          <div className="p-4 text-[11px] text-[var(--ink-3)]">
            No company currently passes this view&apos;s filter — an honest zero over the full universe.
          </div>
        ) : table.length === 0 ? (
          <div className="p-3 text-[10.5px] text-[var(--ink-3)]">All qualifying names are shown above.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">#</th>
                  <th className="tl">Symbol</th>
                  <th className="tl">Sector</th>
                  <th>Mcap</th>
                  <th>Score</th>
                  <th>Upside</th>
                  <th>Rev g</th>
                  <th>P/E</th>
                  <th>Signal</th>
                  <th>R:R</th>
                  <th className="tl">Why it&apos;s here</th>
                </tr>
              </thead>
              <tbody>
                {table.map((o, i) => (
                  <tr key={o.symbol}>
                    <td className="tl tabular-nums text-[var(--ink-3)]">{i + 10}</td>
                    <td className="tl">
                      <Link href={`/ticker/${o.symbol}`} className="font-semibold hover:text-amber-400">
                        {o.symbol}
                      </Link>
                      <span className="ml-1.5 text-[9.5px] text-[var(--ink-3)]">{(o.name ?? "").slice(0, 24)}</span>
                    </td>
                    <td className="tl text-[10px] text-[var(--ink-3)]">{o.sector ?? "—"}</td>
                    <td className="tabular-nums">{mcap(o.marketCap)}</td>
                    <td className="tabular-nums font-semibold">{o.egSetupScore ?? "—"}</td>
                    <td className={`tabular-nums ${(o.upsidePct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {pctf(o.upsidePct)}
                    </td>
                    <td className="tabular-nums">{frac(o.revenueGrowthYoY)}</td>
                    <td className="tabular-nums">{num(o.peTtm)}</td>
                    <td>
                      <Chip tone={signalTone(o.technicalSignal)}>
                        {(o.technicalSignal ?? "—").replaceAll("_", " ")}
                      </Chip>
                    </td>
                    <td className="tabular-nums">{num(o.riskReward)}</td>
                    <td className="tl max-w-[340px] truncate text-[9.5px] text-[var(--ink-3)]" title={whyLine(o, viewKey)}>
                      {whyLine(o, viewKey)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="text-[9.5px] leading-snug text-[var(--ink-3)]">
        Universe refresh runs as a background job (<code>scripts/sweep-universe.mts</code>); the page never
        computes. Need custom filters? The{" "}
        <Link href="/screener" className="text-amber-500/80 hover:underline">
          Screener
        </Link>{" "}
        runs over the same {meta.rows.toLocaleString()}-company table.
      </div>
    </div>
  );
}
