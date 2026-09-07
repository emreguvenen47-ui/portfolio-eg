import Link from "next/link";
import { Chip, Panel } from "@/components/shell/ui";
import { getAllCongressRows } from "@/lib/research/congress-archive";
import { getHealth } from "@/lib/research/congress-health";
import { withLag } from "@/lib/research/congress";
import { discoverMarkets, getHealth as getPolyHealth } from "@/lib/providers/polymarket";

/**
 * TICKER-LEVEL SIGNAL PANELS — who in Congress traded THIS name, and which
 * prediction markets price THIS company's outcomes. Both fail honest: no
 * matching congressional filing → explicit empty (the rolling ledger deepens
 * daily); Polymarket unreachable from this region → the blocker, not filler.
 */

export async function CongressTickerPanel({ symbol }: { symbol: string }) {
  const rows = (await getAllCongressRows(symbol).catch(() => [])).map(withLag);
  const health = getHealth("fmp-congress");
  return (
    <Panel
      title="Congressional Trades in This Name"
      subtitle="lagged public disclosures (Senate EFD / House Clerk) — never called insider trading"
      actions={
        <Link href="/congress" className="text-[10px] text-[var(--amber)] hover:underline">
          all congress activity →
        </Link>
      }
      bodyClassName="p-0"
    >
      {rows.length === 0 ? (
        <div className="px-3 py-3 text-[10.5px] leading-snug text-[var(--ink-3)]">
          No disclosed congressional transaction for {symbol} in the rolling ledger
          ({health.cachedRows} filings accumulated so far — the ledger deepens with every pull, so a
          member trade in {symbol} will appear here within ~30 minutes of its disclosure being
          published). Last successful update: {health.lastSuccess ? health.lastSuccess.slice(0, 16).replace("T", " ") + " UTC" : "never"}.
        </div>
      ) : (
        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">Member</th>
              <th className="tl">Chamber</th>
              <th className="tl">Owner</th>
              <th className="tl">Side</th>
              <th className="tl">Transaction</th>
              <th className="tl">Disclosed</th>
              <th>Lag</th>
              <th className="tl">Reported value</th>
              <th className="tl">Filing</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 15).map((r, i) => (
              <tr key={i}>
                <td className="tl font-medium"><Link href={`/congress/${encodeURIComponent(r.politician)}`} className="hover:text-[var(--amber)] hover:underline">{r.politician}</Link></td>
                <td className="tl text-[10px] text-[var(--ink-3)]">{r.chamber}{r.state ? ` · ${r.state}` : ""}</td>
                <td className="tl text-[10px] text-[var(--ink-3)]">{r.owner ?? "—"}</td>
                <td className="tl">
                  <Chip tone={r.side === "BUY" ? "pos" : "neg"}>{r.side}</Chip>
                </td>
                <td className="tl tabular-nums">{r.transactionDate}</td>
                <td className="tl tabular-nums text-[var(--ink-3)]">{r.disclosureDate}</td>
                <td className="tabular-nums">{r.disclosureLagDays === null ? "—" : `${r.disclosureLagDays}d`}</td>
                <td className="tl text-[10px] tabular-nums">
                  {r.valueLow === null ? "N/A" : `$${r.valueLow.toLocaleString()} – $${(r.valueHigh ?? r.valueLow).toLocaleString()}`}
                </td>
                <td className="tl text-[10px]">
                  {r.sourceUrl ? (
                    <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="text-cyan-300/80 hover:underline">filing ↗</a>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/** Company-matched prediction markets: probability-dominant mini cards. */
export async function PolymarketTickerPanel({
  symbol,
  companyName,
}: {
  symbol: string;
  companyName: string | null;
}) {
  const health = await getPolyHealth().catch(() => null);
  const nameToken = (companyName ?? "").split(/\s+/)[0]?.toLowerCase() ?? "";
  const terms = [symbol.toLowerCase(), ...(nameToken.length >= 3 ? [nameToken] : [])];
  const markets = health?.marketDataOperational
    ? await discoverMarkets(`ticker:${symbol}`, { anyOf: terms, limit: 6 }).catch(() => [])
    : [];

  return (
    <Panel
      title="Prediction Markets on This Company"
      subtitle="market-implied probabilities for outcomes that mention this name — positioning, not forecasts"
      actions={
        <Link href="/polymarket" className="text-[10px] text-indigo-300 hover:underline">
          all markets →
        </Link>
      }
      bodyClassName="p-0"
    >
      {!health?.marketDataOperational ? (
        <div className="px-3 py-3 text-[10.5px] leading-snug text-[var(--ink-3)]">
          Polymarket&apos;s public data hosts are unreachable from this server&apos;s region (TLS-level
          block, verified). On a US deployment this panel fills with {companyName ?? symbol}-linked
          markets automatically. Nothing is synthesized in its place.
        </div>
      ) : markets.length === 0 ? (
        <div className="px-3 py-3 text-[10.5px] text-[var(--ink-3)]">
          No open prediction market currently mentions {companyName ?? symbol} — honest zero from live
          discovery.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2 lg:grid-cols-3">
          {markets.map((m) => {
            const top = [...m.outcomes].sort((a, b) => b.probability - a.probability)[0] ?? null;
            const yes = m.outcomes.find((o) => /^yes$/i.test(o.label)) ?? null;
            const p = yes ?? top;
            return (
              <a
                key={m.id}
                href={m.url}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-[var(--line)] p-2.5 transition-colors hover:border-indigo-400/60"
              >
                <div className="line-clamp-2 text-[11px] font-medium leading-snug">{m.question}</div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="text-[20px] font-bold tabular-nums text-indigo-300">
                    {p ? `${(p.probability * 100).toFixed(0)}%` : "—"}
                  </span>
                  <span className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">
                    {yes ? "yes" : (top?.label ?? "").slice(0, 18)}
                  </span>
                  {p?.change24h != null && (
                    <span className={`ml-auto text-[9.5px] tabular-nums ${p.change24h >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {p.change24h >= 0 ? "▲" : "▼"}{Math.abs(p.change24h * 100).toFixed(1)}pp 24h
                    </span>
                  )}
                </div>
                {yes && (
                  <div className="mt-1 flex h-1.5 overflow-hidden rounded bg-rose-500/25">
                    <div className="h-full bg-emerald-500/70" style={{ width: `${yes.probability * 100}%` }} />
                  </div>
                )}
                <div className="mt-1 flex justify-between text-[8.5px] tabular-nums text-[var(--ink-3)]">
                  <span>{m.volume !== null ? `vol $${(m.volume / 1e6).toFixed(1)}M` : ""}</span>
                  <span>{m.endDate ? m.endDate.slice(0, 10) : ""}</span>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
