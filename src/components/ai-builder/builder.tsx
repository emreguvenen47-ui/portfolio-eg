"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Chip, Empty, Note, Panel } from "@/components/shell/ui";
import { cn } from "@/lib/utils";
import { fmtPctPoints, fmtUsd, signClass } from "@/lib/format";
import type {
  BuiltPortfolio,
  ComparisonRow,
  InvestorProfile,
  RiskExplanation,
} from "@/lib/ai/portfolio-model";

interface BuildResult {
  investorProfile: InvestorProfile;
  risk: RiskExplanation;
  built: BuiltPortfolio;
  comparison: ComparisonRow[] | null;
  generatedAt: string;
}

interface Saved {
  id: string;
  name: string;
  createdAt: string;
}

const HORIZONS = ["<2y", "2-5y", "5-10y", "10y+"] as const;
const RISKS = ["Conservative", "Moderate", "Growth", "Aggressive"] as const;
const LIQUIDITY = ["Low", "Medium", "High"] as const;
const CURRENCIES = ["USD", "TRY", "EUR"] as const;
const PREFERENCES = [
  "US",
  "Europe",
  "Emerging Markets",
  "Turkey",
  "Technology",
  "AI",
  "Industrials",
  "Gold",
  "Commodities",
  "Income",
  "Low Volatility",
] as const;

const ROLE_TONE: Record<string, "pos" | "neg" | "warn" | "info" | "amber" | "neutral"> = {
  CORE: "amber",
  GROWTH: "pos",
  DEFENSIVE: "info",
  INCOME: "info",
  HEDGE: "warn",
  DIVERSIFIER: "neutral",
  LIQUIDITY: "neutral",
};

const RISK_TONE = { LOW: "pos", MEDIUM: "warn", HIGH: "neg" } as const;

function Toggle<T extends string>({
  options,
  value,
  onChange,
  allowClear = true,
}: {
  options: readonly T[];
  value: T | null;
  onChange: (v: T | null) => void;
  allowClear?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(allowClear && value === o ? null : o)}
          className={cn(
            "rounded-sm border px-2 py-1 text-[10.5px] transition-colors",
            value === o
              ? "border-[var(--amber)] bg-[rgba(255,160,40,0.12)] text-[var(--amber)]"
              : "border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--ink-3)]",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
        {label}
      </div>
      {children}
    </div>
  );
}

/** Horizontal weight bar, sized to the position's share of the book. */
function WeightBar({ weight }: { weight: number }) {
  return (
    <div className="h-1.5 w-full bg-[var(--panel-2)]">
      <div
        className="h-full bg-[var(--amber)]"
        style={{ width: `${Math.min(100, weight * 100 * 2.5)}%` }}
      />
    </div>
  );
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1">
      <span className="w-[130px] shrink-0 text-[10.5px] text-[var(--ink-2)]">{label}</span>
      <div className="h-1.5 flex-1 bg-[var(--panel-2)]">
        <div
          className={cn(
            "h-full",
            value >= 75 ? "bg-emerald-500" : value >= 50 ? "bg-amber-500" : "bg-rose-500",
          )}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-[26px] shrink-0 text-right text-[10.5px] tabular-nums">{value}</span>
    </div>
  );
}

