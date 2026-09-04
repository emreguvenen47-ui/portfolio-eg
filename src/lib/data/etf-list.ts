/**
 * MAJOR ETF UNIVERSE — the funds the /etfs desk lists. Every symbol is a real
 * US listing whose holdings resolve through the ETF holdings seam (EODHD
 * ETF_Data, SSGA daily files for SPDRs). Categories are for grouping only.
 */

export interface EtfMeta {
  symbol: string;
  name: string;
  category: "BROAD MARKET" | "SECTOR" | "FACTOR/THEME" | "BONDS" | "COMMODITY" | "INTERNATIONAL" | "CRYPTO";
}

export const MAJOR_ETFS: EtfMeta[] = [
  { symbol: "SPY", name: "SPDR S&P 500", category: "BROAD MARKET" },
  { symbol: "VOO", name: "Vanguard S&P 500", category: "BROAD MARKET" },
  { symbol: "QQQ", name: "Invesco Nasdaq-100", category: "BROAD MARKET" },
  { symbol: "VTI", name: "Vanguard Total Market", category: "BROAD MARKET" },
  { symbol: "IWM", name: "iShares Russell 2000", category: "BROAD MARKET" },
  { symbol: "DIA", name: "SPDR Dow Jones", category: "BROAD MARKET" },
  { symbol: "RSP", name: "Invesco S&P 500 Equal Weight", category: "BROAD MARKET" },

  { symbol: "XLK", name: "Technology Select", category: "SECTOR" },
  { symbol: "XLF", name: "Financial Select", category: "SECTOR" },
  { symbol: "XLE", name: "Energy Select", category: "SECTOR" },
  { symbol: "XLV", name: "Health Care Select", category: "SECTOR" },
  { symbol: "XLI", name: "Industrial Select", category: "SECTOR" },
  { symbol: "XLY", name: "Consumer Discretionary", category: "SECTOR" },
  { symbol: "XLP", name: "Consumer Staples", category: "SECTOR" },
  { symbol: "XLU", name: "Utilities Select", category: "SECTOR" },
  { symbol: "XLB", name: "Materials Select", category: "SECTOR" },
  { symbol: "XLRE", name: "Real Estate Select", category: "SECTOR" },
  { symbol: "XLC", name: "Communication Services", category: "SECTOR" },
  { symbol: "SMH", name: "VanEck Semiconductor", category: "SECTOR" },
  { symbol: "SOXX", name: "iShares Semiconductor", category: "SECTOR" },
  { symbol: "XBI", name: "SPDR S&P Biotech", category: "SECTOR" },
  { symbol: "ITA", name: "iShares Aerospace & Defense", category: "SECTOR" },

  { symbol: "ARKK", name: "ARK Innovation", category: "FACTOR/THEME" },
  { symbol: "MTUM", name: "iShares Momentum", category: "FACTOR/THEME" },
  { symbol: "QUAL", name: "iShares Quality", category: "FACTOR/THEME" },
  { symbol: "VTV", name: "Vanguard Value", category: "FACTOR/THEME" },
  { symbol: "VUG", name: "Vanguard Growth", category: "FACTOR/THEME" },
  { symbol: "SCHD", name: "Schwab US Dividend", category: "FACTOR/THEME" },
  { symbol: "IGV", name: "iShares Software", category: "FACTOR/THEME" },

  { symbol: "TLT", name: "iShares 20+yr Treasury", category: "BONDS" },
  { symbol: "IEF", name: "iShares 7-10yr Treasury", category: "BONDS" },
  { symbol: "SHY", name: "iShares 1-3yr Treasury", category: "BONDS" },
  { symbol: "LQD", name: "iShares IG Corporate", category: "BONDS" },
  { symbol: "HYG", name: "iShares High Yield", category: "BONDS" },

  { symbol: "GLD", name: "SPDR Gold Shares", category: "COMMODITY" },
  { symbol: "SLV", name: "iShares Silver", category: "COMMODITY" },
  { symbol: "USO", name: "US Oil Fund (WTI)", category: "COMMODITY" },
  { symbol: "UNG", name: "US Natural Gas", category: "COMMODITY" },
  { symbol: "CPER", name: "US Copper Index", category: "COMMODITY" },

  { symbol: "EEM", name: "iShares Emerging Markets", category: "INTERNATIONAL" },
  { symbol: "EFA", name: "iShares EAFE", category: "INTERNATIONAL" },
  { symbol: "VGK", name: "Vanguard Europe", category: "INTERNATIONAL" },
  { symbol: "FXI", name: "iShares China Large-Cap", category: "INTERNATIONAL" },
  { symbol: "EWJ", name: "iShares Japan", category: "INTERNATIONAL" },
  { symbol: "TUR", name: "iShares Turkey", category: "INTERNATIONAL" },

  { symbol: "IBIT", name: "iShares Bitcoin Trust", category: "CRYPTO" },
  { symbol: "ETHA", name: "iShares Ethereum Trust", category: "CRYPTO" },
];

const set = new Set(MAJOR_ETFS.map((e) => e.symbol));
export const isMajorEtf = (symbol: string): boolean => set.has(symbol.toUpperCase());
