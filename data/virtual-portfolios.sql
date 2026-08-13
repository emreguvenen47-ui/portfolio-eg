-- Virtual (paper) portfolios. Run once in the Supabase SQL editor.
--
-- The trade ledger lives in a JSONB array on the portfolio row rather than in
-- a child table. Same reasoning as ai_portfolios: a paper book is read and
-- written whole on every operation, the app never queries across portfolios
-- ("all BUYs of NVDA anywhere"), and a single-row upsert cannot half-succeed
-- the way a portfolio insert plus a trades insert can. Promote `trades` to its
-- own table when cross-portfolio trade analytics become a real requirement.
--
-- Nothing here places an order. This is a simulation ledger.

create table if not exists virtual_portfolios (
  id                      uuid        primary key,
  name                    text        not null,
  currency                text        not null default 'USD',
  -- Uninvested cash, moved by every trade. May go negative if the ledger is
  -- edited out of order, so it is deliberately not constrained.
  cash                    double precision not null default 0,
  -- Cash deposited at creation — the denominator for total return.
  initial_cash            double precision not null default 0,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  -- Trade[]: individual lots, never netted. Averaging on write would destroy
  -- the per-lot cost basis that FIFO realised P&L is computed from.
  trades                  jsonb       not null default '[]'::jsonb,
  -- Set when this book was seeded from a saved AI portfolio.
  source_ai_portfolio_id  uuid        references ai_portfolios (id) on delete set null
);

create index if not exists virtual_portfolios_created_at_idx
  on virtual_portfolios (created_at desc);

alter table virtual_portfolios enable row level security;

-- TABLE PRIVILEGES
--
-- Enabling RLS controls which *rows* a role may touch; it does not grant the
-- table privileges themselves. `service_role` bypasses RLS but still needs
-- SELECT/INSERT/UPDATE/DELETE, and on projects where the default privileges
-- were not inherited it has none — PostgREST then answers 42501 "permission
-- denied" even with a valid secret key. These grants are what make the
-- server-side key actually work.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.virtual_portfolios to service_role;

-- NOTE ON ACCESS
--
-- RLS is enabled above with no policies, which refuses every key except the
-- service role. That is deliberate for private data: adding an anon-key policy
-- would expose these rows to anyone holding the public key, which ships to the
-- browser. Every call in this app is server-side, so set
-- SUPABASE_SERVICE_ROLE_KEY in the environment and the app reaches the tables
-- without any policy at all.
