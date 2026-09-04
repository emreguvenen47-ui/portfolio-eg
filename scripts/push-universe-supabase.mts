/**
 * One-shot: push the local canonical universe table to Supabase so a
 * serverless deploy hydrates the full precomputed dataset on cold boot.
 * Run after creating the table (data/universe-snapshot.sql):
 *   npx tsx --conditions=react-server scripts/push-universe-supabase.mts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const raw = JSON.parse(readFileSync("data/.cache/opportunity-universe-v3.json", "utf8"));
const rows = raw.entries?.rows?.value ?? [];
if (!rows.length) throw new Error("local universe store is empty — run the sweep first");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { error } = await sb.from("universe_snapshot").upsert({
  id: "canonical",
  rows,
  row_count: rows.length,
  updated_at: new Date().toISOString(),
});
if (error) throw new Error(`${error.code}: ${error.message}`);
console.log(`pushed ${rows.length} rows to universe_snapshot`);
