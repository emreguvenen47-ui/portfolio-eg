import { getContext } from "@/lib/server/context";
import { Chip, Note, Panel } from "@/components/shell/ui";
import { SettingsForm } from "@/components/settings/settings-form";
import { ExcelImport } from "@/components/settings/excel-import";
import { getProviderHealth, resolveProvider } from "@/lib/providers";
import { budgetFor, remainingToday, spentToday } from "@/lib/providers/budget";
import { isSupabaseConfigured } from "@/lib/server/supabase";
import { fmtPct, fmtTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await getContext();
  const { chain, twelveDataKeyPresent, finnhubKeyPresent } = resolveProvider();
  const health = getProviderHealth();
  const available = chain.map((p) => p.name);
  const tdBudget = budgetFor("twelvedata");
  const tdSpent = spentToday("twelvedata");
  const tdRemaining = remainingToday("twelvedata");
  const supabase = isSupabaseConfigured();

  return (
    <div className="flex flex-col gap-3">
      <Panel title="Data Sources" bodyClassName="p-0">
        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">Service</th>
              <th className="tl">Status</th>
              <th className="tl">Environment variable</th>
              <th className="tl">Effect when missing</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="tl">Finnhub (primary prices + news)</td>
              <td className="tl">
                <Chip
                  tone={
                    !finnhubKeyPresent
                      ? "warn"
                      : available.includes("finnhub")
                        ? "pos"
                        : "warn"
                  }
                >
                  {!finnhubKeyPresent
                    ? "NOT CONFIGURED"
                    : available.includes("finnhub")
                      ? "CONFIGURED"
                      : "RATE LIMITED"}
                </Chip>
              </td>
              <td className="tl">
                <code className="text-[10px] text-[var(--amber)]">FINNHUB_API_KEY</code>
              </td>
              <td className="tl text-[10.5px] text-[var(--ink-3)]">
                Free key, 60 calls/minute and no daily cap. Prices US equities and ETFs, and is
                the only source of per-holding company news. Indices, BIST, FX and history stay
                on Yahoo.
              </td>
            </tr>
            <tr>
              <td className="tl">Yahoo Finance (indices, FX, history)</td>
              <td className="tl">
                <Chip tone={available.includes("yahoo") ? "pos" : "warn"}>
                  {available.includes("yahoo") ? "AVAILABLE" : "RATE LIMITED"}
                </Chip>
              </td>
              <td className="tl text-[10px] text-[var(--ink-3)]">none — no API key</td>
              <td className="tl text-[10.5px] text-[var(--ink-3)]">
                Default source. Quotes and history are fetched in one batched request each.
              </td>
            </tr>
            <tr>
              <td className="tl">Twelve Data (fallback prices)</td>
              <td className="tl">
                <Chip
                  tone={
                    !twelveDataKeyPresent
                      ? "warn"
                      : available.includes("twelvedata")
                        ? "pos"
                        : "warn"
                  }
                >
                  {!twelveDataKeyPresent
                    ? "NOT CONFIGURED"
                    : available.includes("twelvedata")
                      ? "CONFIGURED"
                      : "RATE LIMITED"}
                </Chip>
              </td>
              <td className="tl">
                <code className="text-[10px] text-[var(--amber)]">TWELVE_DATA_API_KEY</code>
              </td>
              <td className="tl text-[10.5px] text-[var(--ink-3)]">
                Last resort. Free tier is 800 credits/day at one credit per symbol, so spend is
                capped at{" "}
                <strong className="text-[var(--ink-2)]">
                  {tdSpent}/{tdBudget} credits
                </strong>{" "}
                today ({tdRemaining} left). Raise with{" "}
                <code className="text-[10px] text-[var(--amber)]">TWELVEDATA_DAILY_BUDGET</code>.
              </td>
            </tr>
            <tr>
              <td className="tl">Live feed status</td>
              <td className="tl">
                <Chip tone={health.status === "UNAVAILABLE" ? "warn" : "pos"}>
                  {health.status.replace("_", " ")}
                </Chip>
              </td>
              <td className="tl text-[10px] text-[var(--ink-3)]">
                {health.provider === "none" ? "—" : `served by ${health.provider}`}
              </td>
              <td className="tl text-[10.5px] text-[var(--ink-3)]">
                {health.reason ??
                  "Real data only. When every source fails the last real price is kept and marked STALE; a symbol with no real quote shows UNAVAILABLE — never a generated number."}
              </td>
            </tr>
            <tr>
              <td className="tl">Supabase (persistence)</td>
              <td className="tl">
                <Chip tone={supabase ? "pos" : "warn"}>
                  {supabase ? "CONFIGURED" : "NOT CONFIGURED"}
                </Chip>
              </td>
              <td className="tl">
                <code className="text-[10px] text-[var(--amber)]">
                  NEXT_PUBLIC_SUPABASE_URL
                </code>
                {", "}
                <code className="text-[10px] text-[var(--amber)]">
                  SUPABASE_SERVICE_ROLE_KEY
                </code>
              </td>
              <td className="tl text-[10.5px] text-[var(--ink-3)]">
                Settings and transactions live in process memory and reset on restart.
              </td>
            </tr>
          </tbody>
        </table>
        <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
          API keys are read server-side only. No key is ever prefixed{" "}
          <code>NEXT_PUBLIC_</code>, and the provider modules are marked{" "}
          <code>server-only</code>, so importing one into a client component fails the build
          rather than leaking a secret into the browser bundle.
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <SettingsForm initial={ctx.settings} />

        <div className="flex flex-col gap-3">
          <ExcelImport />

          <Panel title="Loaded Workbook" bodyClassName="p-0">
            <table className="grid-table">
              <tbody>
                <Row label="File" value={ctx.portfolio.meta.sourceFile} />
                <Row label="Title" value={ctx.portfolio.meta.title} />
                <Row label="Positions" value={String(ctx.portfolio.positions.length)} />
                <Row
                  label="Total"
                  value={new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 0,
                  }).format(ctx.portfolio.meta.totalAmount)}
                />
                <Row label="Parsed" value={fmtTime(ctx.portfolio.meta.parsedAt)} />
                <Row
                  label="Weights sum"
                  value={fmtPct(
                    ctx.portfolio.positions.reduce((s, p) => s + p.weight, 0),
                    2,
                  )}
                />
              </tbody>
            </table>
            {ctx.portfolio.meta.warnings.length > 0 && (
              <div className="border-t border-[var(--line)] px-3 py-2">
                {ctx.portfolio.meta.warnings.map((w, i) => (
                  <p key={i} className="text-[10.5px] text-[var(--warn)]">
                    {w}
                  </p>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Scope">
            <ul className="space-y-1 text-[10.5px] leading-relaxed text-[var(--ink-2)]">
              <li>▸ Analytics only. No order entry, routing, staging or brokerage link.</li>
              <li>▸ Market data is read-only and never written back to any venue.</li>
              <li>
                ▸ Stress scenarios are deterministic arithmetic on user-supplied shocks, not
                probabilistic forecasts.
              </li>
              <li>
                ▸ PPF is modelled as a TL accrual translated at USD/TRY — never as an
                exchange-traded fund.
              </li>
              <li>
                ▸ When live data is unavailable the app shows STALE or UNAVAILABLE and says so; it never
                presents generated numbers as live.
              </li>
            </ul>
          </Panel>
        </div>
      </div>

      <Note>
        Changing the workbook on disk and restarting the server re-seeds the entire app —
        weights, amounts, expected returns, volatilities, currencies, categories and rationale
        text all come from Excel, not from code.
      </Note>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="tl w-32 text-[var(--ink-3)]">{label}</td>
      <td className="tl text-[var(--ink)]">{value}</td>
    </tr>
  );
}
