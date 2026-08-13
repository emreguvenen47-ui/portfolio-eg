import * as XLSX from "xlsx";
import type {
  AssetClass,
  Portfolio,
  Position,
  RawPositionRow,
  Region,
} from "@/lib/types";
import { classifySymbol, themesFor } from "./config";

/**
 * Header-driven workbook parser.
 *
 * Nothing here is keyed off a specific ticker or row number: we locate the
 * header row by content, map columns by fuzzy name, then read until the sheet
 * runs out or a TOTAL row appears. That is what lets an arbitrary
 * "structured similarly" workbook import cleanly.
 */

type Cell = string | number | boolean | Date | null | undefined;
type Grid = Cell[][];

/** Column keys we try to locate, in priority order (first match wins). */
const COLUMN_PATTERNS: { key: keyof ColumnMap; patterns: RegExp[] }[] = [
  { key: "code", patterns: [/^\s*(kod|ticker|symbol|sembol)\s*$/i] },
  {
    key: "name",
    patterns: [/varl[ıi]k\s*ad|asset\s*name|^\s*(asset|name|isim|ad[ıi])\s*$/i],
  },
  { key: "category", patterns: [/kategori|category|s[ıi]n[ıi]f|sector|sekt[öo]r/i] },
  { key: "weight", patterns: [/a[ğg][ıi]rl[ıi]k|weight|oran|allocation/i] },
  { key: "amount", patterns: [/tutar|amount|value|de[ğg]er|notional/i] },
  {
    key: "expectedReturn",
    patterns: [/bek\.?\s*getiri|expected\s*return|beklenen\s*getiri|^\s*e\[?r\]?\s*$/i],
  },
  { key: "volatility", patterns: [/volatilite|volatility|^\s*vol\.?\s*$|std\s*dev/i] },
  { key: "currency", patterns: [/para\s*birimi|currency|^\s*(ccy|kur)\s*$/i] },
  {
    key: "rationale",
    patterns: [/neden|gerek[çc]e|rationale|thesis|why|reason|a[çc][ıi]klama/i],
  },
  { key: "risks", patterns: [/risk/i] },
];

interface ColumnMap {
  code: number;
  name: number;
  category: number;
  weight: number;
  amount: number;
  expectedReturn: number;
  volatility: number;
  currency: number;
  rationale: number;
  risks: number;
}

const norm = (v: Cell): string =>
  v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim();

const isTotalRow = (s: string) =>
  /^(toplam|total|sum|genel\s*toplam)$/i.test(s.trim());

function toNumber(v: Cell): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = norm(v);
  if (!s) return null;
  // Handles "35%", "%35", "1.234,56", "1,234.56", "(1.200)"
  let t = s.replace(/[%\s$€₺]/g, "");
  const negParen = /^\(.*\)$/.test(t);
  if (negParen) t = t.slice(1, -1);
  const lastComma = t.lastIndexOf(",");
  const lastDot = t.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator comes last is the decimal separator.
    t = lastComma > lastDot ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (lastComma > -1) {
    // Ambiguous: "1,5" is decimal; "1,500" is a thousands group.
    t = /,\d{3}$/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  }
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return negParen ? -n : n;
}

/** Accepts either 0.35 or 35 and always returns 0.35. */
function toRatio(v: Cell): number | null {
  const raw = typeof v === "string" && v.includes("%") ? null : toNumber(v);
  if (raw === null) {
    const n = toNumber(v);
    return n === null ? null : n / 100;
  }
  // A weight/vol/return above 1.5 is almost certainly expressed in percent.
  return Math.abs(raw) > 1.5 ? raw / 100 : raw;
}

