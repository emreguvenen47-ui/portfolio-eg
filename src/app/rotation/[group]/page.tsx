import Link from "next/link";
import { notFound } from "next/navigation";
import { runRotation } from "@/lib/rotation/engine";
import { groupById, TIMEFRAMES, US_BENCHMARK, type Timeframe } from "@/lib/rotation/sectors";
import { loadScreenerUniverse } from "@/lib/scanner/screener-universe";
import { CAP_BUCKET_LABEL } from "@/lib/scanner/types";
import { Note } from "@/components/shell/ui";
import "@/lib/providers/register";

export const dynamic = "force-dynamic";

/**
 * One flow group, opened up.
 *
 * The matrix answers where leadership is moving; this answers which names are
 * carrying it. Constituents are the same most-traded sample the breadth figure
 * is computed from, so the two readings cannot disagree — and the sample size
 * is stated, because twenty-four names are not a sector.
 */

const bucketLabel = (b: string): string => {
  const table = CAP_BUCKET_LABEL as unknown as Record<string, string>;
  return typeof table[b] === "string" ? table[b] : b;
};

const pct = (v: number | null) =>
  v === null ? "N/A" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

export default async function GroupPage({
  params,
  searchParams,
}: PageProps<"/rotation/[group]">) {
  const { group: id } = await params;
  const sp = await searchParams;
  const group = groupById(id);
  if (!group) notFound();

  const raw = typeof sp.tf === "string" ? sp.tf : "1W";
  const tf = (TIMEFRAMES.find((t) => t.key === raw)?.key ?? "1W") as Timeframe;

  const [{ groups }, universe] = await Promise.all([
    runRotation(tf).catch(() => ({ groups: [] })),
    loadScreenerUniverse().catch(() => []),
  ]);

  const g = groups.find((x) => x.group.id === id);
  const members = g?.members ?? [];

  // Size and name come from the universe listing, not from a second fetch.
  const meta = new Map(universe.map((u) => [u.symbol, u]));

  const withData = members.filter((m) => m.ret !== null);
  const ranked = [...withData].sort((a, b) => (b.ret ?? 0) - (a.ret ?? 0));
  const gainers = ranked.slice(0, 8);
  const losers = [...ranked].reverse().slice(0, 8);

  const smallMid = ranked.filter((m) => {
    const b = meta.get(m.symbol)?.bucket;
    return b === "SMALL" || b === "MID";
  });

  const improving = [...members]
    .filter((m) => m.improvement !== null)
    .sort((a, b) => (b.improvement ?? 0) - (a.improvement ?? 0))
    .slice(0, 8);

  const cell = g?.cells.find((c) => c.timeframe === tf) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <Link href="/rotation" className="text-[10px] text-[var(--ink-3)]">
          ← SECTOR FLOWS
        </Link>
        <h1 className="text-[15px] font-semibold">{group.label}</h1>
        <span className="text-[10px] text-[var(--ink-3)]">
          proxy {group.proxy} · vs {US_BENCHMARK} · {tf}
        </span>
      </div>

      <div className="flex flex-wrap gap-1">
        {TIMEFRAMES.map((t) => (
          <Link
            key={t.key}
            href={`/rotation/${id}?tf=${t.key}`}
            className={
              t.key === tf
                ? "rounded-sm border border-[var(--amber)] px-2 py-0.5 text-[10px] text-[var(--amber)]"
                : "rounded-sm border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--ink-2)]"
            }
          >
            {t.key}
          </Link>
        ))}
      </div>

      <Note>
        <span>
          A market rotation signal, not a fund flow. Returns, breadth and relative volume are the
          only inputs; nothing here measures money entering or leaving the sector.
        </span>
      </Note>

      <section className="panel">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 px-3 py-2 text-[10.5px]">
          <Stat label="Group return" v={pct(cell?.ret ?? null)} />
          <Stat label="Benchmark" v={pct(cell?.benchmarkRet ?? null)} />
          <Stat
            label="Relative"
            v={
              cell?.relative === null || cell?.relative === undefined
                ? "N/A"
                : `${cell.relative > 0 ? "+" : ""}${cell.relative.toFixed(1)}pp`
            }
          />
          <Stat label="Score" v={g?.score === null || g === undefined ? "N/A" : String(g.score)} />
          <Stat label="State" v={g?.state ?? "N/A"} />
          <Stat
            label="Above 50DMA"
            v={g?.breadth.above50 === null || !g ? "N/A" : `${g.breadth.above50.toFixed(0)}%`}
          />
          <Stat label="Sample" v={`${g?.breadth.sample ?? 0} names`} />
        </div>
        <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] leading-snug text-[var(--ink-3)]">
          Constituents are the {members.length} most-traded members of this group, the same sample
          the breadth figure uses. It is a liquid slice, not the full sector — names outside it are
          absent from these tables, not judged and excluded.
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Table title={`Top gainers · ${tf}`} rows={gainers} meta={meta} field="ret" />
        <Table title={`Top losers · ${tf}`} rows={losers} meta={meta} field="ret" />
        <Table
          title={`Best small & mid caps · ${tf}`}
          rows={smallMid.slice(0, 8)}
          meta={meta}
          field="ret"
          empty="No small or mid caps in the traded sample for this group."
        />
        <Table
          title="Most improving"
          rows={improving}
          meta={meta}
          field="improvement"
          note="Window return less the pace the last quarter set over the same span."
          empty="Not enough history to compare the window against the quarter."
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/screener${group.sector ? `?sector=${group.sector}` : ""}`}
          className="rounded-sm border border-[var(--amber)] px-2 py-1 text-[10px] text-[var(--amber)]"
        >
          SCREEN THIS SECTOR →
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-[9.5px] uppercase tracking-wide text-[var(--ink-3)]">{label}</span>
      <span className="tabular-nums">{v}</span>
    </span>
  );
}

function Table({
  title,
  rows,
  meta,
  field,
  note,
  empty,
}: {
  title: string;
  rows: { symbol: string; ret: number | null; improvement: number | null; above50: boolean | null }[];
  meta: Map<string, { name: string; bucket: string | null }>;
  field: "ret" | "improvement";
  note?: string;
  empty?: string;
}) {
  return (
    <section className="panel">
      <div className="border-b border-[var(--line)] px-3 py-1.5 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-[10px] text-[var(--ink-3)]">
          {empty ?? "No constituents with a reading."}
        </p>
      ) : (
        <table className="w-full text-[10.5px]">
          <tbody>
            {rows.map((r) => {
              const m = meta.get(r.symbol);
              const v = field === "ret" ? r.ret : r.improvement;
              return (
                <tr key={r.symbol} className="border-b border-[var(--line)] last:border-0">
                  <td className="px-3 py-1">
                    <Link href={`/ticker/${r.symbol}`} className="text-[var(--amber)]">
                      {r.symbol}
                    </Link>
                  </td>
                  <td className="max-w-[180px] truncate py-1 text-[9.5px] text-[var(--ink-3)]">
                    {m?.name ?? ""}
                  </td>
                  <td className="py-1 text-[9px] text-[var(--ink-3)]">
                    {m?.bucket ? bucketLabel(m.bucket) : "SIZE UNKNOWN"}
                  </td>
                  <td
                    className={`px-3 py-1 text-right tabular-nums ${
                      v === null ? "text-[var(--ink-3)]" : v > 0 ? "text-[var(--green)]" : "text-[var(--red)]"
                    }`}
                  >
                    {v === null ? "N/A" : `${v > 0 ? "+" : ""}${v.toFixed(1)}${field === "ret" ? "%" : "pp"}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {note && (
        <p className="border-t border-[var(--line)] px-3 py-1.5 text-[9px] text-[var(--ink-3)]">
          {note}
        </p>
      )}
    </section>
  );
}
