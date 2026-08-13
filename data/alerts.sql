-- Alert rules. One row per user-defined condition.
--
-- `kind` is stored as text rather than a Postgres enum on purpose: the app
-- adds alert kinds regularly, and a text column does not require a migration
-- (and an exclusive lock) every time one appears. The check constraint below
-- documents the current set without blocking a forward-compatible write —
-- drop it if you would rather the database never reject an unknown kind.

create table if not exists alert_rules (
  id         uuid        primary key,
  subject    text        not null,  -- ticker, position code, or bucket name
  kind       text        not null,
  threshold  double precision not null,
  enabled    boolean     not null default true,
  note       text,
  created_at timestamptz not null default now(),

  constraint alert_rules_kind_known check (kind in (
    'price_above', 'price_below', 'pct_move', 'drawdown_from_high',
    'cross_20dma', 'cross_50dma', 'cross_200dma', 'cross_20_50', 'cross_50_200',
    'rsi_above', 'rsi_below', 'breakout_52w', 'volume_spike', 'volatility_spike',
    'weight_above', 'weight_below', 'portfolio_drawdown', 'concentration',
    'currency_exposure'
  ))
);

create index if not exists alert_rules_enabled_idx
  on alert_rules (enabled) where enabled;

alter table alert_rules enable row level security;


-- Alert fires. Append-only log.
--
-- Rules are evaluated on every page render, so the writer de-duplicates to one
-- fire per rule per calendar day. The unique index below enforces that in the
-- database as well: without it, two concurrent renders both read "no fire yet"
-- and both insert. `fired_on` is generated rather than supplied so the
-- constraint cannot be sidestepped by a client sending a different date.

create table if not exists alert_events (
  id        uuid        primary key,
  rule_id   uuid        not null references alert_rules (id) on delete cascade,
  subject   text        not null,
  kind      text        not null,
  detail    text        not null default '',
  -- The measured value behind the fire. Null when the rule triggered on a
  -- condition that has no single number (a cross, say).
  value     double precision,
  at        timestamptz not null default now(),
  fired_on  date        generated always as ((at at time zone 'UTC')::date) stored
);

create unique index if not exists alert_events_one_per_day_idx
  on alert_events (rule_id, fired_on);

create index if not exists alert_events_at_idx
  on alert_events (at desc);

alter table alert_events enable row level security;

-- TABLE PRIVILEGES
--
-- Enabling RLS controls which *rows* a role may touch; it does not grant the
-- table privileges themselves. `service_role` bypasses RLS but still needs
-- SELECT/INSERT/UPDATE/DELETE, and on projects where the default privileges
-- were not inherited it has none — PostgREST then answers 42501 "permission
-- denied" even with a valid secret key. These grants are what make the
-- server-side key actually work.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.alert_rules, public.alert_events to service_role;

-- NOTE ON ACCESS
--
-- RLS is enabled above with no policies, which refuses every key except the
-- service role. That is deliberate for private data: adding an anon-key policy
-- would expose these rows to anyone holding the public key, which ships to the
-- browser. Every call in this app is server-side, so set
-- SUPABASE_SERVICE_ROLE_KEY in the environment and the app reaches the tables
-- without any policy at all.
