import { Chip, Empty } from "@/components/shell/ui";

import { Arrow, Change, Metric, ScoreBar, Spark, compactMoney, fmtValue } from "./primitives";
import { cn } from "@/lib/utils";
import type { SmartMoney, SignalTone } from "@/lib/research/smart-money";
import type { HealthReport } from "@/lib/research/health";
import type { AnalystReport } from "@/lib/research/analysts";
import type { GuidanceReport } from "@/lib/research/guidance";
import type {
  CapitalAllocation,
  EarningsQuality,
  OverviewSection,
  TrendReport,
} from "@/lib/research/statements";
import { GUIDANCE_LABEL } from "@/lib/research/guidance";

const TONE_CLASS: Record<SignalTone, string> = {
  POSITIVE: "text-emerald-400",
  NEGATIVE: "text-rose-400",
  NEUTRAL: "text-[var(--ink)]",
  NA: "text-[var(--ink-3)]",
};

// ------------------------------------------------------------- smart money

export function SmartMoneyPanel({ data }: { data: SmartMoney }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
        <span className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
          Smart Money Score
        </span>
        <span className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold tabular-nums">
            {data.score === null ? "N/A" : `${data.score}/100`}
          </span>
          <span className="text-[10px] text-[var(--ink-3)]">
            Coverage: {data.coverage}/{data.total} signals
          </span>
        </span>
      </div>

      <ul className="divide-y divide-[var(--line-soft)]">
        {data.signals.map((s) => (
          <li
            key={s.key}
            className="flex items-baseline justify-between gap-3 px-3 py-1 text-[11px]"
            title={s.basis}
          >
            <span className="truncate text-[var(--ink-2)]">{s.label}</span>
            <span className={cn("shrink-0 font-medium tabular-nums", TONE_CLASS[s.tone])}>
              {s.display}
            </span>
          </li>
        ))}
      </ul>

      <div className="border-t border-[var(--line)] px-3 py-2 text-[9.5px] leading-snug text-[var(--ink-3)]">
        The score is the plain mean of the {data.coverage} signal
        {data.coverage === 1 ? "" : "s"} that had data, each graded 0–100. Signals reading N/A
        are excluded from the denominator rather than scored zero — no analyst coverage is not
        the same as bad analyst coverage. Hover any row for how it was derived. This is a
        summary of available evidence, not a buy or sell recommendation.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- key metrics

export interface KeyMetricItem {
  label: string;
  display: string;
  direction: "up" | "flat" | "down";
  hint?: string;
}

export function KeyMetricsPanel({ items }: { items: KeyMetricItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-2 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((i) => (
        <div
          key={i.label}
          className="flex items-baseline justify-between gap-2 border-b border-[var(--line-soft)] px-3 py-1.5 text-[11px]"
          title={i.hint}
        >
          <span className="truncate text-[var(--ink-3)]">{i.label}</span>
          <span className="flex shrink-0 items-baseline gap-1">
            <span className="tabular-nums font-medium">{i.display}</span>
            <Arrow direction={i.direction} />
          </span>
        </div>
      ))}
    </div>
  );
}

// --------------------------------------------------------------------- health

