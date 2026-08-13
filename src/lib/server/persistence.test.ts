import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Durability of account-owned data.
 *
 * A paper-trading ledger that quietly disappears is worse than one that fails
 * to save, because the user has no way to tell a bug from a deletion they
 * half-remember making. These tests read the store source and assert that
 * nothing in it removes a record on its own — no age limit, no cap, no sweep.
 * Deletion happens where a person asked for it and nowhere else.
 */

const read = (p: string) => readFileSync(p, "utf8");

describe("paper trading and saved data are never auto-deleted", () => {
  const stores = [
    "src/lib/server/virtual-portfolios.ts",
    "src/lib/server/ai-portfolios.ts",
    "src/lib/server/saved-screens.ts",
    "src/lib/server/alert-store.ts",
  ];

  it("has no time-based expiry on any user store", () => {
    for (const p of stores) {
      const src = read(p);
      // A TTL constant here would silently drop a ledger after some interval.
      expect(src, p).not.toMatch(/TTL_MS\s*=/);
      expect(src, p).not.toMatch(/\bexpire[sd]?\b/i);
    }
  });

  it("has no sweep, prune or cap that could drop records", () => {
    for (const p of stores) {
      const src = read(p);
      expect(src, p).not.toMatch(/\bprune\b|\bsweep\b|\bevict\b|\btrim\b/i);
    }
  });

  it("only deletes from a function whose name says so", () => {
    for (const p of stores) {
      const src = read(p);
      // Every `.delete(` must sit inside an explicitly named delete/remove
      // function — never inside a read or a save path.
      const lines = src.split("\n");
      let current = "";
      for (const line of lines) {
        const fn = line.match(/(?:export )?(?:async )?function (\w+)/);
        if (fn) current = fn[1];
        if (/\.delete\(|\bmemory\.delete\(/.test(line)) {
          expect(current, `${p}: ${current}`).toMatch(/delete|remove|clear/i);
        }
      }
    }
  });

  it("keeps the paper ledger as individual lots rather than a netted total", () => {
    // Netting on write would destroy which lot is up and which is down, and
    // that information cannot be recovered afterwards.
    const src = read("src/lib/server/virtual-portfolios.ts");
    expect(src).toMatch(/trades:\s*Trade\[\]/);
  });
});