export function AiBuilder({ aiConfigured }: { aiConfigured: boolean }) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("250000");
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>("USD");
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number] | null>(null);
  const [risk, setRisk] = useState<(typeof RISKS)[number] | null>(null);
  const [liquidity, setLiquidity] = useState<(typeof LIQUIDITY)[number] | null>(null);
  const [prefs, setPrefs] = useState<string[]>([]);
  const [compareOn, setCompareOn] = useState(true);

  const [result, setResult] = useState<BuildResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const togglePref = (p: string) =>
    setPrefs((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  const build = async () => {
    setLoading(true);
    setError(null);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/ai/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description,
          amount: Number(amount) || 100_000,
          currency,
          horizon: horizon ?? undefined,
          risk: risk ?? undefined,
          liquidity: liquidity ?? undefined,
          preferences: prefs,
          compareWithMine: compareOn,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setResult(json as BuildResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Build failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshSaved = async () => {
    const res = await fetch("/api/ai/portfolios");
    const json = await res.json();
    setSaved(json.portfolios ?? []);
  };

  const save = async () => {
    if (!result) return;
    const name =
      window.prompt("Name this portfolio", result.investorProfile.investorType) ?? "";
    if (!name.trim()) return;
    const res = await fetch("/api/ai/portfolios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "save",
        name: name.trim(),
        profile: result.investorProfile,
        risk: result.risk,
        built: result.built,
      }),
    });
    setSaveMsg(res.ok ? `Saved as "${name.trim()}"` : "Save failed");
    await refreshSaved();
  };

  const mutate = async (action: "rename" | "duplicate" | "delete", id: string) => {
    const body: Record<string, unknown> = { action, id };
    if (action === "rename") {
      const name = window.prompt("New name") ?? "";
      if (!name.trim()) return;
      body.name = name.trim();
    }
    if (action === "delete" && !window.confirm("Delete this saved portfolio?")) return;
    await fetch("/api/ai/portfolios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await refreshSaved();
  };

  return (
    <div className="flex flex-col gap-3">
      <Note tone="warn">
        <span>
          <strong>Modelling tool, not advice.</strong> Output is a hypothetical example generated
          from your description. It is not personalised financial advice, carries no
          suitability assessment, and requires your own review before any action.
        </span>
      </Note>

      {!aiConfigured && (
        <Note tone="info">
          <span>
            Add <code className="text-[var(--amber)]">ANTHROPIC_API_KEY</code> to{" "}
            <code className="text-[var(--amber)]">.env.local</code> and restart to enable the
            builder.
          </span>
        </Note>
      )}

      {/* ------------------------------------------------------------ input */}
      <Panel title="Investor Brief" bodyClassName="p-3">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          placeholder="Describe your investment goals, risk tolerance, time horizon and preferences..."
          className="w-full resize-y rounded-sm border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[12px] leading-relaxed outline-none transition-colors placeholder:text-[var(--ink-3)] focus:border-[var(--amber)]"
        />

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Investment amount">
            <div className="flex gap-1">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                className="w-full rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[11px] tabular-nums outline-none focus:border-[var(--amber)]"
              />
              <Toggle
                options={CURRENCIES}
                value={currency}
                onChange={(v) => v && setCurrency(v)}
                allowClear={false}
              />
            </div>
          </Field>
          <Field label="Time horizon">
            <Toggle options={HORIZONS} value={horizon} onChange={setHorizon} />
          </Field>
          <Field label="Risk">
            <Toggle options={RISKS} value={risk} onChange={setRisk} />
          </Field>
          <Field label="Liquidity need">
            <Toggle options={LIQUIDITY} value={liquidity} onChange={setLiquidity} />
          </Field>
        </div>

        <div className="mt-3">
          <Field label="Preferences (optional)">
            <div className="flex flex-wrap gap-1">
              {PREFERENCES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePref(p)}
                  className={cn(
                    "rounded-sm border px-2 py-1 text-[10.5px] transition-colors",
                    prefs.includes(p)
                      ? "border-[var(--amber)] bg-[rgba(255,160,40,0.12)] text-[var(--amber)]"
                      : "border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--ink-3)]",
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={build}
            disabled={loading || !aiConfigured}
            className="rounded-sm border border-[var(--amber)] bg-[rgba(255,160,40,0.12)] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--amber)] transition-colors hover:bg-[rgba(255,160,40,0.2)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Sparkles className="mr-1.5 inline h-3 w-3" strokeWidth={2} />
            {loading ? "Building…" : "Build portfolio"}
          </button>
          <label className="flex items-center gap-1.5 text-[10.5px] text-[var(--ink-2)]">
            <input
              type="checkbox"
              checked={compareOn}
              onChange={(e) => setCompareOn(e.target.checked)}
              className="accent-[var(--amber)]"
            />
            Compare with my portfolio
          </label>
          <span className="text-[10px] text-[var(--ink-3)]">
            Nothing is sent to the model until you press Build.
          </span>
        </div>

        {error && <p className="mt-2 text-[10.5px] text-[var(--down)]">{error}</p>}
      </Panel>

      {!result && !loading && (
        <Panel title="Output">
          <Empty>
            Describe your goals above and press Build. The allocation, dollar amounts, score and
            scenarios are all computed here from the model&apos;s picks.
          </Empty>
        </Panel>
      )}

      {result && <BuildOutput result={result} onSave={save} saveMsg={saveMsg} />}

      {/* --------------------------------------------------- saved library */}
      <Panel
        title="Saved Portfolios"
        subtitle="Stored separately — these never replace your real book"
        actions={
          <button
            type="button"
            onClick={refreshSaved}
            className="text-[10px] text-[var(--ink-3)] hover:text-[var(--amber)]"
          >
            refresh
          </button>
        }
        bodyClassName="p-0"
      >
        {saved.length === 0 ? (
          <Empty>No saved portfolios yet.</Empty>
        ) : (
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Name</th>
                <th className="tl">Created</th>
                <th className="tl">Actions</th>
              </tr>
            </thead>
            <tbody>
              {saved.map((s) => (
                <tr key={s.id}>
                  <td className="tl font-semibold">
                    <Link href={`/ai-portfolios/${s.id}`} className="hover:text-[var(--amber)]">
                      {s.name}
                    </Link>
                  </td>
                  <td className="tl text-[10px] text-[var(--ink-3)]">
                    {new Date(s.createdAt).toLocaleString("en-GB")}
                  </td>
                  <td className="tl">
                    <div className="flex gap-2 text-[10px]">
                      <Link
                        href={`/ai-portfolios/${s.id}`}
                        className="text-[var(--ink-3)] hover:text-[var(--amber)]"
                      >
                        open
                      </Link>
                      <Link
                        href={`/performance?portfolio=${s.id}`}
                        className="text-[var(--ink-3)] hover:text-[var(--amber)]"
                      >
                        performance
                      </Link>
                      <button
                        type="button"
                        onClick={() => mutate("rename", s.id)}
                        className="text-[var(--ink-3)] hover:text-[var(--amber)]"
                      >
                        rename
                      </button>
                      <button
                        type="button"
                        onClick={() => mutate("duplicate", s.id)}
                        className="text-[var(--ink-3)] hover:text-[var(--amber)]"
                      >
                        duplicate
                      </button>
                      <button
                        type="button"
                        onClick={() => mutate("delete", s.id)}
                        className="text-[var(--ink-3)] hover:text-[var(--down)]"
                      >
                        delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------- output

function BuildOutput({
  result,
  onSave,
  saveMsg,
}: {
  result: BuildResult;
  onSave: () => void;
  saveMsg: string | null;
}) {
  const { investorProfile: p, risk, built, comparison } = result;
  const fmtMoney = (v: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: built.currency,
      maximumFractionDigits: 0,
    }).format(v);

  return (
    <div className="flex flex-col gap-3">
      {/* -------------------------------------------------- investor profile */}
      <Panel
        title="Investor Profile"
        subtitle="Derived from your description — review before relying on it"
        bodyClassName="p-0"
      >
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Investor Type", p.investorType],
            ["Risk Score", `${p.riskScore} / 100`],
            ["Time Horizon", p.timeHorizon],
            ["Liquidity", p.liquidityRequirement],
            ["Equity Range", p.suggestedEquityRange],
            ["Cash Range", p.suggestedCashRange],
          ].map(([label, value]) => (
            <div key={label} className="px-3 py-2">
              <div className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                {label}
              </div>
              <div className="mt-0.5 text-[12px] font-semibold">{value}</div>
            </div>
          ))}
        </div>
        <div className="border-t border-[var(--line)] px-3 py-2">
          <div className="text-[10.5px]">
            <span className="text-[var(--ink-3)]">Primary objective: </span>
            {p.primaryObjective}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-[var(--ink-3)]">Key concerns:</span>
            {p.keyConcerns.map((c) => (
              <Chip key={c} tone="warn">
                {c}
              </Chip>
            ))}
          </div>
          <div className="mt-1 text-[10px] text-[var(--ink-3)]">
            Suggested defensive assets: {p.suggestedDefensiveRange}
          </div>
        </div>
      </Panel>

      {/* ------------------------------------------------------- allocation */}
      <Panel
        title="Modelled Allocation"
        subtitle={`${built.positions.length} positions · ${fmtMoney(built.amount)}${
          built.normalisedFrom
            ? ` · weights normalised from ${built.normalisedFrom.toFixed(1)} to 100.0`
            : " · weights sum to 100.0"
        }`}
        actions={
          <button
            type="button"
            onClick={onSave}
            className="rounded-sm border border-[var(--line)] px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--ink-2)] hover:border-[var(--amber)] hover:text-[var(--amber)]"
          >
            Save portfolio
          </button>
        }
        bodyClassName="p-0"
      >
        {saveMsg && (
          <div className="border-b border-[var(--line)] px-3 py-1 text-[10px] text-[var(--up)]">
            {saveMsg}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Ticker</th>
                <th className="tl">Asset</th>
                <th>Weight</th>
                <th className="tl w-[110px]" />
                <th>Allocation</th>
                <th className="tl">Class</th>
                <th className="tl">Region</th>
                <th className="tl">Risk</th>
                <th className="tl">Role</th>
                <th className="tl">Why selected</th>
              </tr>
            </thead>
            <tbody>
              {built.positions.map((pos) => (
                <tr key={pos.ticker}>
                  <td className="tl font-semibold">{pos.ticker}</td>
                  <td className="tl text-[10.5px] text-[var(--ink-2)]">{pos.name}</td>
                  <td className="tabular-nums">{(pos.weight * 100).toFixed(1)}%</td>
                  <td>
                    <WeightBar weight={pos.weight} />
                  </td>
                  <td className="tabular-nums">{fmtMoney(pos.dollars)}</td>
                  <td className="tl text-[10.5px]">{pos.assetClass}</td>
                  <td className="tl text-[10.5px]">{pos.region}</td>
                  <td className="tl">
                    <Chip tone={RISK_TONE[pos.riskLevel]}>{pos.riskLevel}</Chip>
                  </td>
                  <td className="tl">
                    <Chip tone={ROLE_TONE[pos.role] ?? "neutral"}>{pos.role}</Chip>
                  </td>
                  <td className="tl max-w-[280px] text-[10px] leading-snug text-[var(--ink-3)]">
                    {pos.reason}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="tl font-semibold">TOTAL</td>
                <td />
                <td className="tabular-nums font-semibold">
                  {(built.positions.reduce((s, x) => s + x.weight, 0) * 100).toFixed(1)}%
                </td>
                <td />
                <td className="tabular-nums font-semibold">{fmtMoney(built.amount)}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>

      {/* --------------------------------------------------- score + risk */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[340px_1fr]">
        <Panel
          title="Internal Portfolio Quality Score"
          subtitle={`${built.score.total} / 100 · house heuristic`}
          bodyClassName="p-0"
        >
          <div className="py-1">
            <ScoreRow label="Diversification" value={built.score.diversification} />
            <ScoreRow label="Risk Balance" value={built.score.riskBalance} />
            <ScoreRow label="Liquidity" value={built.score.liquidity} />
            <ScoreRow label="Concentration" value={built.score.concentration} />
            <ScoreRow label="Currency Diversification" value={built.score.currency} />
            <ScoreRow label="Theme Diversification" value={built.score.theme} />
          </div>
          <div
            className="border-t border-[var(--line)] px-3 py-2 text-[10px] leading-snug text-[var(--ink-3)]"
            title="Diversification: mean of effective-position count, distinct asset classes and distinct regions. Risk balance: distance of growth assets from a 70% reference. Liquidity: weighted asset-class liquidity. Concentration: size of the largest single position. Currency: share outside the US. Theme: number of distinct roles."
          >
            Not an industry-standard measure. Six equally-weighted sub-scores, each a clamped
            linear grade between a good and a bad level — hover for the definitions.
          </div>
        </Panel>

        <Panel title="Risk Assessment" bodyClassName="p-0">
          <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3">
            {[
              ["Expected Risk", risk.expectedRisk],
              ["Largest Risk", risk.largestRisk],
              ["Drawdown Driver", risk.mainDrawdownDriver],
              ["Inflation Protection", risk.inflationProtection],
              ["Currency Diversification", risk.currencyDiversification],
              ["Liquidity", risk.liquidity],
            ].map(([label, value]) => (
              <div key={label} className="px-3 py-2">
                <div className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                  {label}
                </div>
                <div className="mt-0.5 text-[11px] font-semibold leading-snug">{value}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 divide-y divide-[var(--line)] md:grid-cols-3 md:divide-x md:divide-y-0">
            {(
              [
                { label: "Top risks", items: risk.topRisks, tone: "neg" },
                { label: "Top strengths", items: risk.topStrengths, tone: "pos" },
                { label: "Would invalidate this", items: risk.invalidations, tone: "warn" },
              ] as const
            ).map(({ label, items, tone }) => (
              <div key={label} className="px-3 py-2">
                <div className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                  {label}
                </div>
                <ul className="mt-1 space-y-1">
                  {items.map((r) => (
                    <li key={r} className="flex gap-1.5 text-[10.5px] leading-snug">
                      <Chip tone={tone}>·</Chip>
                      <span className="flex-1">{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="border-t border-[var(--line)] px-3 py-2 text-[10px] text-[var(--ink-3)]">
            Model-implied annual volatility {(built.impliedVolatility * 100).toFixed(1)}% — from
            asset-class weights at an assumed 0.5 average correlation, not from price history.
          </div>
        </Panel>
      </div>

      {/* --------------------------------------------------------- scenarios */}
      <Panel
        title="Scenario Analysis"
        subtitle="Rule-based shocks applied to the allocation — arithmetic, not a model estimate"
        bodyClassName="p-0"
      >
        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">Scenario</th>
              <th className="tl">Driver</th>
              <th>Impact</th>
              <th>Value change</th>
              <th className="tl w-[160px]" />
            </tr>
          </thead>
          <tbody>
            {built.scenarios.map((s) => (
              <tr key={s.id}>
                <td className="tl font-semibold">{s.name}</td>
                <td className="tl text-[10px] text-[var(--ink-3)]">{s.driver}</td>
                <td className={cn("tabular-nums", signClass(s.impactPct))}>
                  {fmtPctPoints(s.impactPct)}
                </td>
                <td className={cn("tabular-nums", signClass(s.dollars))}>
                  {fmtMoney(s.dollars)}
                </td>
                <td>
                  <div className="h-1.5 w-full bg-[var(--panel-2)]">
                    <div
                      className={s.impactPct >= 0 ? "h-full bg-emerald-500" : "h-full bg-rose-500"}
                      style={{ width: `${Math.min(100, Math.abs(s.impactPct) * 2.5)}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* -------------------------------------------------------- comparison */}
      {comparison && (
        <Panel
          title="Compare With My Portfolio"
          subtitle="Same exposure buckets on both sides. Gaps above 10pp are flagged."
          bodyClassName="p-0"
        >
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Measure</th>
                <th>AI portfolio</th>
                <th>My portfolio</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((row) => {
                const major = row.format === "pct" ? row.gap >= 10 : row.gap >= 2;
                const diff = row.ai - row.mine;
                return (
                  <tr key={row.label}>
                    <td className="tl">
                      {row.label}
                      {major && (
                        <span className="ml-2">
                          <Chip tone="warn">major</Chip>
                        </span>
                      )}
                    </td>
                    <td className="tabular-nums">
                      {row.format === "pct" ? `${row.ai.toFixed(1)}%` : row.ai.toFixed(1)}
                    </td>
                    <td className="tabular-nums">
                      {row.format === "pct" ? `${row.mine.toFixed(1)}%` : row.mine.toFixed(1)}
                    </td>
                    <td className={cn("tabular-nums", signClass(diff))}>
                      {diff >= 0 ? "+" : ""}
                      {diff.toFixed(1)}
                      {row.format === "pct" ? "pp" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
