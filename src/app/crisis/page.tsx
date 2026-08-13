import { getContext } from "@/lib/server/context";
import { SampleBanner } from "@/components/shell/sample-banner";
import { getHistories } from "@/lib/providers";
import { Chip, Note, Panel } from "@/components/shell/ui";
import { CRISES, runCrisis } from "@/lib/portfolio/crisis";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Crisis Simulator" };

const pct = (v: number | null, digits = 1) =>
  v === null ? "N/A" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;

export default async function CrisisPage() {
  const ctx = await getContext();
  if (ctx.error)
    return (
      <Panel title="Error">
        <Note tone="warn">{ctx.error}</Note>
      </Panel>
    );

  const quotable = ctx.rows.filter((r) => r.position.symbol);
  const symbols = [...new Set(quotable.map((r) => r.position.symbol!))];
  const benchmark: string = ctx.settings.benchmark || "SPY";

  // 2007 to today is ~4,800 trading days. One fetch covers every window.
  const histories = await getHistories([...symbols, benchmark], 5000).catch(
    () => ({}) as Awaited<ReturnType<typeof getHistories>>,
  );

  const positions = quotable.map((r) => ({
    symbol: r.position.symbol!,
    weight: r.currentWeight,
    candles: histories[r.position.symbol!]?.candles ?? [],
  }));
  const bmCandles = histories[benchmark]?.candles ?? [];

  const results = CRISES.map((c) => runCrisis(c, positions, bmCandles));

  return (
    <div className="flex flex-col gap-3">
      <SampleBanner portfolio={ctx.portfolio} />
      <Note tone="warn">
        <span>
          <strong>Replay, not forecast.</strong> Each row applies today&apos;s weights to the
          actual daily closes of that period. Positions without price history for a window are
          excluded and the coverage figure says how much of the book that leaves — a portfolio
          of recently-listed funds cannot be &ldquo;tested&rdquo; against 2008.
        </span>
      </Note>

      <Panel
        title="Historical Crisis Simulator"
        subtitle={`current weights replayed through real closes, vs ${benchmark}`}
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Episode</th>
                <th className="tl">Window</th>
                <th>Coverage</th>
                <th>Total Return</th>
                <th>{benchmark}</th>
                <th>Max Drawdown</th>
                <th>Worst Day</th>
                <th className="tl">Recovery</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.crisis.id}>
                  <td className="tl font-semibold" title={r.crisis.note}>
                    {r.crisis.name}
                  </td>
                  <td className="tl text-[10px] tabular-nums text-[var(--ink-3)]">
                    {r.crisis.start} → {r.crisis.end}
                  </td>
                  <td
                    className={cn(
                      "tabular-nums",
                      r.coverage < 0.5 ? "text-rose-400" : r.coverage < 0.9 ? "text-amber-400" : "",
                    )}
                    title={r.note}
                  >
                    {(r.coverage * 100).toFixed(0)}%
                  </td>
                  <td className={cn("tabular-nums font-semibold", (r.totalReturn ?? 0) < 0 ? "text-rose-400" : "text-emerald-400")}>
                    {pct(r.totalReturn)}
                  </td>
                  <td className="tabular-nums text-[var(--ink-3)]">{pct(r.benchmarkReturn)}</td>
                  <td className="tabular-nums text-rose-400">{pct(r.maxDrawdown)}</td>
                  <td className="tabular-nums text-rose-400">{pct(r.worstDay)}</td>
                  <td className="tl text-[10px]">
                    {r.recoveryDays === null ? (
                      <span className="text-[var(--ink-3)]">
                        {r.coverage > 0 ? "not within window" : "N/A"}
                      </span>
                    ) : (
                      `${r.recoveryDays} trading days`
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {results
        .filter((r) => r.coverage > 0)
        .map((r) => {
          const covered = r.assets.filter((a) => a.covered && a.totalReturn !== null);
          const sorted = [...covered].sort((a, b) => (a.totalReturn ?? 0) - (b.totalReturn ?? 0));
          const worst = sorted.slice(0, 3);
          const best = sorted.slice(-3).reverse();
          const missing = r.assets.filter((a) => !a.covered);

          return (
            <Panel
              key={r.crisis.id}
              title={r.crisis.name}
              subtitle={r.crisis.note}
              bodyClassName="p-0"
            >
              <div className="grid grid-cols-1 divide-y divide-[var(--line)] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <div className="px-3 py-2">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-rose-400">
                    Worst contributors
                  </div>
                  <ul className="space-y-0.5">
                    {worst.map((a) => (
                      <li key={a.symbol} className="flex justify-between text-[10.5px]">
                        <span>{a.symbol}</span>
                        <span className="tabular-nums text-rose-400">{pct(a.totalReturn)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="px-3 py-2">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-emerald-400">
                    Best contributors
                  </div>
                  <ul className="space-y-0.5">
                    {best.map((a) => (
                      <li key={a.symbol} className="flex justify-between text-[10.5px]">
                        <span>{a.symbol}</span>
                        <span className={cn("tabular-nums", (a.totalReturn ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                          {pct(a.totalReturn)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              {missing.length > 0 && (
                <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
                  <Chip tone="warn">INSUFFICIENT HISTORY</Chip>{" "}
                  {missing.map((a) => a.symbol).join(", ")} — excluded, not assumed flat.
                </div>
              )}
            </Panel>
          );
        })}
    </div>
  );
}