function findHeaderRow(grid: Grid): { row: number; cols: ColumnMap } | null {
  const limit = Math.min(grid.length, 40);
  for (let r = 0; r < limit; r++) {
    const cells = grid[r] ?? [];
    const texts = cells.map(norm);
    const hasCode = texts.some((t) => COLUMN_PATTERNS[0].patterns[0].test(t));
    const hasWeight = texts.some((t) =>
      COLUMN_PATTERNS.find((p) => p.key === "weight")!.patterns[0].test(t),
    );
    if (!hasCode || !hasWeight) continue;

    const cols: Partial<ColumnMap> = {};
    const taken = new Set<number>();
    for (const { key, patterns } of COLUMN_PATTERNS) {
      for (const pat of patterns) {
        const idx = texts.findIndex((t, i) => !taken.has(i) && t && pat.test(t));
        if (idx !== -1) {
          cols[key] = idx;
          taken.add(idx);
          break;
        }
      }
    }
    if (cols.code !== undefined && cols.weight !== undefined) {
      return {
        row: r,
        cols: {
          code: cols.code,
          name: cols.name ?? -1,
          category: cols.category ?? -1,
          weight: cols.weight,
          amount: cols.amount ?? -1,
          expectedReturn: cols.expectedReturn ?? -1,
          volatility: cols.volatility ?? -1,
          currency: cols.currency ?? -1,
          rationale: cols.rationale ?? -1,
          risks: cols.risks ?? -1,
        },
      };
    }
  }
  return null;
}

/** Maps the workbook's free-text category onto our enums. */
export function classifyCategory(category: string, code: string): {
  assetClass: AssetClass;
  region: Region;
} {
  const c = category.toLocaleLowerCase("tr");
  const k = code.toLocaleUpperCase("tr");

  let region: Region = "Global";
  if (/t[üu]rkiye|turkey|bist/.test(c) || k === "BIST") region = "Turkey";
  else if (/abd|us\b|united states|amerika/.test(c)) region = "US";
  else if (/avrupa|europe|euro/.test(c)) region = "Europe";
  else if (/[çc]in|china/.test(c)) region = "China";
  else if (/geli[şs]en|emerging|gO[ÜU]|em\b/i.test(c)) region = "EM";
  else if (/a[çc][ıi]k|unalloc|nakit\s*rezerv/.test(c)) region = "Unallocated";

  let assetClass: AssetClass = "Equity";
  if (/emtia|commodity|metal|alt[ıi]n|gold|bak[ıi]r|copper/.test(c))
    assetClass = "Commodity";
  else if (/a[çc][ıi]k\s*pozisyon|unalloc|tahsis edilmemi[şs]/.test(c))
    assetClass = "Unallocated";
  else if (/nakit|cash|para piyasas|money market|bono|t-bill/.test(c))
    assetClass = "Cash";
  else if (/vadeli|managed futures|hedge|alternatif|alternative/.test(c))
    assetClass = "Alternative";

  if (assetClass === "Unallocated") region = "Unallocated";
  return { assetClass, region };
}

