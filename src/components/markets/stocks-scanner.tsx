"use client";

import { useState } from "react";
import usePoll from "@/lib/use-poll";
import { fmtNum, fmtPctPoints } from "@/lib/format";

type Row = {
  symbol: string;
  last: number | null;
  returns: Record<string, number | null>;
  pe: number;
  netDebt: number;
  premium: number;
  freeCashFlow: number;
  evEbitda: number;
  beta: number;
  dividendYield: number;
  aumFlowPct: number;
};

export function StocksScanner() {
  const [sort, setSort] = useState("pe");
  const [order, setOrder] = useState<"asc" | "desc">("asc");

  const [peMin, setPeMin] = useState<string>("");
  const [peMax, setPeMax] = useState<string>("");
  const [betaMin, setBetaMin] = useState<string>("");
  const [betaMax, setBetaMax] = useState<string>("");
  const [aumMin, setAumMin] = useState<string>("");
  const [aumMax, setAumMax] = useState<string>("");
  const [ndMin, setNdMin] = useState<string>("");
  const [ndMax, setNdMax] = useState<string>("");

  // usePoll keeps the previous rows on screen while refreshing, so the table
  // never blanks out between ticks.
  const { data, loading } = usePoll<{ rows: Row[] }>(
    `/api/scan?type=stocks&sort=${sort}&order=${order}&limit=200`,
  );
  const rows = data?.rows ?? [];

  const filtered = rows.filter((r) => {
    const pe = Number(r.pe);
    const beta = Number(r.beta);
    const aum = Number(r.aumFlowPct);
    const nd = Number(r.netDebt);
    if (peMin && pe < Number(peMin)) return false;
    if (peMax && pe > Number(peMax)) return false;
    if (betaMin && beta < Number(betaMin)) return false;
    if (betaMax && beta > Number(betaMax)) return false;
    if (aumMin && aum < Number(aumMin)) return false;
    if (aumMax && aum > Number(aumMax)) return false;
    if (ndMin && nd < Number(ndMin)) return false;
    if (ndMax && nd > Number(ndMax)) return false;
    return true;
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs">Sort</label>
        <select className="text-xs" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="pe">P/E</option>
          <option value="netDebt">Net Debt</option>
          <option value="freeCashFlow">Free Cash Flow</option>
          <option value="evEbitda">EV/EBITDA</option>
          <option value="beta">Beta</option>
          <option value="dividendYield">Dividend Yield</option>
          <option value="aumFlowPct">AUM Flow %</option>
        </select>
        <button className="text-xs" onClick={() => setOrder((o) => (o === "asc" ? "desc" : "asc"))}>
          {order === "asc" ? "Asc" : "Desc"}
        </button>

        <div className="ml-2 flex items-center gap-1 text-xs">
          <div className="text-[11px]">PE</div>
          <input className="w-12 text-xs" placeholder="min" value={peMin} onChange={(e) => setPeMin(e.target.value)} />
          <input className="w-12 text-xs" placeholder="max" value={peMax} onChange={(e) => setPeMax(e.target.value)} />
        </div>

        <div className="ml-2 flex items-center gap-1 text-xs">
          <div className="text-[11px]">Beta</div>
          <input className="w-12 text-xs" placeholder="min" value={betaMin} onChange={(e) => setBetaMin(e.target.value)} />
          <input className="w-12 text-xs" placeholder="max" value={betaMax} onChange={(e) => setBetaMax(e.target.value)} />
        </div>

        <div className="ml-2 flex items-center gap-1 text-xs">
          <div className="text-[11px]">NetDebt</div>
          <input className="w-20 text-xs" placeholder="min" value={ndMin} onChange={(e) => setNdMin(e.target.value)} />
          <input className="w-20 text-xs" placeholder="max" value={ndMax} onChange={(e) => setNdMax(e.target.value)} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="grid-table text-xs">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Last</th>
              <th>P/E</th>
              <th>NetDebt</th>
              <th>FCF</th>
              <th>EV/EBITDA</th>
              <th>Beta</th>
              <th>Div%</th>
              <th>AUM%</th>
              <th>1M</th>
              <th>3M</th>
              <th>6M</th>
              <th>1Y</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={13} className="text-center py-4 text-[11px]">
                  loading…
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.symbol}>
                  <td className="font-mono">{r.symbol}</td>
                  <td className="tnum">{r.last ? fmtNum(r.last, 2) : "—"}</td>
                  <td className="tnum">{r.pe.toFixed(2)}</td>
                  <td className="tnum">{r.netDebt.toLocaleString()}</td>
                  <td className="tnum">{r.freeCashFlow.toLocaleString()}</td>
                  <td className="tnum">{r.evEbitda.toFixed(2)}</td>
                  <td className="tnum">{r.beta.toFixed(2)}</td>
                  <td className="tnum">{r.dividendYield.toFixed(2)}%</td>
                  <td className="tnum">{fmtPctPoints(r.aumFlowPct)}</td>
                  <td className="tnum">{r.returns["1M"] ? fmtPctPoints(r.returns["1M"]) : "—"}</td>
                  <td className="tnum">{r.returns["3M"] ? fmtPctPoints(r.returns["3M"]) : "—"}</td>
                  <td className="tnum">{r.returns["6M"] ? fmtPctPoints(r.returns["6M"]) : "—"}</td>
                  <td className="tnum">{r.returns["1Y"] ? fmtPctPoints(r.returns["1Y"]) : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
