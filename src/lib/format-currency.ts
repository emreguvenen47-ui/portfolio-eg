/**
 * Reporting-currency symbols.
 *
 * Statements are filed in the issuer's own currency — Turkish issuers in lira,
 * US issuers in dollars — so the money formatters take a symbol rather than
 * assuming one. Rendering Turkish Airlines' ₺1.16tn of revenue as "$1.16T" is
 * wrong by roughly forty times and wrong about the unit.
 *
 * Plain module, not a client component: the ticker page resolves the symbol
 * server-side and passes it down as a prop.
 */
const SYMBOLS: Record<string, string> = {
  USD: "$",
  TRY: "₺",
  EUR: "€",
  GBP: "£",
};

export const currencySymbol = (code: string): string => SYMBOLS[code] ?? `${code} `;
