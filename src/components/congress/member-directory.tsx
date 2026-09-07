"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

/**
 * FULL MEMBER DIRECTORY — every politician who has at least one disclosure
 * in the ledger, searchable. The "Best Performing Members" table only shows
 * the top-ranked with enough scored buys; this directory is how you find
 * ANYONE who has filed, regardless of ranking eligibility.
 */

interface MemberRow {
  politician: string;
  chamber: string;
  state: string | null;
  filings: number;
  buys: number;
  sells: number;
  lastFiling: string;
}

export function MemberDirectory({ members, totalSeats }: { members: MemberRow[]; totalSeats: number }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return members;
    return members.filter((m) => m.politician.toLowerCase().includes(needle) || (m.state ?? "").toLowerCase() === needle);
  }, [members, q]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or state (e.g. CA)…"
          className="w-64 rounded border border-[var(--line)] bg-transparent px-2 py-1 text-[11px] outline-none focus:border-[var(--amber)]"
        />
        <span className="text-[9.5px] text-[var(--ink-3)]">
          {members.length} of {totalSeats} seats have ≥1 disclosed trade in this dataset — many members hold
          only index funds or blind trusts and are expected to show zero filings, not a data gap.
        </span>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        <table className="grid-table">
          <thead className="sticky top-0 bg-[var(--panel,#0a0a0a)]">
            <tr>
              <th className="tl">Member</th>
              <th className="tl">Chamber</th>
              <th className="tl">State</th>
              <th>Filings</th>
              <th>Buys</th>
              <th>Sells</th>
              <th className="tl">Last filing</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 300).map((m) => (
              <tr key={m.politician}>
                <td className="tl">
                  <Link href={`/congress/${encodeURIComponent(m.politician)}`} className="font-medium hover:text-[var(--amber)] hover:underline">
                    {m.politician}
                  </Link>
                </td>
                <td className="tl text-[10px] text-[var(--ink-3)]">{m.chamber}</td>
                <td className="tl text-[10px] text-[var(--ink-3)]">{m.state ?? "—"}</td>
                <td className="tabular-nums">{m.filings}</td>
                <td className="tabular-nums text-emerald-400">{m.buys}</td>
                <td className="tabular-nums text-rose-400">{m.sells}</td>
                <td className="tl tabular-nums text-[10px] text-[var(--ink-3)]">{m.lastFiling}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="px-3 py-4 text-[10.5px] text-[var(--ink-3)]">No member matches &quot;{q}&quot; in the ledger.</div>
        )}
      </div>
    </div>
  );
}