export function HealthPanel({ health }: { health: HealthReport }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
        <span className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
          Overall Financial Quality
        </span>
        <span className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold tabular-nums">
            {health.total === null ? "N/A" : `${health.total}/100`}
          </span>
          <span className="text-[10px] text-[var(--ink-3)]">{health.coverage}/5 pillars</span>
        </span>
      </div>

      <ul className="divide-y divide-[var(--line-soft)]">
        {health.pillars.map((p) => (
          <li
            key={p.key}
            className="flex items-center justify-between gap-3 px-3 py-1.5 text-[11px]"
            title={`From ${p.basis}.`}
          >
            <span className="truncate text-[var(--ink-2)]">{p.label}</span>
            <ScoreBar score={p.score} />
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-1 divide-y divide-[var(--line)] border-t border-[var(--line)] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="px-3 py-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-emerald-400">
            Strengths
          </div>
          {health.strengths.length === 0 ? (
            <p className="text-[10.5px] text-[var(--ink-3)]">
              Nothing met the thresholds on reported figures.
            </p>
          ) : (
            <ul className="space-y-1">
              {health.strengths.map((s, i) => (
                <li key={i} className="text-[10.5px] leading-snug">
                  <span className="text-[var(--ink)]">{s.text}</span>
                  <span className="block text-[9.5px] text-[var(--ink-3)]">{s.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-3 py-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-amber-400">
            Watch Items
          </div>
          {health.watch.length === 0 ? (
            <p className="text-[10.5px] text-[var(--ink-3)]">
              Nothing met the thresholds on reported figures.
            </p>
          ) : (
            <ul className="space-y-1">
              {health.watch.map((s, i) => (
                <li key={i} className="text-[10.5px] leading-snug">
                  <span className="text-[var(--ink)]">{s.text}</span>
                  <span className="block text-[9.5px] text-[var(--ink-3)]">{s.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- earnings trend

export function TrendPanel({
  trend,
  freq,
  sym = "$",
}: {
  trend: TrendReport;
  freq: "QUARTERLY" | "ANNUAL";
  sym?: string;
}) {
  if (!trend.periodLabels.length) {
    return <Empty>No reported statements available for this symbol.</Empty>;
  }
  const rows = [...trend.metrics, ...trend.margins];
  const yoyLabel = freq === "ANNUAL" ? "vs 1Y" : "YoY";
  const qoqLabel = freq === "ANNUAL" ? "vs prior FY" : "QoQ";

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">Metric</th>
              <th>Latest</th>
              <th>{qoqLabel}</th>
              <th>{yoyLabel}</th>
              <th className="tl">
                Trend
                <span className="ml-1 font-normal text-[var(--ink-3)]">
                  {trend.periodLabels[0]} → {trend.periodLabels.at(-1)}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.key}>
                <td className="tl">{m.label}</td>
                <td className="tabular-nums font-medium">{fmtValue(m.latest, m.format, sym)}</td>
                <td>
                  <Change
                    value={m.qoq}
                    suffix={m.format === "pct" ? "pp" : "%"}
                    good="up"
                  />
                </td>
                <td>
                  <Change
                    value={m.yoy}
                    suffix={m.format === "pct" ? "pp" : "%"}
                    good="up"
                  />
                </td>
                <td className="tl">
                  <Spark series={m.series} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {trend.observations.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-[var(--line)] px-3 py-2">
          {trend.observations.map((o, i) => (
            <Chip key={i} tone={o.tone === "pos" ? "pos" : o.tone === "neg" ? "neg" : "neutral"}>
              {o.text}
            </Chip>
          ))}
        </div>
      )}

      <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] leading-snug text-[var(--ink-3)]">
        Figures come from filed statements.{" "}
        {freq === "QUARTERLY" && (
          <>
            Quarterly income and cash-flow lines are reported year-to-date in each 10-Q, so
            each quarter here has the prior quarter subtracted to give a discrete figure; Q4
            is derived from the 10-K less nine-month year-to-date.{" "}
          </>
        )}
        Margin changes are in percentage points. Blank cells are periods the filing did not
        carry — never zeros.
      </div>
    </div>
  );
}

// ----------------------------------------------------------- earnings quality

export function EarningsQualityPanel({ q, sym = "$" }: { q: EarningsQuality; sym?: string }) {
  const money = (n: number | null | undefined) => compactMoney(n, sym);
  const tone =
    q.verdict === "HIGH QUALITY" ? "pos" : q.verdict === "WATCH" ? "warn" : "neutral";
  return (
    <div>
      <div className="flex items-baseline gap-2 border-b border-[var(--line)] px-3 py-2">
        <Chip tone={tone}>{q.verdict}</Chip>
        <span className="min-w-0 flex-1 text-[10.5px] leading-snug text-[var(--ink-2)]">
          {q.note}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2">
        <Metric label="Net Income (TTM)" value={money(q.netIncome)} />
        <Metric label="Operating Cash Flow (TTM)" value={money(q.operatingCashFlow)} />
        <Metric label="Free Cash Flow (TTM)" value={money(q.freeCashFlow)} />
        <Metric
          label="OCF / Net Income"
          value={q.ocfToNi === null ? "N/A" : `${q.ocfToNi.toFixed(2)}×`}
          tone={q.ocfToNi === null ? undefined : q.ocfToNi >= 1 ? "pos" : q.ocfToNi < 0.8 ? "neg" : undefined}
          hint="Above 1.0× means the business collected more cash than it booked as profit."
        />
        <Metric
          label="FCF / Net Income"
          value={q.fcfToNi === null ? "N/A" : `${q.fcfToNi.toFixed(2)}×`}
          tone={q.fcfToNi === null ? undefined : q.fcfToNi >= 0.8 ? "pos" : q.fcfToNi < 0.5 ? "neg" : undefined}
          hint="Cash left after capital spending, against reported profit."
        />
      </div>
      <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] leading-snug text-[var(--ink-3)]">
        A gap between reported profit and cash generation has many ordinary causes — working
        capital swings, timing, heavy investment. This panel describes the divergence; it does
        not assert anything about how the figures were produced.
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ analysts

export function AnalystPanel({
  report,
  price,
}: {
  report: AnalystReport;
  price: number | null;
}) {
  const l = report.latest;
  const upside =
    report.targets && price ? (report.targets.mean / price - 1) * 100 : null;

  return (
    <div>
      <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-4">
        <Metric label="Consensus" value={report.label} />
        <Metric label="Momentum" value={report.momentum} hint={report.momentumNote} />
        <Metric label="Covering" value={l ? String(l.total) : "N/A"} />
        <Metric
          label="Net Buy Change"
          value={report.netUpgrades === null ? "N/A" : `${report.netUpgrades > 0 ? "+" : ""}${report.netUpgrades}`}
          hint="Change in the number of buy and strong-buy ratings over roughly three months."
        />
      </div>

      {l && (
        <div className="overflow-x-auto border-t border-[var(--line)]">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Period</th>
                <th>Strong Buy</th>
                <th>Buy</th>
                <th>Hold</th>
                <th>Sell</th>
                <th>Strong Sell</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {[...report.history].reverse().slice(0, 6).map((r) => (
                <tr key={r.period}>
                  <td className="tl tabular-nums">{r.period}</td>
                  <td className="tabular-nums text-emerald-400">{r.strongBuy}</td>
                  <td className="tabular-nums text-emerald-400/70">{r.buy}</td>
                  <td className="tabular-nums">{r.hold}</td>
                  <td className="tabular-nums text-rose-400/70">{r.sell}</td>
                  <td className="tabular-nums text-rose-400">{r.strongSell}</td>
                  <td className="tabular-nums font-medium">{r.score.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-t border-[var(--line)] sm:grid-cols-4">
        <Metric label="Average Target" value={report.targets ? `$${report.targets.mean.toFixed(2)}` : "N/A"} />
        <Metric label="High Target" value={report.targets ? `$${report.targets.high.toFixed(2)}` : "N/A"} />
        <Metric label="Low Target" value={report.targets ? `$${report.targets.low.toFixed(2)}` : "N/A"} />
        <Metric
          label="Implied Upside"
          value={upside === null ? "N/A" : `${upside > 0 ? "+" : ""}${upside.toFixed(1)}%`}
        />
      </div>

      <div className="border-t border-[var(--line)] px-3 py-2">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
          Recent Analyst Actions
        </div>
        {report.actions.length === 0 ? (
          <p className="text-[10.5px] leading-snug text-[var(--ink-3)]">{report.gapNote}</p>
        ) : (
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Date</th>
                <th className="tl">Firm</th>
                <th className="tl">Action</th>
                <th className="tl">Rating</th>
                <th className="tl">Target</th>
              </tr>
            </thead>
            <tbody>
              {report.actions.slice(0, 12).map((a, i) => (
                <tr key={i}>
                  <td className="tl tabular-nums">{a.date}</td>
                  <td className="tl">{a.firm}</td>
                  <td className="tl">
                    <Chip
                      tone={
                        a.kind === "UPGRADE" || a.kind === "TARGET RAISED"
                          ? "pos"
                          : a.kind === "DOWNGRADE" || a.kind === "TARGET CUT"
                            ? "neg"
                            : "neutral"
                      }
                    >
                      {a.kind}
                    </Chip>
                  </td>
                  <td className="tl text-[10px]">
                    {a.fromRating ?? "N/A"} → {a.toRating ?? "N/A"}
                  </td>
                  <td className="tl text-[10px] tabular-nums">
                    {a.fromTarget === null ? "N/A" : `$${a.fromTarget}`} →{" "}
                    {a.toTarget === null ? "N/A" : `$${a.toTarget}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ guidance

export function GuidancePanel({ report }: { report: GuidanceReport }) {
  if (!report.available) {
    return (
      <div className="px-3 py-3 text-[10.5px] leading-snug text-[var(--ink-3)]">
        <div className="mb-1">
          <Chip tone="neutral">GUIDANCE TREND: N/A</Chip>
        </div>
        {report.note}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline gap-2 border-b border-[var(--line)] px-3 py-2">
        <span className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
          Guidance Trend
        </span>
        <Chip
          tone={
            report.trend === "IMPROVING" ? "pos" : report.trend === "DETERIORATING" ? "neg" : "neutral"
          }
        >
          {report.trend}
        </Chip>
      </div>
      <div className="overflow-x-auto">
        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">Metric</th>
              <th className="tl">Period</th>
              <th className="tl">Previous</th>
              <th className="tl">New</th>
              <th className="tl">Change</th>
              <th>Actual</th>
            </tr>
          </thead>
          <tbody>
            {report.entries.map((e, i) => (
              <tr key={i}>
                <td className="tl">{GUIDANCE_LABEL[e.metric]}</td>
                <td className="tl">{e.period}</td>
                <td className="tl tabular-nums">{range(e.previous)}</td>
                <td className="tl tabular-nums">{range(e.current)}</td>
                <td className="tl">
                  <Chip
                    tone={e.change === "RAISED" ? "pos" : e.change === "LOWERED" || e.change === "WITHDRAWN" ? "neg" : "neutral"}
                  >
                    {e.change}
                  </Chip>
                </td>
                <td className="tabular-nums">{e.actual === null ? "N/A" : e.actual}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const range = (r: { low: number | null; high: number | null } | null): string => {
  if (!r) return "N/A";
  if (r.low !== null && r.high !== null) return `${r.low} – ${r.high}`;
  return String(r.low ?? r.high ?? "N/A");
};

// -------------------------------------------------------- capital allocation

export function CapitalPanel({ data, sym = "$" }: { data: CapitalAllocation; sym?: string }) {
  const money = (n: number | null | undefined) => compactMoney(n, sym);
  if (!data.periodLabels.length) {
    return <Empty>No cash-flow statements available for this symbol.</Empty>;
  }
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-2 border-b border-[var(--line)] px-3 py-2">
        <span className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
          Shares Outstanding YoY
        </span>
        <span
          className={cn(
            "text-[13px] font-semibold tabular-nums",
            data.shareCountYoY === null
              ? "text-[var(--ink-3)]"
              : data.shareCountYoY < 0
                ? "text-emerald-400"
                : "text-rose-400",
          )}
        >
          {data.shareCountYoY === null
            ? "N/A"
            : `${data.shareCountYoY > 0 ? "+" : ""}${data.shareCountYoY.toFixed(1)}%`}
        </span>
        <Chip
          tone={
            data.shareVerdict === "NET BUYBACK" ? "pos" : data.shareVerdict === "DILUTION" ? "neg" : "neutral"
          }
        >
          {data.shareVerdict}
        </Chip>
        <span className="text-[9.5px] text-[var(--ink-3)]">
          measured from the diluted share count in the filings, not from buyback spend
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">Use of Cash</th>
              <th>Latest</th>
              <th>TTM</th>
              <th className="tl">Trend</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.key}>
                <td className="tl">{r.label}</td>
                <td className="tabular-nums">{money(r.latest)}</td>
                <td className="tabular-nums font-medium">{money(r.ttm)}</td>
                <td className="tl">
                  <Spark series={r.series} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ overview

export function OverviewGrid({ sections, sym = "$" }: { sections: OverviewSection[]; sym?: string }) {
  const disputed = sections.flatMap((s) => s.items).filter((i) => i.agreement === "DISPUTED");

  return (
    <>
      <p className="px-3 pb-1 text-[9.5px] leading-snug text-[var(--ink-3)]">
        Margins, returns and leverage are each derived twice — once from the filed statements and
        once from the provider&apos;s own figure.{" "}
        <span className="inline-block h-1 w-1 translate-y-[-1px] rounded-full bg-emerald-400/70" />{" "}
        both agree ·{" "}
        <span className="inline-block h-1 w-1 translate-y-[-1px] rounded-full bg-[var(--ink-3)]/50" />{" "}
        one source only ·{" "}
        <span className="inline-block h-1 w-1 translate-y-[-1px] rounded-full bg-[var(--amber)]" />{" "}
        they disagree, and the filed figure is shown. Hover any row for the detail.
        {disputed.length > 0 && (
          <span className="text-[var(--amber)]">
            {" "}
            {disputed.length} figure{disputed.length === 1 ? "" : "s"} disagree here.
          </span>
        )}
      </p>
    <div className="grid grid-cols-1 gap-px bg-[var(--line)] sm:grid-cols-2 lg:grid-cols-3">
      {sections.map((s) => (
        <div key={s.title} className="bg-[var(--panel)]">
          <div className="border-b border-[var(--line-soft)] px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
            {s.title}
          </div>
          {s.items.map((i) => (
            <Metric
              key={i.label}
              label={i.label}
              value={fmtValue(i.value, i.format, sym)}
              hint={i.hint}
              agreement={i.agreement}
            />
          ))}
        </div>
      ))}
      </div>
    </>
  );
}
