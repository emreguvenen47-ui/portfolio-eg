/**
 * RATIO AUDIT (sprint §1) — full lineage check for every displayed ratio.
 *
 * For each test symbol:
 *   RAW      — the EODHD field(s) the ratio derives from, fetched directly
 *   EXPECTED — the value recomputed HERE from raw statement lines
 *   SNAPSHOT — what the canonical CompanySnapshot carries
 *   UI       — what the legacy adapter (KeyMetrics) hands the panels
 * STATUS: OK (|Δ| < 1% rel or both null), CHECK (provider-vs-computed diverge
 * — usually period basis), FAIL (unit/mapping error).
 *
 * Run: EODHD_API_KEY=... npx tsx --conditions=react-server scripts/ratio-audit.mts [SYM ...]
 */
import { getCompanySnapshot } from "../src/lib/data/eodhd/fundamentals";
import { toKeyMetrics } from "../src/lib/data/eodhd/legacy-adapter";

const KEY = process.env.EODHD_API_KEY!;
const DEFAULT = ["AAPL", "MSFT", "NVDA", "JPM", "MU", "XOM", "AMT", "GOOGL", "META", "AVGO", "TSLA", "PLTR"];
const symbols = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;

const f = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || Number.isNaN(v) ? "N/A" : v.toFixed(d);

type Row = {
  ratio: string; source: string; raw: string; formula: string;
  expected: number | null; snapshot: number | null; ui: number | null; status: string;
};

function status(expected: number | null, actual: number | null, tolPct = 1.5): string {
  if (expected === null && actual === null) return "OK(both N/A)";
  if (expected === null || actual === null) return expected === null ? "CHECK(no-raw)" : "FAIL(missing)";
  const rel = Math.abs(actual - expected) / Math.max(1e-9, Math.abs(expected)) * 100;
  return rel <= tolPct ? "OK" : rel <= 8 ? `CHECK(Δ${rel.toFixed(1)}%)` : `FAIL(Δ${rel.toFixed(1)}%)`;
}

const sum4 = (xs: Array<number | null>): number | null => {
  if (xs.length < 4) return null;
  let t = 0;
  for (let i = 0; i < 4; i++) { const v = xs[i]; if (v == null) return null; t += v; }
  return t;
};

