-- Chart drawings — per user + ticker + timeframe, so a support line drawn on
-- AAPL is still there when the user comes back (survives serverless cold
-- starts, which /tmp does not). Key format: "<userId|anon>:<SYMBOL>:<TF>".
create table if not exists public.chart_drawings (
  key text primary key,
  drawings jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.chart_drawings enable row level security;
-- Server-side service-role access only; no anon policies on purpose.
