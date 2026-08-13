-- Multi-user isolation.
--
-- Run this AFTER the five table migrations. It does three things to every
-- user-owned table: adds an owner column, points it at auth.users, and
-- replaces the blanket service_role grant with row-level policies keyed to
-- auth.uid().
--
-- WHY THE POLICIES ARE THE BOUNDARY, not the application code:
--
-- The app previously reached Supabase with the service-role key, which
-- bypasses RLS entirely. Under that arrangement isolation would rest on every
-- query remembering `.eq("user_id", …)`, and one forgotten filter — in a query
-- written a year from now — silently returns everybody's rows. With these
-- policies the database refuses, so the worst case of a missing filter is an
-- empty result rather than a leak.
--
-- The application now connects with the anon key plus the caller's JWT for
-- user-owned tables. Public reference data (congress_trades, job_snapshots)
-- still uses service_role because it belongs to nobody.
--
-- Idempotent: safe to re-run.


-- ---------------------------------------------------------------- ai_portfolios

alter table ai_portfolios
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists ai_portfolios_user_idx on ai_portfolios (user_id, created_at desc);

alter table ai_portfolios enable row level security;

-- Revoke the bypass-shaped grant: nothing should reach these rows without a
-- JWT identifying the owner.
revoke all on ai_portfolios from service_role;
grant select, insert, update, delete on ai_portfolios to authenticated;

drop policy if exists ai_portfolios_owner on ai_portfolios;
create policy ai_portfolios_owner on ai_portfolios
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- ----------------------------------------------------------- virtual_portfolios

alter table virtual_portfolios
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists virtual_portfolios_user_idx
  on virtual_portfolios (user_id, created_at desc);

alter table virtual_portfolios enable row level security;

revoke all on virtual_portfolios from service_role;
grant select, insert, update, delete on virtual_portfolios to authenticated;

drop policy if exists virtual_portfolios_owner on virtual_portfolios;
create policy virtual_portfolios_owner on virtual_portfolios
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- ------------------------------------------------------------------ alert_rules

alter table alert_rules
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists alert_rules_user_idx on alert_rules (user_id, enabled);

alter table alert_rules enable row level security;

revoke all on alert_rules from service_role;
grant select, insert, update, delete on alert_rules to authenticated;

drop policy if exists alert_rules_owner on alert_rules;
create policy alert_rules_owner on alert_rules
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- ----------------------------------------------------------------- alert_events
--
-- A fire belongs to whoever owns the rule that produced it. Carrying user_id
-- directly rather than joining through alert_rules keeps the policy a single
-- column comparison, which is what makes it cheap enough to sit on every read.

alter table alert_events
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists alert_events_user_idx on alert_events (user_id, at desc);

alter table alert_events enable row level security;

revoke all on alert_events from service_role;
grant select, insert, update, delete on alert_events to authenticated;

drop policy if exists alert_events_owner on alert_events;
create policy alert_events_owner on alert_events
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- ----------------------------------------------------------------- saved_screens

alter table saved_screens
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists saved_screens_user_idx on saved_screens (user_id, updated_at desc);

alter table saved_screens enable row level security;

revoke all on saved_screens from service_role;
grant select, insert, update, delete on saved_screens to authenticated;

drop policy if exists saved_screens_owner on saved_screens;
create policy saved_screens_owner on saved_screens
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- ------------------------------------------------------- orphaned rows, if any
--
-- Rows written before this migration have user_id = null and are unreachable
-- under the policies above — by design, because there is no way to know who
-- they belonged to. Claim them for one account by running, with that account's
-- id from auth.users:
--
--   update ai_portfolios      set user_id = '<uuid>' where user_id is null;
--   update virtual_portfolios set user_id = '<uuid>' where user_id is null;
--   update alert_rules        set user_id = '<uuid>' where user_id is null;
--   update alert_events       set user_id = '<uuid>' where user_id is null;
--   update saved_screens      set user_id = '<uuid>' where user_id is null;
--
-- Then make the column mandatory so nothing can be written unowned again:
--
--   alter table ai_portfolios      alter column user_id set not null;
--   alter table virtual_portfolios alter column user_id set not null;
--   alter table alert_rules        alter column user_id set not null;
--   alter table alert_events       alter column user_id set not null;
--   alter table saved_screens      alter column user_id set not null;


-- ------------------------------------------------------------------ verify
--
-- Every user-owned table should report rowsecurity = true and exactly one
-- policy. A table listed with no policy is open to nobody; a table missing
-- from this list has no RLS and is open to everybody.

select
  c.relname                                   as table_name,
  c.relrowsecurity                            as rls_enabled,
  count(p.polname)                            as policies
from pg_class c
left join pg_policy p on p.polrelid = c.oid
where c.relname in (
  'ai_portfolios', 'virtual_portfolios', 'alert_rules', 'alert_events', 'saved_screens'
)
group by c.relname, c.relrowsecurity
order by c.relname;
