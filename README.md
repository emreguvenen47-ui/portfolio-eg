# Portfolio EG

A private investment research terminal. Portfolio analytics, an opportunity
scanner over the full US listing, a custom screener, sector rotation, and
company research assembled from public filings.

Next.js 16 · React 19 · TypeScript · TailwindCSS 4.

---

## What it does

**Your portfolio** — positions, risk decomposition, performance attribution,
rebalancing, stress tests, currency exposure, alerts, paper trading.

**Finding things** — an opportunity scanner that ranks companies against their
own sector, a custom screener with ~55 filterable metrics and sector-relative
thresholds, and sector rotation across eleven sectors and ten sub-sectors.

**Research** — financial statements, insider activity, institutional holdings,
analyst coverage, ETF holdings, congressional trading, government contracts.

---

## The rule this codebase is built around

**Missing data is reported as missing.** Not as zero, not as an estimate, not
as a plausible-looking placeholder.

You will see `N/A` in this app more than in a commercial terminal. That is
deliberate. A screener that admits a company because its EV/EBITDA is unknown
is worse than one that returns fewer rows, because it looks the same as one
that worked. Everywhere a number could not be sourced, the interface says so
and usually says why.

Two consequences worth knowing before you use it:

- **Coverage is stated, always.** Scores are computed from the metrics that
  exist and the denominator is shown (`coverage 6/8`). A company with thin data
  is not ranked against one with complete data as though they were comparable.
- **No AI runs on its own.** Every model call is behind an explicit button. The
  app never spends your API budget because you opened a page.

---

## Setup

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local     # fill in what you have; all keys are optional
npm run dev
```

Open http://localhost:3000.

### API keys

Every key is optional and the app boots without any of them, but coverage
depends on them. See `.env.example` for what each one unlocks.

| Key | Free tier | Without it |
|---|---|---|
| `FINNHUB_API_KEY` | 60 req/min | No fundamentals — the scanner can filter but not score |
| `TWELVE_DATA_API_KEY` | 800 req/day | Most quotes still work; some indices and FX do not |
| `ANTHROPIC_API_KEY` | paid | AI features say the key is missing; nothing else changes |

`FINNHUB_API_KEY` is the one that matters. Get it at
[finnhub.io/register](https://finnhub.io/register).

### Your portfolio

The portfolio pages read an `.xlsx` workbook. There is none in this package —
holdings are personal data and are not distributed.

Add yours either way:

- upload it on the **Settings** page, or
- set `PORTFOLIO_FILE` in `.env.local` to a path.

Everything that does not depend on your holdings — scanner, screener, sector
flows, company research — works without a workbook.

### Persistence (optional)

Saved screens, paper portfolios and alerts fall back to a local file under
`data/.dev-store/`, which is fine on one machine but does not survive a deploy.

For real persistence, create a [Supabase](https://supabase.com) project, set
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, then run the
migrations in the order listed at the top of `data/public-launch.sql`.

Note the grants at the bottom of each migration. Row-level security is enabled
with no policy, which refuses every request including the service role's — the
grant is not optional.

---

## How coverage accumulates

The scanner covers the full tradable US listing (~4,800 companies with
meaningful volume, out of ~7,400 listed). Each company needs several metered
provider calls to assemble, so the listing fills in over time rather than at
once.

- Results render from whatever is already assembled; nothing blocks on a fetch.
- The rest goes to a background queue, drawn only from what you are actually
  looking at plus a low-priority walk through the listing.
- Progress is written to `data/.cache/` and survives restarts. The counter in
  the scanner header only goes up.

At the Finnhub free tier this works out to roughly **14 companies per minute**,
so a complete first pass takes about five hours of the app being open. It
resumes where it left off; it never starts over.

Delete `data/.cache/` to force a rebuild.

---

## Commands

```bash
npm run dev      # development server
npm run build    # production build
npm start        # serve the production build
npx vitest run   # tests
npx tsc --noEmit # typecheck
```

---

## Deploying

Any Node host works — Vercel, Railway, Fly, a container, a VPS.

Two things to get right:

1. **Set the env vars in the host's own secret store.** Never commit
   `.env.local`; never give a secret a `NEXT_PUBLIC_` prefix, which ships it to
   the browser.
2. **Run the Supabase migrations before first boot.** In production the app
   refuses to fall back to local disk — a fallback that silently loses data on
   the next container is worse than an error.

`data/.cache/` is a cache. A fresh container starts with an empty one and
refills it; nothing breaks, the scanner is just sparse for a while.

---

## Data sources

Public and free: SEC EDGAR (filings, 13F, insider transactions), Yahoo Finance,
Nasdaq, CNBC, FRED, State Street (ETF holdings), USAspending (federal
contracts), Greenhouse (job postings). Finnhub and Twelve Data are used under
their free tiers.

Anything a source does not carry is shown as unavailable with the reason
stated, rather than filled in from somewhere less reliable.

---

## Not investment advice

A research tool. Fair value is a model-implied range, not a price target.
Congressional and 13F data are delayed public filings. Nothing here places an
order, and paper trading is exactly that.
