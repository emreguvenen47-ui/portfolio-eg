/** One-shot: compute member performance over the full deep ledger. */
import "../src/lib/providers/register";
import { getAllCongressRows } from "../src/lib/research/congress-archive";
import { forceCompute } from "../src/lib/research/congress-perf";
const rows = await getAllCongressRows();
console.log("rows:", rows.length);
await forceCompute(rows);
console.log("done");