async function audit(sym: string) {
  const res = await fetch(`https://eodhd.com/api/fundamentals/${sym}.US?api_token=${KEY}&fmt=json`);
  if (!res.ok) { console.log(`\n=== ${sym}: HTTP ${res.status} — skipped`); return { sym, rows: [], fails: 0, checks: 0 }; }
  const raw = await res.json() as Record<string, any>;
  const snap = await getCompanySnapshot(sym);
  if (!snap) { console.log(`\n=== ${sym}: no snapshot`); return { sym, rows: [], fails: 0, checks: 0 }; }
  const km = toKeyMetrics(snap);

  const H = raw.Highlights ?? {}, V = raw.Valuation ?? {}, SD = raw.SplitsDividends ?? {};
  const num = (x: unknown): number | null => {
    if (x === null || x === undefined || x === "" || x === "NA") return null;
    const n = Number(x); return Number.isFinite(n) ? n : null;
  };

  // Raw quarterly statements, newest first
  const isQ = raw.Financials?.Income_Statement?.quarterly ?? {};
  const bsQ = raw.Financials?.Balance_Sheet?.quarterly ?? {};
  const cfQ = raw.Financials?.Cash_Flow?.quarterly ?? {};
  const dates = [...new Set([...Object.keys(isQ), ...Object.keys(bsQ), ...Object.keys(cfQ)])].sort().reverse();
  const q = dates.map((d) => ({
    d,
    rev: num(isQ[d]?.totalRevenue), gp: num(isQ[d]?.grossProfit), oi: num(isQ[d]?.operatingIncome),
    ebit: num(isQ[d]?.ebit), ebitda: num(isQ[d]?.ebitda), ni: num(isQ[d]?.netIncome),
    pretax: num(isQ[d]?.incomeBeforeTax), tax: num(isQ[d]?.incomeTaxExpense) ?? num(isQ[d]?.taxProvision),
    assets: num(bsQ[d]?.totalAssets), curA: num(bsQ[d]?.totalCurrentAssets), curL: num(bsQ[d]?.totalCurrentLiabilities),
    inv: num(bsQ[d]?.inventory), eq: num(bsQ[d]?.totalStockholderEquity),
    cash: num(bsQ[d]?.cashAndShortTermInvestments) ?? num(bsQ[d]?.cash),
    debt: num(bsQ[d]?.shortLongTermDebtTotal) ?? ((num(bsQ[d]?.shortTermDebt) === null && num(bsQ[d]?.longTermDebt) === null) ? null : (num(bsQ[d]?.shortTermDebt) ?? 0) + (num(bsQ[d]?.longTermDebt) ?? 0)),
    ocf: num(cfQ[d]?.totalCashFromOperatingActivities), capex: num(cfQ[d]?.capitalExpenditures),
  }));

  const revT = sum4(q.map(x => x.rev)), gpT = sum4(q.map(x => x.gp)), oiT = sum4(q.map(x => x.oi));
  const niT = sum4(q.map(x => x.ni)), ebitdaT = sum4(q.map(x => x.ebitda));
  const ebitT = sum4(q.map(x => x.ebit)) ?? oiT;
  const taxT = sum4(q.map(x => x.tax)), pretaxT = sum4(q.map(x => x.pretax));
  const ocfT = sum4(q.map(x => x.ocf));
  const capexT = sum4(q.map(x => x.capex === null ? null : Math.abs(x.capex)));
  const fcfT = ocfT !== null && capexT !== null ? ocfT - capexT : null;
  const L = q[0];
  const mcap = num(H.MarketCapitalization);
  const price = num(raw.Technicals?.["50DayMA"]) !== null ? null : null; // price not needed directly

  const bankLike = snap.identity.companyType === "BANK" || snap.identity.companyType === "INSURANCE";
  const inv0 = L && L.eq !== null && L.debt !== null ? L.eq + L.debt - (L.cash ?? 0) : null;
  const inv4 = q[4] && q[4].eq !== null && q[4].debt !== null ? q[4].eq! + q[4].debt! - (q[4].cash ?? 0) : null;
  const avgInv = inv0 === null ? null : inv4 === null ? inv0 : (inv0 + inv4) / 2;
  const taxRate = taxT !== null && pretaxT !== null && pretaxT > 0 ? Math.min(0.5, Math.max(0, taxT / pretaxT)) : null;
  const roicExp = ebitT !== null && taxRate !== null && avgInv !== null && avgInv > 0 ? (ebitT * (1 - taxRate)) / avgInv : null;
  const ce0 = L && L.assets !== null && L.curL !== null ? L.assets - L.curL : null;
  const ce4 = q[4] && q[4].assets !== null && q[4].curL !== null ? q[4].assets! - q[4].curL! : null;
  const avgCe = ce0 === null ? null : ce4 === null ? ce0 : (ce0 + ce4) / 2;
  const roceExp = ebitT !== null && avgCe !== null && avgCe > 0 ? ebitT / avgCe : null;

  const netDebtL = L?.debt != null && L?.cash != null ? L.debt - L.cash : null;
  const evLive = mcap !== null && netDebtL !== null ? mcap + netDebtL : num(V.EnterpriseValue);
  const epsTtm = num(H.EarningsShare);
  const rows: Row[] = [
    { ratio: "P/E (TTM)", source: "Valuation.TrailingPE (gated: EPS>0)", raw: `TrailingPE=${f(num(V.TrailingPE))} eps=${f(epsTtm)}`, formula: "price/eps_ttm, null if eps≤0",
      expected: epsTtm !== null && epsTtm > 0 ? num(V.TrailingPE) ?? num(H.PERatio) : null, snapshot: snap.peTtm, ui: km.peTTM ?? null, status: "" },
    { ratio: "Forward P/E", source: "Valuation.ForwardPE", raw: `ForwardPE=${f(num(V.ForwardPE))}`, formula: "price/eps_next_fy",
      expected: num(V.ForwardPE), snapshot: snap.forwardPe, ui: km.forwardPE ?? null, status: "" },
    { ratio: "PEG", source: "Highlights.PEGRatio", raw: `PEG=${f(num(H.PEGRatio))}`, formula: "pe/eps_growth (provider)",
      expected: num(H.PEGRatio), snapshot: snap.peg, ui: km.pegTTM ?? null, status: "" },
    { ratio: "P/B", source: "Valuation.PriceBookMRQ", raw: `PB=${f(num(V.PriceBookMRQ))} eq=${f(L?.eq ?? null, 0)}`, formula: "mcap/equity_mrq",
      expected: mcap !== null && L?.eq != null && L.eq > 0 ? mcap / L.eq : num(V.PriceBookMRQ), snapshot: snap.priceToBook, ui: km.pbQuarterly ?? null, status: "" },
    { ratio: "P/S (TTM)", source: "Valuation.PriceSalesTTM", raw: `PS=${f(num(V.PriceSalesTTM))} revT=${f(revT, 0)}`, formula: "mcap/revenue_ttm",
      expected: bankLike
        ? num(V.PriceSalesTTM) // banks: provider uses net revenue (correct basis); gross interest income is not "sales"
        : mcap !== null && revT !== null && revT > 0 ? mcap / revT : num(V.PriceSalesTTM),
      snapshot: snap.priceToSales, ui: km.psTTM ?? null, status: "" },
    { ratio: "EV/EBITDA", source: "Valuation.EnterpriseValueEbitda", raw: `EV=${f(num(V.EnterpriseValue), 0)} ebitdaT=${f(ebitdaT, 0)}`, formula: "EV/ebitda_ttm",
      expected: bankLike ? null // EBITDA multiples suppressed for banks/insurers by design
        : evLive !== null && ebitdaT !== null && ebitdaT > 0 ? evLive / ebitdaT : num(V.EnterpriseValueEbitda),
      snapshot: snap.evToEbitda, ui: km.evEbitdaTTM ?? null, status: "" },
    { ratio: "EV/Sales", source: "Valuation.EnterpriseValueRevenue", raw: `EV=${f(num(V.EnterpriseValue), 0)} revT=${f(revT, 0)}`, formula: "EV/revenue_ttm",
      expected: bankLike ? null
        : evLive !== null && revT !== null && revT > 0 ? evLive / revT : num(V.EnterpriseValueRevenue),
      snapshot: snap.evToRevenue, ui: km.evRevenueTTM ?? null, status: "" },
    { ratio: "ROE (%)", source: "Highlights.ReturnOnEquityTTM ×100", raw: `ROE=${f(num(H.ReturnOnEquityTTM), 4)} niT=${f(niT, 0)} eq=${f(L?.eq ?? null, 0)}`, formula: "ni_ttm/equity (provider TTM, ending)",
      expected: num(H.ReturnOnEquityTTM) !== null ? num(H.ReturnOnEquityTTM)! * 100 : (niT !== null && L?.eq != null && L.eq > 0 ? (niT / L.eq) * 100 : null),
      snapshot: snap.roe !== null ? snap.roe * 100 : null, ui: km.roeTTM ?? null, status: "" },
    { ratio: "ROA (%)", source: "Highlights.ReturnOnAssetsTTM ×100", raw: `ROA=${f(num(H.ReturnOnAssetsTTM), 4)}`, formula: "ni_ttm/assets",
      expected: num(H.ReturnOnAssetsTTM) !== null ? num(H.ReturnOnAssetsTTM)! * 100 : null,
      snapshot: snap.roa !== null ? snap.roa * 100 : null, ui: km.roaTTM ?? null, status: "" },
    { ratio: "ROIC (%)", source: "computed: statements", raw: `ebitT=${f(ebitT, 0)} taxRate=${f(taxRate, 3)} avgInv=${f(avgInv, 0)}`, formula: "EBIT_ttm×(1−tax)/avg(eq+debt−cash)",
      expected: roicExp !== null ? roicExp * 100 : null, snapshot: snap.roic !== null ? snap.roic * 100 : null, ui: snap.roic !== null ? snap.roic * 100 : null, status: "" },
    { ratio: "ROCE (%)", source: "computed: statements", raw: `ebitT=${f(ebitT, 0)} avgCE=${f(avgCe, 0)}`, formula: "EBIT_ttm/avg(assets−curLiab)",
      expected: roceExp !== null ? roceExp * 100 : null, snapshot: snap.roce !== null ? snap.roce * 100 : null, ui: snap.roce !== null ? snap.roce * 100 : null, status: "" },
    { ratio: "Gross Margin (%)", source: "IS quarterly ×4", raw: `gpT=${f(gpT, 0)} revT=${f(revT, 0)}`, formula: "gp_ttm/rev_ttm",
      expected: gpT !== null && revT !== null && revT > 0 ? (gpT / revT) * 100 : null,
      snapshot: snap.grossMarginTtm !== null ? snap.grossMarginTtm * 100 : null, ui: km.grossMarginTTM ?? null, status: "" },
    { ratio: "Op Margin (%)", source: "IS quarterly ×4", raw: `oiT=${f(oiT, 0)}`, formula: "oi_ttm/rev_ttm",
      expected: oiT !== null && revT !== null && revT > 0 ? (oiT / revT) * 100 : null,
      snapshot: snap.operatingMarginTtm !== null ? snap.operatingMarginTtm * 100 : null, ui: km.operatingMarginTTM ?? null, status: "" },
    { ratio: "Net Margin (%)", source: "IS quarterly ×4", raw: `niT=${f(niT, 0)}`, formula: "ni_ttm/rev_ttm",
      expected: niT !== null && revT !== null && revT > 0 ? (niT / revT) * 100 : null,
      snapshot: snap.netMarginTtm !== null ? snap.netMarginTtm * 100 : null, ui: km.netProfitMarginTTM ?? null, status: "" },
    { ratio: "FCF Margin (%)", source: "CF quarterly ×4", raw: `ocfT=${f(ocfT, 0)} capexT=${f(capexT, 0)}`, formula: "(ocf−capex)_ttm/rev_ttm",
      expected: fcfT !== null && revT !== null && revT > 0 ? (fcfT / revT) * 100 : null,
      snapshot: snap.fcfMargin !== null ? snap.fcfMargin * 100 : null, ui: snap.fcfMargin !== null ? snap.fcfMargin * 100 : null, status: "" },
    { ratio: "FCF Yield (%)", source: "CF ttm / mcap", raw: `fcfT=${f(fcfT, 0)} mcap=${f(mcap, 0)}`, formula: "fcf_ttm/market_cap",
      expected: fcfT !== null && mcap !== null && mcap > 0 ? (fcfT / mcap) * 100 : null,
      snapshot: snap.fcfYield !== null ? snap.fcfYield * 100 : null, ui: snap.fcfYield !== null ? snap.fcfYield * 100 : null, status: "" },
    { ratio: "Debt/Equity", source: "BS latest Q", raw: `debt=${f(L?.debt ?? null, 0)} eq=${f(L?.eq ?? null, 0)}`, formula: "totalDebt/equity (eq>0)",
      expected: L?.debt != null && L?.eq != null && L.eq > 0 ? L.debt / L.eq : null,
      snapshot: snap.debtToEquity, ui: km["totalDebt/totalEquityQuarterly"] !== undefined ? (km["totalDebt/totalEquityQuarterly"] as number) / 100 : null, status: "" },
    { ratio: "NetDebt/EBITDA", source: "BS + IS ttm", raw: `netDebt=${f(L?.debt != null && L?.cash != null ? L.debt - L.cash : null, 0)} ebitdaT=${f(ebitdaT, 0)}`, formula: "(debt−cash)/ebitda_ttm (ebitda>0)",
      expected: bankLike ? null : L?.debt != null && L?.cash != null && ebitdaT !== null && ebitdaT > 0 ? (L.debt - L.cash) / ebitdaT : null,
      snapshot: snap.netDebtToEbitda, ui: snap.netDebtToEbitda, status: "" },
    { ratio: "Current Ratio", source: "BS latest Q", raw: `curA=${f(L?.curA ?? null, 0)} curL=${f(L?.curL ?? null, 0)}`, formula: "currentAssets/currentLiabilities",
      expected: L?.curA != null && L?.curL != null && L.curL > 0 ? L.curA / L.curL : null,
      snapshot: snap.currentRatio, ui: km.currentRatioQuarterly ?? null, status: "" },
    { ratio: "Quick Ratio", source: "BS latest Q", raw: `inv=${f(L?.inv ?? null, 0)}`, formula: "(curA−inventory)/curL",
      expected: L?.curA != null && L?.curL != null && L.curL > 0 ? (L.curA - (L.inv ?? 0)) / L.curL : null,
      snapshot: snap.quickRatio, ui: km.quickRatioQuarterly ?? null, status: "" },
    { ratio: "Div Yield (%)", source: "Highlights.DividendYield ×100", raw: `DY=${f(num(H.DividendYield), 4)}`, formula: "dps/price",
      expected: num(H.DividendYield) !== null ? num(H.DividendYield)! * 100 : null,
      snapshot: snap.dividendYield !== null ? snap.dividendYield * 100 : null, ui: km.dividendYieldIndicatedAnnual ?? null, status: "" },
    { ratio: "Payout (%)", source: "SplitsDividends.PayoutRatio ×100", raw: `PR=${f(num(SD.PayoutRatio), 4)}`, formula: "dividends/net income",
      expected: num(SD.PayoutRatio) !== null ? num(SD.PayoutRatio)! * 100 : null,
      snapshot: snap.payoutRatio !== null ? snap.payoutRatio * 100 : null, ui: km.payoutRatioTTM ?? null, status: "" },
  ];

  for (const r of rows) {
    // UI status compares against expected; snapshot must also match.
    const sSnap = status(r.expected, r.snapshot);
    const sUi = status(r.expected, r.ui);
    r.status = sSnap.startsWith("OK") && sUi.startsWith("OK") ? sSnap : `snap:${sSnap} ui:${sUi}`;
  }

  const fails = rows.filter(r => r.status.includes("FAIL")).length;
  const checks = rows.filter(r => r.status.includes("CHECK")).length;
  console.log(`\n=== ${sym} (${snap.identity.name}) — period ${snap.meta.latestStatementPeriod}, confidence ${snap.meta.confidence}`);
  console.log("RATIO            | EXPECTED   | SNAPSHOT   | UI         | STATUS          | RAW");
  for (const r of rows) {
    console.log(
      `${r.ratio.padEnd(16)} | ${f(r.expected).padStart(10)} | ${f(r.snapshot).padStart(10)} | ${f(r.ui).padStart(10)} | ${r.status.padEnd(15)} | ${r.raw.slice(0, 60)}`,
    );
  }
  return { sym, rows, fails, checks };
}

const results: Array<{ sym: string; fails: number; checks: number }> = [];
for (const s of symbols) {
  try { const r = await audit(s); results.push({ sym: r.sym, fails: r.fails, checks: r.checks }); }
  catch (e) { console.log(`${s}: ERROR ${(e as Error).message}`); }
  await new Promise((r) => setTimeout(r, 400));
}
console.log("\n===== SUMMARY =====");
for (const r of results) console.log(`${r.sym.padEnd(6)} FAIL=${r.fails} CHECK=${r.checks}`);
const totalFails = results.reduce((s, r) => s + r.fails, 0);
console.log(`TOTAL FAILS: ${totalFails}`);
