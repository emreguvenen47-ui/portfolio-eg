-- Portfolio EG — public launch migration bundle.
--
-- Run the files below in this order against a fresh Supabase project. Each is
-- idempotent (`create table if not exists`, `create index if not exists`), so
-- re-running the bundle after adding a table is safe.
--
--   1. data/ai-portfolios.sql
--   2. data/virtual-portfolios.sql
--   3. data/alerts.sql
--   4. data/job-snapshots.sql
--   5. data/saved-screens.sql
--
-- Every one of them ends with an explicit grant to service_role. Row-level
-- security is enabled with no policy, which refuses *every* request including
-- the service role's, so the grant is not optional — without it the tables
-- exist and nothing can read them.
--
--
-- INDEX AUDIT
--
-- Checked against the queries the interactive pages actually issue, not
-- against the columns that looked indexable:
--
--   ai_portfolios      list: order by created_at desc
--                      → ai_portfolios_created_at_idx            covered
--   virtual_portfolios list: order by created_at desc
--                      → virtual_portfolios_created_at_idx       covered
--   alert_rules        evaluation: where enabled
--                      → alert_rules_enabled_idx (partial)       covered
--   alert_events       log: order by at desc limit 50
--                      → alert_events_at_idx                     covered
--   job_snapshots      series: where ticker = $1 order by captured_at
--                      → job_snapshots_ticker_idx (composite)    covered
--   saved_screens      list: order by updated_at desc
--                      → saved_screens_updated_idx               covered
--
-- Single-row reads are all on the primary key. No index is added here, because
-- none is justified by a real query pattern — adding one anyway would cost
-- write throughput to serve a query nobody makes.
--
-- On `select *`: these tables are document-shaped, with the jsonb payload
-- being the record rather than an attachment to it. A narrower projection
-- would return objects the row mappers cannot rebuild, so the wide select is
-- the correct read here rather than an oversight.


-- Optional: confirm the bundle landed. Should return six rows.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'ai_portfolios',
    'virtual_portfolios',
    'alert_rules',
    'alert_events',
    'job_snapshots',
    'saved_screens'
  )
order by table_name;
