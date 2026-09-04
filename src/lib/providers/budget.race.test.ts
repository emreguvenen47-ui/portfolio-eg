import { afterAll, beforeAll, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { trySpend, spentToday } from "./budget";

/**
 * The spend counter must survive a second process writing to it.
 *
 * `load` memoises for the whole day, so before the fix a process that had
 * already read the file kept a stale copy and its next write discarded
 * everything another process had counted since. That is a spend cap quietly
 * raising itself, which was observed in a live session: one provider's tally
 * went from 16 back down to 2 while a second metered provider was writing.
 *
 * Uses the real store because that path is what the module resolves, so the
 * original file is saved and put back — a test must not reset the day's
 * genuine allowance.
 */

const STORE = "data/.provider-usage.json";
let backup: string | null = null;

beforeAll(() => {
  mkdirSync("data", { recursive: true });
  backup = existsSync(STORE) ? readFileSync(STORE, "utf8") : null;
});

afterAll(() => {
  if (backup === null) rmSync(STORE, { force: true });
  else writeFileSync(STORE, backup, "utf8");
});

it("does not discard another process's tally", () => {
  const day = new Date().toISOString().slice(0, 10);
  writeFileSync(STORE, JSON.stringify({ day, spent: {} }), "utf8");

  // This process spends, which warms its in-memory copy.
  expect(trySpend("test-alpha", 10)).toBe(true);
  expect(spentToday("test-alpha")).toBe(10);

  // A separate process spends against the same file.
  execFileSync(process.execPath, [
    "-e",
    `const {writeFileSync,readFileSync}=require('fs');
     const s=${JSON.stringify(STORE)};
     const u=JSON.parse(readFileSync(s,'utf8'));
     u.spent['test-beta']=(u.spent['test-beta']||0)+5;
     writeFileSync(s,JSON.stringify(u));`,
  ]);

  // This process spends again. It must add to its own tally without erasing
  // the one the other process wrote in between.
  expect(trySpend("test-alpha", 3)).toBe(true);

  const final = JSON.parse(readFileSync(STORE, "utf8")) as {
    spent: Record<string, number>;
  };

  expect(final.spent["test-alpha"]).toBe(13);
  expect(final.spent["test-beta"]).toBe(5);
});
