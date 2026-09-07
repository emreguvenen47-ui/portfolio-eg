-- Sign-in / sign-up history, per account — day-and-time login log shown on
-- the Settings page. Row-level security keyed to auth.uid() so an account
-- only ever reads its own history, same as every other per-user table here.
create table if not exists public.login_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  event text not null check (event in ('signin', 'signup')),
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists login_events_user_id_created_at_idx
  on public.login_events (user_id, created_at desc);

alter table public.login_events enable row level security;

create policy "read own login history" on public.login_events
  for select using (auth.uid() = user_id);

create policy "insert own login event" on public.login_events
  for insert with check (auth.uid() = user_id);
