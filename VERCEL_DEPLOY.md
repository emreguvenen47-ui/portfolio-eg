# Deploying Portfolio EG to Vercel

One URL you can send people. Research is open to anyone; portfolios, alerts,
paper trades and saved screens need an account and are isolated per account.

Do this in order — step 3 must be finished before anyone signs up, because the
row-level policies are what keep accounts apart.

---

## A. Push to GitHub

```bash
cd /path/to/pcc
git init                       # skip if already a repo
git add -A
git commit -m "Portfolio EG"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Before pushing, confirm nothing private is tracked:

```bash
git ls-files | grep -E "\.env|\.xlsx"     # must print nothing
```

`.env.local`, your holdings workbook and `data/.cache/` are gitignored.
`.env.example` is tracked on purpose — it holds names, no values.

A private repository is fine; Vercel can read it once you authorise GitHub.

---

## B. Create the Vercel project

1. [vercel.com/new](https://vercel.com/new)
2. **Import Git Repository** → pick the repo
3. Framework Preset: **Next.js** (detected automatically)
4. Root Directory: leave as `./`
5. Do **not** deploy yet — add the environment variables first (section C),
   otherwise the first build ships without accounts configured.

---

## C. Environment variables

**Project Settings → Environment Variables.** Add each to *Production*,
*Preview* and *Development*.

Required for a public multi-account deployment:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
FINNHUB_API_KEY
```

Optional:

```
TWELVE_DATA_API_KEY
TWELVEDATA_DAILY_BUDGET
ANTHROPIC_API_KEY
RESEND_API_KEY
OWNER_NOTIFY_EMAIL
NOTIFY_FROM_EMAIL
PORTFOLIO_FILE
```

`RESEND_API_KEY` alone turns on the sign-up/sign-in notification; the recipient
defaults to the operator address and `OWNER_NOTIFY_EMAIL` overrides it. The
mail carries the account address, user id, time and IP — never holdings,
alerts, paper trades or saved screens, which stay with the account that owns
them.

Values live in your own `.env.local` and in the Supabase and provider
dashboards. Nothing in this repository contains one.

Two rules:

- Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` carry
  that prefix. Both are public by design — the anon key is what carries a
  signed-in user's token, and isolation comes from the policies in step 3, not
  from keeping it secret.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security. It must never get a
  `NEXT_PUBLIC_` prefix; the app uses it only for reference data nobody owns.

---

## D. Build settings

None. The defaults are correct:

| | |
|---|---|
| Install | `npm install` |
| Build | `next build` |
| Output | `.next` |
| Node | 20.x or 22.x |

Only override these if you have a reason to.

---

## E. Supabase setup

### 1. Run the migrations

**SQL Editor**, in this order:

```
data/ai-portfolios.sql
data/virtual-portfolios.sql
data/alerts.sql
data/job-snapshots.sql
data/saved-screens.sql
data/auth-multiuser.sql      ← adds user_id + RLS policies
data/user-tables.sql         ← settings and portfolios, per account
data/market-cache.sql        ← keeps scanner coverage across deploys
```

The last two are what make this safe to share. `auth-multiuser.sql` ends with a
verification query: every listed table must show `rls_enabled = true` and
`policies = 1`. A table with RLS on and no policy is readable by nobody; a
table missing from that list has no RLS and is readable by everybody. Check the
output before you send anyone the link.

### 2. Auth URLs — after you know the Vercel URL

**Authentication → URL Configuration:**

- **Site URL**: `https://<your-project>.vercel.app`
- **Redirect URLs**, one per line:

```
https://<your-project>.vercel.app/**
https://<your-project>-*.vercel.app/**
```

The second line covers preview deployments, whose subdomain changes with every
push. Skip it and sign-in works in production but fails on previews.

Using a custom domain later? Add it to both fields — Supabase rejects redirects
to any origin not listed, which shows up as sign-in appearing to work and then
dropping the session.

### 3. Email confirmation

**Authentication → Providers → Email.** Confirmation is on by default, which
means a new account gets no session until the link is clicked and the sign-up
form says so. Fine for a public link. Turn it off for a small trusted group and
sign-up signs them straight in.

Supabase's built-in mail is rate-limited and meant for testing. For real
traffic, set up SMTP under **Project Settings → Auth → SMTP**.

---

## F. Deploy, and redeploying after a variable change

First deploy: **Deploy** on the import screen, or push to `main`.

**Environment variables are baked in at build time.** Changing one in the
dashboard does nothing to the running site until you rebuild:

**Deployments → most recent → ⋯ → Redeploy**

Uncheck *Use existing Build Cache* if the change should affect the build
itself. Pushing any commit to `main` also rebuilds.

---

## What to expect on the deployed site

**No local `npm` is needed after this.** Vercel builds and serves; Supabase
holds the data.

**The scanner starts sparse.** Assembling a company costs several metered
provider calls, so the listing fills in as the app is used — roughly fourteen
companies a minute on the Finnhub free tier. The header shows the count.

**That progress is kept in Supabase**, in `market_cache`, so it survives
deploys and instance recycling. Skip `data/market-cache.sql` and the cache
falls back to `/tmp`, which belongs to one serverless instance and is wiped on
every deploy — that is what sends the coverage counter back to zero.

**Provider failures degrade rather than crash.** Each source has a timeout and
a fallback chain; anything unavailable is shown as unavailable with a reason.

---

## Verifying it worked

1. Open the URL signed out — the landing page, with the scanner and screener
   reachable.
2. `/positions` signed out — redirects to `/login`.
3. `curl https://<url>/api/alerts` signed out — `401`, not a 500 and not data.
4. Create an account, upload a workbook on **Settings**, save a screen.
5. Create a *second* account in a private window. It must see none of the
   first account's holdings, alerts or screens. This is the test that matters:
   if it fails, `auth-multiuser.sql` did not run.
6. `https://<url>/robots.txt` — account pages disallowed, research allowed.
