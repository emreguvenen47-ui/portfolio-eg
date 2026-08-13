"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { compactMoney } from "./primitives";
import { OverviewGrid } from "./panels";
import type { FinancialPeriod } from "@/lib/providers/fundamentals";
import type { OverviewSection } from "@/lib/research/statements";

/**
 * The FINANCIALS section: an overview grid plus the three statements and a
 * ratio sheet, laid out as periods across and line items down.
 *
 * Every cell is a filed figure or N/A. Nothing is interpolated across a
 * missing period.
 */

type Tab = "OVERVIEW" | "INCOME" | "CASH FLOW" | "BALANCE SHEET" | "RATIOS";
const TABS: Tab[] = ["OVERVIEW", "INCOME", "CASH FLOW", "BALANCE SHEET", "RATIOS"];

interface Line {
  label: string;
  pick: (p: FinancialPeriod) => number | null;
  format?: "usd" | "num" | "pct" | "x";
  indent?: boolean;
}

const INCOME: Line[] = [
  { label: "Revenue", pick: (p) => p.revenue },
  { label: "Cost of Revenue", pick: (p) => p.costOfRevenue, indent: true },
  { label: "Gross Profit", pick: (p) => p.grossProfit },
  { label: "R&D", pick: (p) => p.rnd, indent: true },
  { label: "SG&A", pick: (p) => p.sga, indent: true },
  { label: "Operating Income", pick: (p) => p.operatingIncome },
  { label: "Pretax Income", pick: (p) => p.pretaxIncome, indent: true },
  { label: "Tax Expense", pick: (p) => p.taxExpense, indent: true },
  { label: "Net Income", pick: (p) => p.netIncome },
  { label: "EPS (diluted)", pick: (p) => p.eps, format: "num" },
  { label: "Diluted Shares", pick: (p) => p.dilutedShares, format: "num" },
];

const CASHFLOW: Line[] = [
  { label: "Operating Cash Flow", pick: (p) => p.operatingCashFlow },
  { label: "Depreciation & Amortisation", pick: (p) => p.depreciation, indent: true },
  { label: "Stock-Based Compensation", pick: (p) => p.stockComp, indent: true },
  { label: "CapEx", pick: (p) => (p.capex === null ? null : -Math.abs(p.capex)), indent: true },
  { label: "Free Cash Flow", pick: (p) => p.freeCashFlow },
  { label: "Dividends Paid", pick: (p) => (p.dividendsPaid === null ? null : -Math.abs(p.dividendsPaid)) },
  { label: "Share Repurchases", pick: (p) => (p.buybacks === null ? null : -Math.abs(p.buybacks)) },
  { label: "Share Issuance", pick: (p) => p.stockIssued },
  { label: "Debt Issued", pick: (p) => p.debtIssued },
  { label: "Debt Repaid", pick: (p) => (p.debtRepaid === null ? null : -Math.abs(p.debtRepaid)) },
];

const BALANCE: Line[] = [
  { label: "Cash & Equivalents", pick: (p) => p.cash },
  { label: "Short-Term Investments", pick: (p) => p.shortTermInvestments, indent: true },
  { label: "Inventory", pick: (p) => p.inventory, indent: true },
  { label: "Current Assets", pick: (p) => p.currentAssets },
  { label: "Total Assets", pick: (p) => p.totalAssets },
  { label: "Current Liabilities", pick: (p) => p.currentLiabilities },
  { label: "Short-Term Debt", pick: (p) => p.shortTermDebt, indent: true },
  { label: "Long-Term Debt", pick: (p) => p.longTermDebt, indent: true },
  { label: "Total Liabilities", pick: (p) => p.totalLiabilities },
  { label: "Shareholders' Equity", pick: (p) => p.equity },
];

const div = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : a / b;

