"use client";

import { useMemo, useState } from "react";
import { Kpi, Note, Panel } from "@/components/shell/ui";
import { cn } from "@/lib/utils";
import { fmtPctPoints, fmtUsd, signClass } from "@/lib/format";
import {
  breakEvenUsdTryChange,
  ppfScenarios,
  ppfUsdReturn,
} from "@/lib/finance/fx";
import { TRY_STRESS_STEPS } from "@/lib/portfolio/settings";

/**
 * PPF is a TL money-market fund, not an ETF. Its USD return is
 *   (1 + TL return) / (1 + Δ USD/TRY) − 1
 * which is NOT the same as subtracting depreciation from the yield — a
 * mistake that flatters the result at every level of depreciation.
 */
export function PpfCalculator({
  initialTlYield,
  initialUsdTry,
  initialExpectedChange,
  ppfValue,
  ppfWeight,
  ppfCode,
}: {
  initialTlYield: number;
  initialUsdTry: number;
  initialExpectedChange: number;
  ppfValue: number;
  ppfWeight: number;
  ppfCode: string;
}) {
  const [tlYield, setTlYield] = useState(initialTlYield * 100);
  const [spot, setSpot] = useState(initialUsdTry);
  const [expected, setExpected] = useState(initialExpectedChange * 100);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const y = tlYield / 100;
  const chg = expected / 100;

  const usdReturn = useMemo(() => ppfUsdReturn(y, chg), [y, chg]);
  const breakEven = breakEvenUsdTryChange(y);
  const breakEvenRate = spot * (1 + breakEven);
  const expectedRate = spot * (1 + chg);
  const atRisk = usdReturn < 0;

  const scenarios = useMemo(() => ppfScenarios(y, TRY_STRESS_STEPS), [y]);
  // A wrong-but-tempting shortcut, shown so the difference is visible.
  const naive = y - chg;

  const persist = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ppfTlYield: y,
          expectedUsdTryChange: chg,
          usdTryOverride: spot,
        }),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title={`${ppfCode} — Money-Market Fund Module`}
      subtitle="not an ETF: accrual + FX, never a market quote"
      actions={
        <button
          type="button"
          onClick={persist}
          disabled={saving}
          className="rounded-sm border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--ink-2)] hover:border-[var(--amber)] hover:text-[var(--amber)] disabled:opacity-50"
        >
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save assumptions"}
        </button>
      }
      bodyClassName="p-0"
    >
      <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-3">
        <Field
          label="PPF annual TL yield"
          suffix="%"
          value={tlYield}
          onChange={setTlYield}
          step={0.5}
        />
        <Field label="Current USD/TRY" value={spot} onChange={setSpot} step={0.1} decimals={4} />
        <Field
          label="Expected 12m USD/TRY change"
          suffix="%"
          value={expected}
          onChange={setExpected}
          step={1}
        />
      </div>

      <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-t border-[var(--line)] lg:grid-cols-4">
        <Kpi
          label="PPF Return in USD"
          value={fmtPctPoints(usdReturn * 100)}
          tone={usdReturn >= 0 ? "pos" : "neg"}
          sub="(1+TL)/(1+Δfx) − 1"
        />
        <Kpi
          label="Break-even USD/TRY move"
          value={fmtPctPoints(breakEven * 100)}
          sub={`rate ${breakEvenRate.toFixed(2)}`}
          tone="amber"
        />
        <Kpi
          label="Expected rate in 12m"
          value={expectedRate.toFixed(2)}
          sub={`from ${spot.toFixed(2)}`}
        />
        <Kpi
          label="USD P&L on sleeve"
          value={fmtUsd(ppfValue * usdReturn)}
          sub={`${(ppfWeight * 100).toFixed(1)}% of portfolio`}
          tone={usdReturn >= 0 ? "pos" : "neg"}
        />
      </div>

      {atRisk && (
        <div className="border-y border-[var(--down)]/40 bg-[var(--down)]/10 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="chip border-rose-500/50 bg-rose-500/15 text-rose-400">
              USD RETURN RISK
            </span>
            <span className="text-[11px] text-[var(--ink-2)]">
              Expected depreciation of {fmtPctPoints(chg * 100)} exceeds the{" "}
              {fmtPctPoints(y * 100)} TL yield, so the sleeve loses{" "}
              {fmtPctPoints(usdReturn * 100)} in USD terms despite a positive TL return.
            </span>
          </div>
        </div>
      )}

      <div className="p-3">
        <div className="kpi-label mb-2">TRY stress ladder</div>
        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">USD/TRY move</th>
              <th>Implied rate</th>
              <th>PPF return (USD)</th>
              <th>Sleeve P&amp;L</th>
              <th className="tl">Status</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => (
              <tr key={s.label}>
                <td className="tl">{s.label}</td>
                <td>{(spot * (1 + s.usdTryChange)).toFixed(2)}</td>
                <td className={signClass(s.usdReturn)}>{fmtPctPoints(s.usdReturn * 100)}</td>
                <td className={signClass(s.usdReturn)}>{fmtUsd(ppfValue * s.usdReturn)}</td>
                <td className="tl">
                  <span
                    className={cn(
                      "chip",
                      s.atRisk
                        ? "border-rose-500/50 bg-rose-500/10 text-rose-400"
                        : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
                    )}
                  >
                    {s.atRisk ? "USD RETURN RISK" : "POSITIVE"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-3 pb-3">
        <Note>
          <span>
            The correct translation is <strong>(1 + TL return) / (1 + Δ USD/TRY) − 1</strong>.
            Subtracting depreciation from the yield gives{" "}
            <span className="tnum">{fmtPctPoints(naive * 100)}</span> here, versus the correct{" "}
            <span className="tnum">{fmtPctPoints(usdReturn * 100)}</span> — a{" "}
            <span className="tnum">
              {fmtPctPoints((naive - usdReturn) * 100)}
            </span>{" "}
            overstatement. The gap widens as depreciation grows.
          </span>
        </Note>
      </div>
    </Panel>
  );
}

function Field({
  label,
  value,
  onChange,
  suffix,
  step = 1,
  decimals = 2,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: number;
  decimals?: number;
}) {
  return (
    <label className="block">
      <span className="kpi-label">{label}</span>
      <div className="mt-1 flex items-center gap-1 rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 focus-within:border-[var(--amber)]">
        <input
          type="number"
          step={step}
          value={Number.isFinite(value) ? Number(value.toFixed(decimals)) : 0}
          onChange={(e) => onChange(Number(e.target.value))}
          className="tnum w-full bg-transparent text-[13px] outline-none"
        />
        {suffix && <span className="text-[11px] text-[var(--ink-3)]">{suffix}</span>}
      </div>
    </label>
  );
}
