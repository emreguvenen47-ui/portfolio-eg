import Link from "next/link";
import { notFound } from "next/navigation";
import { Chip, Empty, Kpi, Note, Panel } from "@/components/shell/ui";
import { PortfolioEditor } from "@/components/ai-builder/portfolio-editor";
import { allTickers, currentAllocation, getPortfolio } from "@/lib/server/ai-portfolios";
import { computeAiPortfolioPerformance } from "@/lib/ai/portfolio-performance";
import { getHistories, getQuotes } from "@/lib/providers";
import { fmtPctPoints, fmtTime, signClass } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Horizontal weight bar, sized to the position's share of the book. */
function Bar({ weight, tone = "amber" }: { weight: number; tone?: "amber" | "muted" }) {
  return (
    <div className="h-1.5 w-full bg-[var(--panel-2)]">
      <div
        className={tone === "amber" ? "h-full bg-[var(--amber)]" : "h-full bg-[var(--ink-3)]"}
        style={{ width: `${Math.min(100, weight * 100 * 2.5)}%` }}
      />
    </div>
  );
}

export default async function SavedPortfolioPage(props: PageProps<"/ai-portfolios/[id]">) {
  const { id } = await props.params;
  const portfolio = await getPortfolio(id);
  if (!portfolio) notFound();

  const tickers = allTickers(portfolio);
  const [histories, quotes] = await Promise.all([
    getHistories(tickers, 800),
    getQuotes(tickers),
  ]);
  const perf = computeAiPortfolioPerformance(
    portfolio,
    Object.fromEntries(Object.entries(histories).map(([k, v]) => [k, v.candles])),
    quotes,
  );

  const live = currentAllocation(portfolio);
  const original = portfolio.allocations[0];
  const originalByTicker = new Map(original.positions.map((p) => [p.ticker, p]));

  const money = (v: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: perf.currency,
      maximumFractionDigits: 0,
    }).format(v);

  // What changed between the original AI allocation and the live one.
  const changes: { ticker: string; kind: string; detail: string }[] = [];
  for (const p of live.positions) {
    const before = originalByTicker.get(p.ticker);
    if (!before) {
      changes.push({
        ticker: p.ticker,
        kind: "added",
        detail: `manually added at ${(p.weight * 100).toFixed(1)}%`,
      });
    } else if (Math.abs(before.weight - p.weight) > 0.0005) {
      changes.push({
        ticker: p.ticker,
        kind: "reweighted",
        detail: `${(before.weight * 100).toFixed(1)}% → ${(p.weight * 100).toFixed(1)}%`,
      });
    } else if (before.role !== p.role) {
      changes.push({ ticker: p.ticker, kind: "role", detail: `${before.role} → ${p.role}` });
    }
  }
  for (const p of original.positions) {
    if (!live.positions.some((x) => x.ticker === p.ticker)) {
      changes.push({
        ticker: p.ticker,
        kind: "removed",
        detail: `was ${(p.weight * 100).toFixed(1)}%`,
      });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/ai-builder" className="text-[11px] text-[var(--ink-3)] hover:text-[var(--amber)]">
          ← AI Builder
        </Link>
        <h1 className="text-[16px] font-semibold">{portfolio.name}</h1>
        <Chip tone="info">{portfolio.profile?.investorType ?? "Saved portfolio"}</Chip>
        <span className="text-[10px] text-[var(--ink-3)]">
          created {fmtTime(portfolio.baseline.at || portfolio.createdAt)}
        </span>
      </div>

      <Note tone="warn">
        <span>
          <strong>Modelling tool, not advice.</strong> Hypothetical allocation; performance is
          measured from real prices since creation only.
        </span>
      </Note>

      <Panel bodyClassName="p-3">
        <PortfolioEditor
          id={portfolio.id}
          name={portfolio.name}
          positions={live.positions}
        />
      </Panel>

      {/* ---------------------------------------------------- performance */}
      <Panel title="Performance" bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Estimated Value" value={money(perf.value)} sub={`from ${money(perf.startValue)}`} />
          <Kpi
            label="Since Creation"
            value={
              perf.window.sinceCreation === null ? "—" : fmtPctPoints(perf.window.sinceCreation)
            }
            sub={money(perf.totalReturnAbs)}
            tone={perf.totalReturnPct >= 0 ? "pos" : "neg"}
          />
          <Kpi
            label="Daily"
            value={fmtPctPoints(perf.dailyChangePct)}
            tone={perf.dailyChangePct >= 0 ? "pos" : "neg"}
          />
          <Kpi label="1M" value={perf.window.m1 === null ? "—" : fmtPctPoints(perf.window.m1)} />
          <Kpi label="3M" value={perf.window.m3 === null ? "—" : fmtPctPoints(perf.window.m3)} />
          <Kpi label="YTD" value={perf.window.ytd === null ? "—" : fmtPctPoints(perf.window.ytd)} />
        </div>
        <div className="border-t border-[var(--line)] px-3 py-1.5 text-[10px] text-[var(--ink-3)]">
          Full chart and contribution breakdown on the{" "}
          <Link href={`/performance?portfolio=${portfolio.id}`} className="text-[var(--amber)]">
            Performance page
          </Link>
          .
        </div>
      </Panel>

      {perf.unavailable.length > 0 && (
        <Note tone="warn">
          <span>
            <strong>NO BASELINE:</strong> {perf.unavailable.join(", ")} — excluded from
            performance until a real entry price exists.
          </span>
        </Note>
      )}

      {/* ------------------------------------------- current vs original */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel
          title="Current Allocation"
          subtitle={`in force since ${fmtTime(live.at)}`}
          bodyClassName="p-0"
        >
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Ticker</th>
                <th className="tl">Origin</th>
                <th>Target</th>
                <th className="tl w-[90px]" />
                <th>Market</th>
                <th>Drift</th>
                <th className="tl">Role</th>
              </tr>
            </thead>
            <tbody>
              {live.positions.map((p) => {
                const pp = perf.positions.find((x) => x.ticker === p.ticker);
                return (
                  <tr key={p.ticker}>
                    <td className="tl font-semibold">
                      <Link
                        href={`/ticker/${encodeURIComponent(p.ticker)}`}
                        className="hover:text-[var(--amber)]"
                      >
                        {p.ticker}
                      </Link>
                    </td>
                    <td className="tl">
                      <Chip tone={p.source === "ai" ? "info" : "amber"}>
                        {p.source === "ai" ? "AI" : "MANUAL"}
                      </Chip>
                    </td>
                    <td className="tabular-nums">{(p.weight * 100).toFixed(1)}%</td>
                    <td>
                      <Bar weight={p.weight} />
                    </td>
                    <td className="tabular-nums">
                      {pp?.available ? `${(pp.currentWeight * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className={cn("tabular-nums", signClass(pp?.drift))}>
                      {pp?.available ? `${(pp.drift * 100).toFixed(1)}pp` : "—"}
                    </td>
                    <td className="tl text-[10px]">{p.role}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="tl font-semibold" colSpan={2}>
                  TOTAL
                </td>
                <td className="tabular-nums font-semibold">
                  {(live.positions.reduce((s, p) => s + p.weight, 0) * 100).toFixed(1)}%
                </td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </Panel>

        <Panel
          title="Original AI Allocation"
          subtitle={`as generated ${fmtTime(original.at)} — never overwritten`}
          bodyClassName="p-0"
        >
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Ticker</th>
                <th>Weight</th>
                <th className="tl w-[90px]" />
                <th className="tl">Role</th>
                <th className="tl">Status</th>
              </tr>
            </thead>
            <tbody>
              {original.positions.map((p) => {
                const stillHeld = live.positions.some((x) => x.ticker === p.ticker);
                return (
                  <tr key={p.ticker}>
                    <td className="tl font-semibold">{p.ticker}</td>
                    <td className="tabular-nums">{(p.weight * 100).toFixed(1)}%</td>
                    <td>
                      <Bar weight={p.weight} tone="muted" />
                    </td>
                    <td className="tl text-[10px]">{p.role}</td>
                    <td className="tl">
                      {stillHeld ? (
                        <span className="text-[10px] text-[var(--ink-3)]">held</span>
                      ) : (
                        <Chip tone="neg">removed</Chip>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>

      {/* ------------------------------------------------------- changes */}
      <Panel
        title="Changes"
        subtitle="original AI recommendation vs the allocation in force"
        bodyClassName="p-0"
      >
        {changes.length === 0 ? (
          <Empty>Unchanged from the original AI allocation.</Empty>
        ) : (
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Ticker</th>
                <th className="tl">Change</th>
                <th className="tl">Detail</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={`${c.ticker}-${c.kind}`}>
                  <td className="tl font-semibold">{c.ticker}</td>
                  <td className="tl">
                    <Chip
                      tone={
                        c.kind === "added" ? "pos" : c.kind === "removed" ? "neg" : "warn"
                      }
                    >
                      {c.kind}
                    </Chip>
                  </td>
                  <td className="tl text-[10.5px] text-[var(--ink-3)]">{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
