-- Daily job-board snapshots. Run in the Supabase SQL editor.
--
-- A job board is a level; the signal is its change, which only exists if
-- earlier counts were stored. One row per ticker per day — `captured_on` is
-- generated from the timestamp so a client cannot sidestep the constraint by
-- sending a different date, and a same-day re-render updates rather than
-- accumulating.

create table if not exists job_snapshots (
  id           uuid        primary key,
  ticker       text        not null,
  company      text        not null default '',
  total        integer     not null default 0,
  -- Counts per deterministic category (AI/ML, Software/Engineering, ...).
  by_category  jsonb       not null default '{}'::jsonb,
  source       text        not null default '',
  captured_at  timestamptz not null default now(),
  captured_on  date        generated always as ((captured_at at time zone 'UTC')::date) stored
);

create unique index if not exists job_snapshots_one_per_day_idx
  on job_snapshots (ticker, captured_on);

create index if not exists job_snapshots_ticker_idx
  on job_snapshots (ticker, captured_at desc);

alter table job_snapshots enable row level security;


-- Congressional disclosures. Populated only once a structured source is
-- registered; the table exists so the provider has somewhere to land.
--
-- Transaction date and disclosure date are separate NOT NULL columns because
-- the lag between them is the defining property of this data, and a row that
-- lost one of them would be misleading rather than merely incomplete.

create table if not exists congress_trades (
  id                   uuid        primary key,
  politician           text        not null,
  chamber              text        not null,
  ticker               text        not null,
  issuer               text,
  side                 text        not null check (side in ('BUY', 'SELL')),
  transaction_date     date        not null,
  disclosure_date      date        not null,
  -- Disclosed as a range by law, never an exact figure.
  value_low            double precision,
  value_high           double precision,
  source_url           text,
  source_provider      text        not null default '',
  created_at           timestamptz not null default now(),
  disclosure_lag_days  integer     generated always as (disclosure_date - transaction_date) stored
);

-- The same filing often arrives from more than one mirror.
create unique index if not exists congress_trades_dedupe_idx
  on congress_trades (politician, ticker, transaction_date, side, coalesce(value_low, -1));

create index if not exists congress_trades_recent_idx
  on congress_trades (transaction_date desc);

create index if not exists congress_trades_ticker_idx
  on congress_trades (ticker, transaction_date desc);

alter table congress_trades enable row level security;


-- Per-member performance, computed by this app from real historical prices
-- rather than taken from any provider.
--
-- Two sets of figures on purpose: `trade_date_*` is what the member got, and
-- `disclosure_date_*` is what someone following the public filing could have
-- got. The gap between them is the value of the disclosure lag.

create table if not exists congress_member_stats (
  politician            text        primary key,
  chamber               text        not null default '',
  sample                integer     not null default 0,
  hit_rate_vs_spy       double precision,
  median_lag_days       integer,
  trade_date_excess     jsonb       not null default '{}'::jsonb,
  disclosure_date_excess jsonb      not null default '{}'::jsonb,
  best_trade            jsonb,
  worst_trade           jsonb,
  computed_at           timestamptz not null default now()
);

alter table congress_member_stats enable row level security;

-- TABLE PRIVILEGES
--
-- Enabling RLS controls which *rows* a role may touch; it does not grant the
-- table privileges themselves. `service_role` bypasses RLS but still needs
-- SELECT/INSERT/UPDATE/DELETE, and on projects where the default privileges
-- were not inherited it has none — PostgREST then answers 42501 "permission
-- denied" even with a valid secret key. These grants are what make the
-- server-side key actually work.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.job_snapshots, public.congress_trades, public.congress_member_stats to service_role;

-- NOTE ON ACCESS
--
-- RLS is enabled above with no policies, which refuses every key except the
-- service role. That is deliberate for private data: adding an anon-key policy
-- would expose these rows to anyone holding the public key, which ships to the
-- browser. Every call in this app is server-side, so set
-- SUPABASE_SERVICE_ROLE_KEY in the environment and the app reaches the tables
-- without any policy at all.
