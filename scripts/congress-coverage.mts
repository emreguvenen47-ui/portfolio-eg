import "../src/lib/providers/register";
import { getAllCongressRows } from "../src/lib/research/congress-archive";
const rows = await getAllCongressRows();
const uniq = new Set(rows.map((r) => r.politician));
console.log("total rows:", rows.length, "| unique politicians:", uniq.size);
const byChamber = { House: 0, Senate: 0 };
for (const p of uniq) {
  const r = rows.find((x) => x.politician === p)!;
  byChamber[r.chamber as "House" | "Senate"]++;
}
console.log("House:", byChamber.House, "Senate:", byChamber.Senate);
