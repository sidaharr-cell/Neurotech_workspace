-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 002 — covering indexes for the sidebar "Results by year" histogram
--
-- Run ONCE in the Supabase SQL editor.
--
-- The histogram counts in-scope rows per year with one exact count per year.
-- The papers/patents tables are "fat" (MeSH arrays, full-text vectors,
-- abstracts) and bloated from the classification backfills, so a plain count
-- scans slowly and times out. A (in_scope, <year>) covering index lets each
-- single-year count run as an index-only scan — fast and exact — without
-- touching the fat rows. VACUUM ANALYZE sets the visibility map that
-- index-only scans need, and refreshes planner stats.
--
-- An earlier version of this migration created a year_histogram() grouped RPC;
-- the per-year-count approach replaced it, so that function (if present) is now
-- unused and can be dropped:  drop function if exists year_histogram(text, text[], text[], text[]);
--
-- NOTE: no VACUUM here — the Supabase SQL editor runs statements in a
-- transaction, and VACUUM cannot run inside one. Postgres autovacuum maintains
-- the visibility map these index-only scans rely on.
-- ═══════════════════════════════════════════════════════════════════════════

create index if not exists papers_scope_year   on papers    (in_scope, year);
create index if not exists devices_scope_year  on devices   (in_scope, year);
create index if not exists patents_scope_grant on patents   (in_scope, grant_date);
create index if not exists news_scope_pub      on news_feed (in_scope, published_at);
