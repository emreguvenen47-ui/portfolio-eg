"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Chip, Empty } from "@/components/shell/ui";
import { cn } from "@/lib/utils";

interface Rule {
  id: string;
  subject: string;
  kind: string;
  threshold: number;
  enabled: boolean;
  note?: string;
}

/** Grouped so the picker reads as categories rather than one long list. */
const GROUPS: { group: string; kinds: { kind: string; label: string; unit: string }[] }[] = [
  {
    group: "Price",
    kinds: [
      { kind: "price_above", label: "Price above", unit: "price" },
      { kind: "price_below", label: "Price below", unit: "price" },
      { kind: "pct_move", label: "Daily move exceeds", unit: "%" },
      { kind: "drawdown_from_high", label: "Drawdown from 52w high", unit: "%" },
    ],
  },
  {
    group: "Moving averages",
    kinds: [
      { kind: "cross_20dma", label: "Price crosses 20DMA", unit: "—" },
      { kind: "cross_50dma", label: "Price crosses 50DMA", unit: "—" },
      { kind: "cross_200dma", label: "Price crosses 200DMA", unit: "—" },
      { kind: "cross_20_50", label: "20DMA crosses 50DMA", unit: "—" },
      { kind: "cross_50_200", label: "50DMA crosses 200DMA", unit: "—" },
    ],
  },
  {
    group: "Technical",
    kinds: [
      { kind: "rsi_above", label: "RSI above", unit: "RSI" },
      { kind: "rsi_below", label: "RSI below", unit: "RSI" },
      { kind: "breakout_52w", label: "52-week breakout", unit: "—" },
      { kind: "volume_spike", label: "Volume spike", unit: "× avg" },
      { kind: "volatility_spike", label: "Realised vol above", unit: "%" },
    ],
  },
  {
    group: "Portfolio",
    kinds: [
      { kind: "weight_above", label: "Position weight above", unit: "%" },
      { kind: "weight_below", label: "Position weight below", unit: "%" },
      { kind: "portfolio_drawdown", label: "Portfolio drawdown", unit: "%" },
      { kind: "concentration", label: "Largest position above", unit: "%" },
      { kind: "currency_exposure", label: "Currency exposure above", unit: "%" },
    ],
  },
];

const ALL = GROUPS.flatMap((g) => g.kinds);

export function RuleBuilder() {
  const router = useRouter();
  const [rules, setRules] = useState<Rule[]>([]);
  const [subject, setSubject] = useState("QQQ");
  const [kind, setKind] = useState("price_below");
  const [threshold, setThreshold] = useState("700");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await fetch("/api/alerts");
    const json = await res.json();
    setRules(json.rules ?? []);
  };

  useEffect(() => {
    void load();
  }, []);

  const post = async (body: unknown) => {
    setBusy(true);
    try {
      await fetch("/api/alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      await load();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const unit = ALL.find((k) => k.kind === kind)?.unit ?? "";
  // Crossover rules fire on the crossing itself, so a threshold is meaningless.
  const needsThreshold = unit !== "—";

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2 border-b border-[var(--line)] p-3">
        <label className="flex flex-col gap-1">
          <span className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
            Ticker / subject
          </span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value.toUpperCase())}
            className="w-28 rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[11px] uppercase outline-none focus:border-[var(--amber)]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
            Condition
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[11px] outline-none focus:border-[var(--amber)]"
          >
            {GROUPS.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.kinds.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {k.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {needsThreshold && (
          <label className="flex flex-col gap-1">
            <span className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
              Threshold ({unit})
            </span>
            <input
              value={threshold}
              onChange={(e) => setThreshold(e.target.value.replace(/[^\d.\-]/g, ""))}
              className="w-24 rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[11px] tabular-nums outline-none focus:border-[var(--amber)]"
            />
          </label>
        )}
        <button
          type="button"
          disabled={busy || !subject.trim()}
          onClick={() =>
            post({
              action: "create",
              subject: subject.trim(),
              kind,
              threshold: needsThreshold ? Number(threshold) || 0 : 0,
            })
          }
          className="rounded-sm border border-[var(--amber)] bg-[rgba(255,160,40,0.12)] px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--amber)] hover:bg-[rgba(255,160,40,0.2)] disabled:opacity-40"
        >
          Add alert
        </button>
        <span className="text-[10px] text-[var(--ink-3)]">
          Evaluated in code on every refresh — no AI.
        </span>
      </div>

      {rules.length === 0 ? (
        <Empty>No custom alerts yet.</Empty>
      ) : (
        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">Subject</th>
              <th className="tl">Condition</th>
              <th>Threshold</th>
              <th className="tl">State</th>
              <th className="tl" />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => {
              const meta = ALL.find((k) => k.kind === r.kind);
              return (
                <tr key={r.id}>
                  <td className="tl font-semibold">{r.subject}</td>
                  <td className="tl text-[10.5px]">{meta?.label ?? r.kind}</td>
                  <td className="tabular-nums">
                    {meta?.unit === "—" ? "—" : `${r.threshold} ${meta?.unit ?? ""}`}
                  </td>
                  <td className="tl">
                    <button
                      type="button"
                      onClick={() => post({ action: "toggle", id: r.id, enabled: !r.enabled })}
                      className={cn("text-[10px]", r.enabled ? "text-[var(--up)]" : "text-[var(--ink-3)]")}
                    >
                      <Chip tone={r.enabled ? "pos" : "neutral"}>
                        {r.enabled ? "ACTIVE" : "PAUSED"}
                      </Chip>
                    </button>
                  </td>
                  <td className="tl">
                    <button
                      type="button"
                      onClick={() => post({ action: "delete", id: r.id })}
                      className="text-[10px] text-[var(--ink-3)] hover:text-[var(--down)]"
                    >
                      delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
