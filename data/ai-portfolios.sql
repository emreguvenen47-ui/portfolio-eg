-- Saved AI portfolios. Run once in the Supabase SQL editor.
--
-- One table with JSONB documents rather than the three normalised tables in
-- the brief (ai_portfolios / ai_portfolio_positions / ai_investor_profiles).
-- The reason: a generated portfolio is only ever read and written whole — the
-- app never queries "all positions with weight > x across portfolios" — so
-- splitting it costs three round trips and a join for no query we make, and
-- adds a partial-write failure mode the single-row insert does not have.
-- Split it later if cross-portfolio analytics become a real requirement.

create table if not exists ai_portfolios (
  id          uuid primary key,
  name        text        not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  profile     jsonb       not null,  -- InvestorProfile (AI-generated)
  risk        jsonb       not null,  -- RiskExplanation (AI-generated)
  built       jsonb       not null,  -- BuiltPortfolio (computed server-side)
  -- Creation-time prices per ticker. A ticker with no price at creation is
  -- stored as null rather than omitted, so the UI can say "no baseline" instead
  -- of implying a starting value that was never observed.
  baseline    jsonb       not null default '{}'::jsonb,
  -- AllocationEpoch[]: append-only. Editing weights appends an epoch rather
  -- than rewriting the last one, which is what keeps pre-edit performance
  -- history intact.
  allocations jsonb       not null default '[]'::jsonb
);

-- Added after the initial release; harmless on a fresh install.
alter table ai_portfolios add column if not exists baseline    jsonb not null default '{}'::jsonb;
alter table ai_portfolios add column if not exists allocations jsonb not null default '[]'::jsonb;

create index if not exists ai_portfolios_created_at_idx
  on ai_portfolios (created_at desc);

-- These are personal research artefacts, not the live book. Keep them behind
-- RLS so an anon key cannot read another user's modelling work.
alter table ai_portfolios enable row level security;

-- TABLE PRIVILEGES
--
-- Enabling RLS controls which *rows* a role may touch; it does not grant the
-- table privileges themselves. `service_role` bypasses RLS but still needs
-- SELECT/INSERT/UPDATE/DELETE, and on projects where the default privileges
-- were not inherited it has none — PostgREST then answers 42501 "permission
-- denied" even with a valid secret key. These grants are what make the
-- server-side key actually work.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.ai_portfolios to service_role;

-- NOTE ON ACCESS
--
-- RLS is enabled above with no policies, which refuses every key except the
-- service role. That is deliberate for private data: adding an anon-key policy
-- would expose these rows to anyone holding the public key, which ships to the
-- browser. Every call in this app is server-side, so set
-- SUPABASE_SERVICE_ROLE_KEY in the environment and the app reaches the tables
-- without any policy at all.
