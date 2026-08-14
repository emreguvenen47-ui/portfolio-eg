-- Shared cache for assembled market data.
--
-- WHAT THIS FIXES: on Vercel the filesystem is read-only apart from /tmp, and
-- /tmp belongs to one serverless instance and disappears with it. The scanner
-- had climbed past a thousand companies and was back to zero after a deploy,
-- because hours of rate-limited provider calls lived somewhere that does not
-- survive. This is the only durable store available, so this is where it goes.
--
-- NOT USER DATA. Every row is a fact about a public company, assembled from
-- public filings and market feeds. It is deliberately shared: a hundred people
-- looking at the same listing should cost one set of upstream calls, not a
-- hundred. That is also why it uses the service role rather than a per-user
-- policy — there is no owner to scope it to.
--
-- Safe to truncate at any time. It rebuilds, slowly.

create table if not exists market_cache (
  -- "scanner" | "screener" — which assembled shape this row holds.
  kind       text        not null,
  symbol     text        not null,
  payload    jsonb       not null,
  updated_at timestamptz not null default now(),

  primary key (kind, symbol)
);

-- The sweep reads "everything of this kind newer than X" on boot, and that is
-- the only query shape here.
create index if not exists market_cache_kind_updated_idx
  on market_cache (kind, updated_at desc);

alter table market_cache enable row level security;

-- Server-side only, and no per-user policy: this table has no owner. The anon
-- key is not granted, so nothing reaches it from a browser.
grant usage on schema public to service_role;
grant select, insert, update, delete on market_cache to service_role;


-- ------------------------------------------------------------------ verify

select
  kind,
  count(*)          as rows,
  max(updated_at)   as newest
from market_cache
group by kind
order by kind;
