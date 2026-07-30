-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 014 — preserve the significance scores the new sort replaces
--
-- NOT YET RUN. Apply in the Supabase SQL editor, then IMMEDIATELY:
--     node --env-file=.env scripts/backfill-legacy-significance.js --commit
--
-- Additive: two nullable columns on news_feed and papers. Nothing is rewritten.
--
-- WHY THIS IS URGENT RATHER THAN MERELY NEEDED. Spec 10.2:
--
--     Preserve stored significance scores in a `legacy_significance` column.
--     Do not delete. They are the comparison surface for evaluating the new
--     sort, and deleting them makes the change unfalsifiable.
--
-- and spec 13 asks for "rank correlation with legacy_significance. Should be
-- positive but weak. Near 1.0 means the rebuild changed nothing."
--
-- The problem is that nothing is preserving them. `relevance_score` is rewritten
-- every night by the 6am cron: scripts/refresh.js writes it on every feed item
-- and paper it touches, and scripts/trials.js recomputes it for every trial. So
-- the baseline the rebuild is supposed to be measured against is drifting nightly
-- and has been since this work started. Each night that passes makes the
-- before/after comparison a little less honest, and no later migration can
-- recover a value that has already been overwritten.
--
-- Snapshot semantics, deliberately. This is not a live mirror of
-- relevance_score. It is a frozen reading taken once, with the date it was
-- taken, so "what did the old sort say" has one unambiguous answer. The backfill
-- refuses to overwrite an existing snapshot unless --force is passed.
-- ═══════════════════════════════════════════════════════════════════════════

alter table news_feed add column if not exists legacy_significance integer;
alter table news_feed add column if not exists legacy_significance_at timestamptz;

-- Papers carry their own ranking (rank_score) rather than relevance_score, and
-- the research sort is the other surface the new sort replaces.
alter table papers add column if not exists legacy_significance real;
alter table papers add column if not exists legacy_significance_at timestamptz;

create index if not exists news_feed_legacy_significance
  on news_feed(legacy_significance) where legacy_significance is not null;
create index if not exists papers_legacy_significance
  on papers(legacy_significance) where legacy_significance is not null;

comment on column news_feed.legacy_significance is
  'Frozen snapshot of relevance_score as it stood before the potential-impact '
  'sort replaced it. Spec 10.2. NOT kept in sync: relevance_score is rewritten '
  'nightly, which is exactly why this snapshot exists. Never delete.';
comment on column papers.legacy_significance is
  'Frozen snapshot of rank_score before the potential-impact sort replaced it. '
  'Spec 10.2. Never delete.';

-- ── Verify ──────────────────────────────────────────────────────────────────
-- select count(*) filter (where legacy_significance is not null) as snapshotted,
--        count(*) from news_feed;
-- select min(legacy_significance_at), max(legacy_significance_at) from news_feed;
-- Has the live score drifted from the snapshot since it was taken?
-- select count(*) from news_feed
--   where legacy_significance is not null and relevance_score <> legacy_significance;
