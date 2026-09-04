/**
 * Bulk universe sweep: computes the canonical opportunity/screener row for the
 * FULL EODHD US universe (mcap-banded, ~6k names) with bounded concurrency.
 * Run: EODHD_API_KEY=... npx tsx --conditions=react-server scripts/sweep-universe.mts
 */
const P = "/Users/emreguvenen/n8n/pcc/src/lib";
const { getScreenerUniverse } = await import(P + "/data/eodhd/screener");
const { computeOpportunityRow, upsertOpportunityRows, getUniverseMeta } = await import(P + "/data/opportunities");

const CONCURRENCY = 4;
const CHUNK_FLUSH = 200;

const { getUniverseRows } = await import(P + "/data/opportunities");
// --full recomputes every row (canonical-formula changes); default is missing-only.
const FULL = process.argv.includes("--full");
const have = new Set(FULL ? [] : getUniverseRows().map((r: any) => r.symbol));
const universeAll = await getScreenerUniverse();
const universe = universeAll.filter((r: any) => !have.has(r.symbol));
console.log(`[sweep] mode=${FULL ? "FULL" : "missing-only"} universe ${universeAll.length}, already have ${have.size}, todo ${universe.length}`);
// Pace to stay inside EODHD's per-minute request limit (2 calls per symbol).
const PACE_MS = 340;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let done = 0, ok = 0, failed = 0;
let pending: any[] = [];
const t0 = Date.now();

async function worker(rows: typeof universe) {
  for (const row of rows) {
    try {
      let snap = await computeOpportunityRow(row);
      if (!snap) { await sleep(1500); snap = await computeOpportunityRow(row); } // one retry after backoff
      if (snap) { pending.push(snap); ok++; } else failed++;
    } catch { failed++; }
    await sleep(PACE_MS);
    done++;
    if (done % 100 === 0) {
      const rate = done / ((Date.now() - t0) / 1000);
      console.log(`[sweep] ${done}/${universe.length} ok=${ok} fail=${failed} | ${rate.toFixed(1)}/s | eta ${(((universe.length - done) / rate) / 60).toFixed(1)}m`);
    }
    if (pending.length >= CHUNK_FLUSH) {
      const total = upsertOpportunityRows(pending);
      pending = [];
      console.log(`[sweep] flushed, table now ${total} rows`);
    }
  }
}

const shards: (typeof universe)[] = Array.from({ length: CONCURRENCY }, () => []);
universe.forEach((r: any, i: number) => shards[i % CONCURRENCY]!.push(r));
await Promise.all(shards.map(worker));
if (pending.length) upsertOpportunityRows(pending);
console.log(`[sweep] DONE in ${((Date.now() - t0) / 60000).toFixed(1)}m`, getUniverseMeta());
