# EODHD Capability Map — verified against live API, 2026-09-01

Plan: paid "All World" (100,000 req/day, 500 extra). Key: `EODHD_API_KEY` in
`.env.local`, server-side only.

## Verified working (US)

| Dataset | Endpoint | Notes |
|---|---|---|
| Real-time quote (bulk) | `/real-time/{code}?s=...` | close/prevClose/change/change_p; strings possible → tolerant parse |
| EOD OHLCV | `/eod/{code}` | includes `adjusted_close` (used for returns) |
| Intraday | `/intraday/{code}` | 5m/1h; unix `from` |
| Fundamentals | `/fundamentals/{code}` | ~700KB: General, Highlights, Valuation, SharesStats, Technicals, SplitsDividends, AnalystRatings (counts + target), Holders (20+20), InsiderTransactions, ESG, outstandingShares, Earnings (History/Trend/Annual), Financials (IS/BS/CF, quarterly+yearly, values as strings) |
| Forward estimates | `Earnings.Trend` | EPS avg/low/high, revenue, analyst counts, multi-period |
| News | `/news?s=` | works |
| Sentiment | `/sentiments?s=` | works |
| Dividends / Splits | `/div`, `/splits` | works |
| Screener | `/screener` | works |
| Macro | `/macro-indicator/{ISO}` | works (incl. TUR series) |
| Indices | `GSPC.INDX`, etc. | real-time verified |
| FOREX | `USDTRY.FOREX`, etc. | real-time verified |

## Not available

| Dataset | Status | Fallback |
|---|---|---|
| **Borsa İstanbul (BIST)** | **No IS exchange at ANY plan tier** (verified `/exchanges-list`: 70 exchanges, Turkey absent) | Yahoo remains the BIST source (existing `bist.ts` + pinned provider) |
| Options | 403 (marketplace add-on not in subscription) | Existing `yahoo-options.ts` stays |
| Earnings calendar | Returns empty for tested symbols | `Earnings.History/Trend` from fundamentals covers needs |
| `/technical/*` | Returned empty in test | Irrelevant: Technical Engine computes from raw OHLCV by design |

## Architecture (implemented Phase 1)

- `src/lib/providers/eodhd.ts` — MarketDataProvider (quotes, EOD, intraday,
  FX, indices), FIRST in the chain; declines BIST so the chain falls through.
- `src/lib/data/eodhd/client.ts` — REST client, typed errors, string→number.
- `src/lib/data/eodhd/fundamentals.ts` — fetch + cache (12h) + normalize.
- `src/lib/data/normalize/company.ts` — provider-independent `CompanySnapshot`
  (`pe_ttm`-style names; `meta` carries source/fetchedAt/period/currency/
  confidence/issues; null = N/A, never 0).
- `src/lib/data/validation/company.ts` — Data Integrity Engine: staleness,
  duplicate quarters, impossible margins, share-count × EPS cross-check,
  multiple sanity → HIGH/MEDIUM/LOW/INVALID; `usableForValuation()` gate.

Smoke-tested live: NVDA, MSFT, JPM, MU, AMT, XOM all HIGH confidence with
correct sector classification and plausible TTM math; THYAO.IS → null.
Known data oddity: MU `WallStreetTargetPrice` (1513) looks like an outlier —
Valuation Sanity Engine (Phase 3) must cross-check targets against price.
