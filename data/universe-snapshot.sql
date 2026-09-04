-- Canonical opportunity/screener universe — production-safe persistent store.
-- One row holds the full precomputed table; serverless deploys hydrate from
-- it on cold boot and every sweep/priority-refresh writes through to it.
-- Paste into the Supabase SQL editor (same convention as the other files here).
create table if not exists public.universe_snapshot (
  id text primary key,
  rows jsonb not null,
  row_count integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.universe_snapshot enable row level security;
-- Server-side service-role access only; no anon policies on purpose.
