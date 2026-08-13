-- Saved custom screens. One row per named screen.
--
-- A screen is the question, never the answer. The universe filters, the
-- criteria and the chosen columns are stored; matches are not, because a
-- result set is stale within the hour and replaying it under today's date
-- would misrepresent it as current. Opening a saved screen re-runs it.
--
-- `pool`, `criteria` and `columns` are jsonb rather than child tables: the
-- criterion shape changes whenever a metric or comparison basis is added, and
-- a document column absorbs that without a migration. Nothing joins against
-- their internals, so the usual argument for normalising does not apply.

create table if not exists saved_screens (
  id          uuid        primary key,
  name        text        not null,
  pool        jsonb       not null default '{}'::jsonb,
  combinator  text        not null default 'AND',
  criteria    jsonb       not null default '[]'::jsonb,
  columns     jsonb       not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint saved_screens_combinator_known check (combinator in ('AND', 'OR'))
);

create index if not exists saved_screens_updated_idx
  on saved_screens (updated_at desc);

alter table saved_screens enable row level security;

-- Row-level security with no policy refuses every request, including the
-- service role's, so grant it explicitly. The anon key is deliberately not
-- granted: these rows are reachable only through the server, never from the
-- browser. Every call in this app is server-side, so set
-- SUPABASE_SERVICE_ROLE_KEY in the environment and the app reaches the table
-- without any policy at all.
grant usage on schema public to service_role;
grant select, insert, update, delete on saved_screens to service_role;
