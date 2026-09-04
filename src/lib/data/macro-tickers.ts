/**
 * MACRO & COMMODITY TICKERS — friendly aliases over real EODHD instruments.
 *
 * Everything here was probed against the live API: gold/silver/Brent are spot
 * FOREX series, BTC/ETH are the crypto feed, S&P is the index feed. Copper's
 * spot series went stale upstream, so the liquid ETF proxy is used and the
 * label SAYS it is a proxy — no silent substitution.
 */

export interface MacroTicker {
  /** Friendly symbol usable in /ticker/<alias> and the tape. */
  alias: string;
  /** Real EODHD code. */
  code: string;
  label: string;
  kind: "COMMODITY" | "CRYPTO" | "INDEX" | "PROXY_ETF";
  note?: string;
  decimals: number;
}

export const MACRO_TICKERS: MacroTicker[] = [
  { alias: "SPX", code: "GSPC.INDX", label: "S&P 500", kind: "INDEX", decimals: 0 },
  { alias: "GOLD", code: "XAUUSD.FOREX", label: "Gold", kind: "COMMODITY", decimals: 0 },
  { alias: "SILVER", code: "XAGUSD.FOREX", label: "Silver", kind: "COMMODITY", decimals: 2 },
  { alias: "BRENT", code: "XBRUSD.FOREX", label: "Brent", kind: "COMMODITY", decimals: 2 },
  { alias: "BTC", code: "BTC-USD.CC", label: "Bitcoin", kind: "CRYPTO", decimals: 0 },
  { alias: "ETH", code: "ETH-USD.CC", label: "Ethereum", kind: "CRYPTO", decimals: 0 },
  { alias: "COPPER", code: "CPER.US", label: "Copper (CPER ETF)", kind: "PROXY_ETF", note: "spot series stale upstream; liquid ETF proxy", decimals: 2 },
  { alias: "NATGAS", code: "UNG.US", label: "NatGas (UNG ETF)", kind: "PROXY_ETF", note: "ETF proxy", decimals: 2 },
];

const byAlias = new Map(MACRO_TICKERS.map((t) => [t.alias, t]));

export const macroByAlias = (symbol: string): MacroTicker | null =>
  byAlias.get(symbol.toUpperCase()) ?? null;
