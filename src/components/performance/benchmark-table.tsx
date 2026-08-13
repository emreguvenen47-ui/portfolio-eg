import { Panel } from "@/components/shell/ui";
import { fmtPctPoints, signClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BenchmarkReport } from "@/lib/portfolio/benchmark";

const LABEL: Record<string, string> = {
  "1M": "1M",
  "3M": "3M",
  YTD: "YTD",
  "1Y": "1Y",
  "3Y": "3Y",
  SINCE: "Since creation",
};

/** Timeframe returns side by side with the benchmark, plus relative and drawdown. */
export function BenchmarkTable({
  report,
  benchmarkLabel,
}: {
  report: BenchmarkReport;
  benchmarkLabel: string;
}) {
  return (
    <Panel
      title="Benchmark Comparison"
      subtitle={
        report.from
          ? `vs ${benchmarkLabel}, both windowed from ${report.from}`
          : `vs ${benchmarkLabel}`
      }
      bodyClassName="p-0"
    >
      <table className="grid-table">
        <thead>
          <tr>
            <th className="tl">Timeframe</th>
            <th>Portfolio</th>
            <th>{benchmarkLabel}</th>
            <th>Relative</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r) => (
            <tr key={r.timeframe}>
              <td className="tl">{LABEL[r.timeframe] ?? r.timeframe}</td>
              <td className={cn("tabular-nums", signClass(r.portfolio))}>
                {r.portfolio === null ? "N/A" : fmtPctPoints(r.portfolio)}
              </td>
              <td className={cn("tabular-nums", signClass(r.benchmark))}>
                {r.benchmark === null ? "N/A" : fmtPctPoints(r.benchmark)}
              </td>
              <td className={cn("tabular-nums font-semibold", signClass(r.relative))}>
                {r.relative === null ? "N/A" : `${r.relative >= 0 ? "+" : ""}${r.relative.toFixed(2)}pp`}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-[var(--line)]">
            <td className="tl">Max drawdown</td>
            <td className="tabular-nums neg">{report.maxDrawdown.toFixed(2)}%</td>
            <td className="tabular-nums neg">{report.benchmarkMaxDrawdown.toFixed(2)}%</td>
            <td className="tabular-nums text-[var(--ink-3)]">—</td>
          </tr>
        </tbody>
      </table>
      <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
        Timeframes starting before the portfolio existed read N/A — no return is computed for a
        period it did not live through.
      </div>
    </Panel>
  );
}