function normalizeCurrency(raw: string): Position["currencyCode"] {
  const s = raw.toLocaleUpperCase("tr");
  if (/^TRY|TL\b/.test(s)) return "TRY";
  if (/^EUR/.test(s)) return "EUR";
  if (/^USD$/.test(s)) return "USD";
  if (/USD/.test(s) && /\//.test(s)) return "USD"; // "USD/CNY" settles in USD
  if (/karma|mixed|çeşitli/i.test(s)) return "MIXED";
  return "USD";
}

export interface ParseResult {
  portfolio: Portfolio;
  raw: RawPositionRow[];
}

export function parsePortfolioWorkbook(
  data: ArrayBuffer | Uint8Array,
  sourceFile = "upload.xlsx",
): ParseResult {
  const wb = XLSX.read(data, { type: "array" });
  const warnings: string[] = [];

  // Prefer a sheet that actually parses; fall back to scanning all of them.
  const ordered = [
    ...wb.SheetNames.filter((n) => /portf|holding|position|alloc/i.test(n)),
    ...wb.SheetNames,
  ];

  let grid: Grid | null = null;
  let header: { row: number; cols: ColumnMap } | null = null;
  let sheetName = "";

  for (const name of ordered) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const g = XLSX.utils.sheet_to_json<Cell[]>(ws, {
      header: 1,
      raw: true,
      defval: null,
    }) as Grid;
    const h = findHeaderRow(g);
    if (h) {
      grid = g;
      header = h;
      sheetName = name;
      break;
    }
  }

  if (!grid || !header) {
    throw new Error(
      "Could not locate a holdings table. Expected a header row containing a " +
        '"Kod"/"Ticker" column and an "Ağırlık"/"Weight" column.',
    );
  }

  const { cols } = header;
  const get = (row: Cell[], i: number): Cell => (i < 0 ? null : row[i]);

  const raw: RawPositionRow[] = [];
  for (let r = header.row + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const code = norm(get(row, cols.code));
    const nameCell = norm(get(row, cols.name));

    if (isTotalRow(code) || isTotalRow(nameCell)) break;
    if (!code) {
      // Tolerate a single blank spacer row, stop on a second.
      const next = norm(get(grid[r + 1] ?? [], cols.code));
      if (!next) break;
      continue;
    }

    const weight = toRatio(get(row, cols.weight));
    if (weight === null) {
      warnings.push(`Row ${r + 1} (${code}): unreadable weight, skipped.`);
      continue;
    }

    raw.push({
      index: raw.length + 1,
      code,
      name: nameCell || code,
      category: norm(get(row, cols.category)),
      weight,
      amount: toNumber(get(row, cols.amount)) ?? 0,
      expectedReturn: toRatio(get(row, cols.expectedReturn)) ?? 0,
      volatility: toRatio(get(row, cols.volatility)) ?? 0,
      currency: norm(get(row, cols.currency)) || "USD",
      rationale: norm(get(row, cols.rationale)),
      risks: norm(get(row, cols.risks)),
    });
  }

  if (raw.length === 0) throw new Error("Holdings table found but it has no data rows.");

  const weightSum = raw.reduce((s, p) => s + p.weight, 0);
  if (Math.abs(weightSum - 1) > 0.005) {
    warnings.push(
      `Weights sum to ${(weightSum * 100).toFixed(2)}% (expected 100%). Weights were renormalised for display.`,
    );
  }

  let totalAmount = raw.reduce((s, p) => s + p.amount, 0);
  if (totalAmount <= 0) {
    totalAmount = 10_000_000;
    warnings.push("No amount column found; assumed a 10,000,000 base.");
  }

  const positions: Position[] = raw.map((p) => {
    const { assetClass, region } = classifyCategory(p.category, p.code);
    const cls = classifySymbol(p.code, assetClass);
    return {
      ...p,
      weight: p.weight / (weightSum || 1),
      targetWeight: p.weight / (weightSum || 1),
      amount: p.amount || totalAmount * p.weight,
      assetClass,
      region,
      kind: cls.kind,
      symbol: cls.symbol,
      isProxy: cls.isProxy,
      proxyNote: cls.proxyNote,
      themes: themesFor(p.code, p.category, assetClass),
      currencyCode: normalizeCurrency(p.currency),
    };
  });

  // Pull scalar assumptions out of a summary sheet if one exists.
  const summary: Record<string, number> = {};
  const summarySheet = wb.SheetNames.find((n) => /[öo]zet|summary/i.test(n));
  if (summarySheet) {
    const g = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[summarySheet], {
      header: 1,
      raw: true,
      defval: null,
    }) as Grid;
    for (const row of g) {
      const label = row.map(norm).find((t) => t.length > 3);
      const num = row.map(toNumber).find((n) => n !== null && n !== undefined);
      if (label && typeof num === "number") summary[label] = num;
    }
  }

  const title =
    norm(grid[0]?.find((c) => norm(c).length > 10)) || `${sheetName} portfolio`;

  return {
    raw,
    portfolio: {
      meta: {
        title,
        baseCurrency: "USD",
        totalAmount,
        sourceFile,
        parsedAt: new Date().toISOString(),
        summary,
        warnings,
      },
      positions,
    },
  };
}
