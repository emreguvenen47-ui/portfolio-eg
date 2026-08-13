"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/shell/ui";
import type { AppSettings } from "@/lib/portfolio/settings";

export function SettingsForm({ initial }: { initial: AppSettings }) {
  const router = useRouter();
  const [s, setS] = useState<AppSettings>(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  const save = async () => {
    setState("saving");
    setMessage("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(s),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setState("saved");
      router.refresh();
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : "Save failed");
    }
  };

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => {
    setS((prev) => ({ ...prev, [k]: v }));
    setState("idle");
  };

  return (
    <Panel
      title="Assumptions"
      subtitle="forward-looking inputs, not workbook data"
      actions={
        <button
          type="button"
          onClick={save}
          disabled={state === "saving"}
          className="rounded-sm border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--ink-2)] hover:border-[var(--amber)] hover:text-[var(--amber)] disabled:opacity-50"
        >
          {state === "saving" ? "Saving…" : state === "saved" ? "Saved ✓" : "Save"}
        </button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Num
          label="PPF annual TL yield"
          suffix="%"
          value={s.ppfTlYield * 100}
          onChange={(v) => set("ppfTlYield", v / 100)}
          hint="Nominal lira yield on the money-market sleeve."
        />
        <Num
          label="Expected 12m USD/TRY change"
          suffix="%"
          value={s.expectedUsdTryChange * 100}
          onChange={(v) => set("expectedUsdTryChange", v / 100)}
          hint="+28 means the lira weakens 28% against the dollar."
        />
        <Num
          label="USD/TRY override"
          value={s.usdTryOverride ?? 0}
          onChange={(v) => set("usdTryOverride", v > 0 ? v : null)}
          hint="0 = use the market rate from the data provider."
          step={0.1}
        />
        <Num
          label="Risk-free rate"
          suffix="%"
          value={s.riskFreeRate * 100}
          onChange={(v) => set("riskFreeRate", v / 100)}
          hint="Used as the Sharpe ratio hurdle."
          step={0.1}
        />
        <Num
          label="Drift threshold"
          suffix="pp"
          value={s.driftThreshold * 100}
          onChange={(v) => set("driftThreshold", v / 100)}
          hint="Rebalance band. Positions inside it are left alone."
          step={0.25}
        />
        <label className="block">
          <span className="kpi-label">Cost-basis date</span>
          <input
            type="date"
            value={s.inceptionDate}
            onChange={(e) => set("inceptionDate", e.target.value)}
            className="mt-1 w-full rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[12px] outline-none focus:border-[var(--amber)]"
          />
          <span className="mt-0.5 block text-[9.5px] text-[var(--ink-3)]">
            Positions are struck at this date to compute P&amp;L.
          </span>
        </label>
        <label className="block">
          <span className="kpi-label">Benchmark</span>
          <select
            value={s.benchmark}
            onChange={(e) => set("benchmark", e.target.value as AppSettings["benchmark"])}
            className="mt-1 w-full rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[12px] outline-none focus:border-[var(--amber)]"
          >
            <option value="SPX">S&amp;P 500</option>
            <option value="XU100">BIST 100</option>
            <option value="NONE">None</option>
          </select>
          <span className="mt-0.5 block text-[9.5px] text-[var(--ink-3)]">
            Used for the portfolio beta calculation.
          </span>
        </label>
      </div>

      {state === "error" && (
        <p className="mt-2 text-[10.5px] text-[var(--down)]">{message}</p>
      )}
    </Panel>
  );
}

function Num({
  label,
  value,
  onChange,
  suffix,
  hint,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  hint?: string;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="kpi-label">{label}</span>
      <div className="mt-1 flex items-center gap-1 rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 focus-within:border-[var(--amber)]">
        <input
          type="number"
          step={step}
          value={Number.isFinite(value) ? Number(value.toFixed(4)) : 0}
          onChange={(e) => onChange(Number(e.target.value))}
          className="tnum w-full bg-transparent text-[12px] outline-none"
        />
        {suffix && <span className="text-[11px] text-[var(--ink-3)]">{suffix}</span>}
      </div>
      {hint && <span className="mt-0.5 block text-[9.5px] text-[var(--ink-3)]">{hint}</span>}
    </label>
  );
}