const RATIOS: Line[] = [
  { label: "Gross Margin", pick: (p) => mul(div(p.grossProfit, p.revenue)), format: "pct" },
  { label: "Operating Margin", pick: (p) => mul(div(p.operatingIncome, p.revenue)), format: "pct" },
  { label: "Net Margin", pick: (p) => mul(div(p.netIncome, p.revenue)), format: "pct" },
  { label: "FCF Margin", pick: (p) => mul(div(p.freeCashFlow, p.revenue)), format: "pct" },
  { label: "R&D % of Revenue", pick: (p) => mul(div(p.rnd, p.revenue)), format: "pct" },
  { label: "Effective Tax Rate", pick: (p) => mul(div(p.taxExpense, p.pretaxIncome)), format: "pct" },
  { label: "Current Ratio", pick: (p) => div(p.currentAssets, p.currentLiabilities), format: "x" },
  {
    label: "Debt / Equity",
    pick: (p) =>
      p.equity === null || (p.shortTermDebt === null && p.longTermDebt === null)
        ? null
        : div((p.shortTermDebt ?? 0) + (p.longTermDebt ?? 0), p.equity),
    format: "x",
  },
  { label: "OCF / Net Income", pick: (p) => div(p.operatingCashFlow, p.netIncome), format: "x" },
];

const mul = (v: number | null): number | null => (v === null ? null : v * 100);

const cell = (v: number | null, format: Line["format"], sym: string): string => {
  if (v === null || !Number.isFinite(v)) return "N/A";
  if (format === "pct") return `${v.toFixed(1)}%`;
  if (format === "x") return `${v.toFixed(2)}×`;
  if (format === "num") {
    return Math.abs(v) >= 1e6 ? compactMoney(v, "").trim() : v.toFixed(2);
  }
  return compactMoney(v, sym);
};

export function FinancialsTabs({
  overviewSections,
  quarterly,
  annual,
  sym = "$",
}: {
  overviewSections: OverviewSection[];
  /** Both oldest → newest. Rendered newest-first so the latest column leads. */
  quarterly: FinancialPeriod[];
  annual: FinancialPeriod[];
  /** Reporting-currency symbol; statements are filed in the issuer's currency. */
  sym?: string;
}) {
  const [tab, setTab] = useState<Tab>("OVERVIEW");
  const [freq, setFreq] = useState<"QUARTERLY" | "ANNUAL">("QUARTERLY");

  // Fall back to quarterly when the annual statements did not come through,
  // rather than showing an empty sheet behind an enabled toggle.
  const hasAnnual = annual.length > 0;
  const periods = freq === "ANNUAL" && hasAnnual ? annual : quarterly;
  const cols = [...periods].reverse().slice(0, 8);

  const lines =
    tab === "INCOME" ? INCOME : tab === "CASH FLOW" ? CASHFLOW : tab === "BALANCE SHEET" ? BALANCE : RATIOS;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--line)] px-2 py-1.5">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-sm border px-2 py-0.5 text-[10px] transition-colors",
              tab === t
                ? "border-[var(--amber)] bg-[rgba(255,160,40,0.12)] text-[var(--amber)]"
                : "border-[var(--line)] text-[var(--ink-3)] hover:border-[var(--ink-3)]",
            )}
          >
            {t}
          </button>
        ))}
        {tab !== "OVERVIEW" && (
          <span className="ml-auto flex gap-1">
            {(["QUARTERLY", "ANNUAL"] as const).map((f) => (
              <button
                key={f}
                type="button"
                disabled={f === "ANNUAL" && !hasAnnual}
                onClick={() => setFreq(f)}
                title={f === "ANNUAL" && !hasAnnual ? "No annual statements available" : undefined}
                className={cn(
                  "rounded-sm border px-2 py-0.5 text-[10px] disabled:opacity-40",
                  freq === f
                    ? "border-[var(--ink-3)] text-[var(--ink)]"
                    : "border-[var(--line)] text-[var(--ink-3)]",
                )}
              >
                {f}
              </button>
            ))}
          </span>
        )}
      </div>

      {tab === "OVERVIEW" ? (
        <OverviewGrid sections={overviewSections} sym={sym} />
      ) : cols.length === 0 ? (
        <div className="p-4 text-center text-[11px] text-[var(--ink-3)]">
          No reported statements available.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Line Item</th>
                {cols.map((p) => (
                  <th key={`${p.year}-${p.quarter}`} className="whitespace-nowrap">
                    {p.quarter === 0 ? `FY${p.year}` : `${p.year} Q${p.quarter}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.label}>
                  <td className={cn("tl", l.indent && "pl-5 text-[var(--ink-2)]")}>{l.label}</td>
                  {cols.map((p) => {
                    const v = l.pick(p);
                    return (
                      <td
                        key={`${p.year}-${p.quarter}`}
                        className={cn(
                          "tabular-nums",
                          v === null && "text-[var(--ink-3)]",
                          v !== null && v < 0 && "text-rose-400",
                        )}
                      >
                        {cell(v, l.format, sym)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
