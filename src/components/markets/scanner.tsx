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

export function Scanner() {
  const [sort, setSort] = useState("aumFlowPct");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [peMin, setPeMin] = useState<string>("");
  const [peMax, setPeMax] = useState<string>("");
  const [betaMin, setBetaMin] = useState<string>("");
  const [betaMax, setBetaMax] = useState<string>("");
  const [aumMin, setAumMin] = useState<string>("");
  const [aumMax, setAumMax] = useState<string>("");
  const [ret1MMin, setRet1MMin] = useState<string>("");
  const [ret1MMax, setRet1MMax] = useState<string>("");

  // usePoll keeps the previous rows on screen while refreshing, so the table
  // never blanks out between ticks.
  // 60s, not the app default: the scanner covers a much wider universe than
  // the portfolio, and its columns are mostly slow-moving fundamentals. Polling
  // it at price cadence would eat the shared provider budget for no benefit.
  const { data, loading } = usePoll<{ rows: Row[] }>(
    `/api/scan?sort=${sort}&order=${order}&limit=200`,
    60_000,
  );
  const rows = data?.rows ?? [];

  const filtered = rows.filter((r) => {
    const pe = Number(r.pe);
    const beta = Number(r.beta);
    const aum = Number(r.aumFlowPct);
    const ret1m = Number(r.returns["1M"] ?? NaN);

    if (peMin && pe < Number(peMin)) return false;
    if (peMax && pe > Number(peMax)) return false;
    if (betaMin && beta < Number(betaMin)) return false;
    if (betaMax && beta > Number(betaMax)) return false;
    if (aumMin && aum < Number(aumMin)) return false;
    if (aumMax && aum > Number(aumMax)) return false;
    if (ret1MMin && (isNaN(ret1m) || ret1m < Number(ret1MMin))) return false;
    if (ret1MMax && (isNaN(ret1m) || ret1m > Number(ret1MMax))) return false;
    return true;
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs">Sort</label>
        <select
          className="text-xs"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="aumFlowPct">AUM Flow %</option>
          <option value="pe">P/E</option>
          <option value="dividendYield">Dividend Yield</option>
          <option value="beta">Beta</option>
          <option value="evEbitda">EV/EBITDA</option>
          <option value="returns[1M]">1M Return</option>
          <option value="returns[3M]">3M Return</option>
          <option value="returns[6M]">6M Return</option>
          <option value="returns[1Y]">1Y Return</option>
        </select>
        <button
          className="text-xs"
          onClick={() => setOrder((o) => (o === "asc" ? "desc" : "asc"))}
        >
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
          <div className="text-[11px]">AUM%</div>
          <input className="w-12 text-xs" placeholder="min" value={aumMin} onChange={(e) => setAumMin(e.target.value)} />
          <input className="w-12 text-xs" placeholder="max" value={aumMax} onChange={(e) => setAumMax(e.target.value)} />
        </div>
        <div className="ml-2 flex items-center gap-1 text-xs">
          <div className="text-[11px]">1M%</div>
          <input className="w-12 text-xs" placeholder="min" value={ret1MMin} onChange={(e) => setRet1MMin(e.target.value)} />
          <input className="w-12 text-xs" placeholder="max" value={ret1MMax} onChange={(e) => setRet1MMax(e.target.value)} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="grid-table text-xs">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Last</th>
              <th>AUM %</th>
              <th>P/E</th>
              <th>Div%</th>
              <th>Beta</th>
              <th>EV/EBITDA</th>
              <th>1M</th>
              <th>3M</th>
              <th>6M</th>
              <th>1Y</th>
            </tr>
          </thead>
          <tbody>
              {loading ? (
              <tr>
                <td colSpan={11} className="text-center py-4 text-[11px]">
                  loading…
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.symbol}>
                  <td className="font-mono">{r.symbol}</td>
                  <td className="tnum">{r.last ? fmtNum(r.last, 2) : "—"}</td>
                  <td className="tnum">{fmtPctPoints(r.aumFlowPct)}</td>
                  <td className="tnum">{r.pe.toFixed(2)}</td>
                  <td className="tnum">{r.dividendYield.toFixed(2)}%</td>
                  <td className="tnum">{r.beta.toFixed(2)}</td>
                  <td className="tnum">{r.evEbitda.toFixed(2)}</td>
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
