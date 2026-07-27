-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 004 — trial status-change log (Phase 7)
--
-- Run ONCE in the Supabase SQL editor. Fast (empty table + indexes + policy).
--
-- Records a dated event every time a tracked field of a clinical trial changes
-- between ingestion runs (for example status "recruiting" -> "active_not_
-- recruiting"). scripts/trials.js writes these on each sync by comparing the new
-- ClinicalTrials.gov pull against the stored row. The trials view reads them for
-- its "Recently changed" list, and Phase 8 (watchlists/digest) subscribes to
-- this log. Trials themselves live in news_feed (entry_type='trial'); nct_id is
-- the stable key across re-ingests, trial_id is the current news_feed row.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

create table if not exists trial_changes (
  id          uuid primary key default gen_random_uuid(),
  nct_id      text not null,
  trial_id    uuid,                         -- current news_feed row, if known
  field       text not null,                -- status | phase | enrollment
  old_value   text,
  new_value   text,
  changed_at  timestamptz default now(),
  source      text default 'clinicaltrials',
  created_at  timestamptz default now()
);

create index if not exists trial_changes_changed on trial_changes(changed_at desc);
create index if not exists trial_changes_nct on trial_changes(nct_id);
-- No unique constraint on purpose: an event is logged only when the new value
-- differs from the stored one, so consecutive syncs never re-log the same
-- change, and a genuine re-transition to an earlier value (recruiting -> active
-- -> recruiting) is a real event that must be recorded, not suppressed.

alter table trial_changes enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'trial_changes' and policyname = 'public read trial_changes')
    then create policy "public read trial_changes" on trial_changes for select using (true); end if;
end $$;
