-- Per-account settings and holdings.
--
-- These two carry the most personal data in the app: what you own, and how you
-- want it measured. Both are one row per account, enforced by a unique
-- constraint on user_id rather than by the application remembering to upsert —
-- a second row would be silently invisible and read as data loss.
--
-- Run after data/auth-multiuser.sql. Idempotent.


-- ---------------------------------------------------------------------- settings

create table if not exists settings (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  value      jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table settings enable row level security;

grant select, insert, update, delete on settings to authenticated;

drop policy if exists settings_owner on settings;
create policy settings_owner on settings
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- -------------------------------------------------------------------- portfolios
--
-- `positions` is jsonb rather than a child table because the parsed workbook
-- is the record: rows are never queried individually, only loaded whole, and
-- the column set changes whenever a new instrument type is supported.

create table if not exists portfolios (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  name       text        not null default 'Portfolio',
  meta       jsonb       not null default '{}'::jsonb,
  positions  jsonb       not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One portfolio per account. The upsert on the write path targets this
-- constraint; without it a re-upload would append rather than replace and the
-- app would keep reading the older row.
create unique index if not exists portfolios_user_key on portfolios (user_id);

alter table portfolios enable row level security;

grant select, insert, update, delete on portfolios to authenticated;

drop policy if exists portfolios_owner on portfolios;
create policy portfolios_owner on portfolios
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- ------------------------------------------------------------------------ verify

select
  c.relname        as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.polname) as policies
from pg_class c
left join pg_policy p on p.polrelid = c.oid
where c.relname in ('settings', 'portfolios')
group by c.relname, c.relrowsecurity
order by c.relname;
