-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 011 — the frontier record layer (Potential Impact, Phase 1)
--
-- NOT YET RUN. Apply in the Supabase SQL editor (Dashboard → SQL Editor → New
-- query), BEFORE running scripts/backfill-frontier-records.js, which populates
-- the tables this migration creates.
--
-- Everything here is ADDITIVE. Three new tables, no existing column touched.
--
-- WHAT THIS IS FOR. Potential-impact scoring never asks the model whether an
-- item is important. It asks whether the item beats a specific recorded value on
-- a specific axis. This is where those recorded values live. Without it the rest
-- of the system has nothing to compare against and collapses back into the
-- vocabulary matching the rebuild exists to remove. See
-- docs/neurobase-potential-impact-build-spec-v1.0.md sections 3.1 and 7.1.
--
-- TWO KINDS OF CHANGE, TWO MECHANISMS. They are easy to confuse and they mean
-- different things:
--
--   superseded_by   the frontier MOVED. A new item beat this record's value, so
--                   a new row is written and the old one points forward to it.
--                   The old row is never edited and never deleted: historical
--                   scores were computed against it and must stay reproducible.
--
--   record_version  the record itself was CORRECTED. Same frontier, restated
--                   value, fixed units, revised confidence. The row is updated
--                   in place, the version bumps, and every field change is
--                   appended to frontier_record_changes.
--
-- Spec section 3.1: "Record revisions change historical scores. Records carry
-- record_version and a change log so that is traceable." The change log is that
-- traceability, which is why it is a real table and not a jsonb blob.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ── 1. FrontierRecord ───────────────────────────────────────────────────────
-- subfield is derived from the facet columns by src/lib/subfields.js, so it can
-- never disagree with an item's stored facets. It is NOT constrained to a value
-- list here: the spec calls the partition "versioned data, not code", and a
-- CHECK constraint would make every partition revision a migration. The backfill
-- script validates against SUBFIELD_IDS and refuses unknown values, and
-- partition_version records which revision of the rules produced the value.
create table if not exists frontier_records (
  id                uuid primary key default gen_random_uuid(),

  subfield          text not null,
  partition_version text,           -- src/lib/subfields.js PARTITION_VERSION

  axis              text not null,  -- 'decoded words per minute, chronic, ALS'
  axis_type         text not null,
  -- Indication is required for evidence records and meaningless for the others.
  -- Evidence axes are per-indication by definition (spec 3.1); the rest describe
  -- a capability, not a disease. Enforced below so the column cannot drift into
  -- being half-populated, which is what makes retrieval unreliable.
  indication        text,
  indication_version text,          -- src/lib/indications.js INDICATION_VERSION

  -- Units live inside the string, per spec 3.1. The backfill script rejects a
  -- value with no unit token rather than trying to encode units as a column:
  -- the axes are too heterogeneous (words/minute, months, channels, microns,
  -- dollars, n) for a single unit vocabulary to be honest.
  current_value     text not null,

  -- ItemRef, polymorphic in the same shape as the relationships edge table:
  -- kind names the table the id lives in ('news_feed' for a trial).
  held_by_type      text,
  held_by_id        uuid,

  established_date  date,
  confidence        text not null default 'claimed-only',

  -- The frontier moved: this record was beaten by another. Never a hard delete.
  superseded_by     uuid references frontier_records(id) on delete set null,

  record_version    integer not null default 1,
  notes             text,

  -- Provenance block, same shape as every other entity table (migration 003).
  source            text,
  source_url        text,
  first_seen        timestamptz default now(),
  last_updated      timestamptz default now(),
  pipeline_version  text,
  created_at        timestamptz default now(),

  constraint frontier_axis_type_ck check (axis_type in (
    'performance',       -- decoding rate, accuracy, stimulation selectivity
    'longevity',         -- chronic viability, device lifetime
    'invasiveness',      -- surgical burden, reversibility
    'scale',             -- channel count, coverage area, cohort size
    'regulatory',        -- approval class, designation, predicate status
    'manufacturability', -- yield, unit cost, fabrication accessibility
    'cost',              -- procedure cost, reimbursement rate
    'evidence'           -- strongest evidence class for an indication (trials)
  )),
  constraint frontier_confidence_ck check (confidence in (
    'replicated', 'single-group', 'claimed-only'
  )),
  -- Evidence records carry an indication; nothing else does.
  constraint frontier_indication_coherent_ck check (
    (axis_type = 'evidence' and indication is not null)
    or (axis_type <> 'evidence' and indication is null)
  ),
  constraint frontier_version_ck check (record_version >= 1),
  -- A record cannot supersede itself.
  constraint frontier_self_supersede_ck check (superseded_by is distinct from id)
);

-- Query by subfield and axis type is the Phase 1 acceptance criterion and the
-- retrieval step in spec 7.1.2, so it gets a real composite index.
create index if not exists frontier_subfield_axis
  on frontier_records(subfield, axis_type);
create index if not exists frontier_indication
  on frontier_records(indication) where indication is not null;
-- Retrieval only ever wants live records; this is the hot path.
create index if not exists frontier_live
  on frontier_records(subfield) where superseded_by is null;
create index if not exists frontier_held_by
  on frontier_records(held_by_type, held_by_id);

-- NOTE ON "one live record per axis". Two un-superseded records on the same axis
-- is a data error: scoring would compare against whichever row came back first,
-- silently. The obvious guard is
--     create unique index on frontier_records(subfield, axis) where superseded_by is null;
-- and it is deliberately NOT here, because it makes a legitimate supersede
-- impossible to sequence. Superseding is "insert the new record, then point the
-- old one at it". The insert transiently leaves two live rows on the axis and
-- trips the index; doing the update first is worse, because superseded_by has a
-- real foreign key and the new row does not exist yet. PostgREST gives each call
-- its own transaction, so there is no ordering that satisfies both constraints
-- and no deferral available across two HTTP requests.
--
-- Enforced instead where it can be checked without breaking the write path:
-- scripts/backfill-frontier-records.js refuses to write a duplicate live axis,
-- and the query in the Verify block below reports any that appear. This is the
-- same shape-check-over-exit-code approach verify:cron already uses, for the
-- reason docs/funding-data-loss-2026-07-29.md gives.

comment on column frontier_records.superseded_by is
  'The record that beat this one. Set when the frontier MOVES. The superseded '
  'row stays exactly as it was so historical scores stay reproducible.';
comment on column frontier_records.record_version is
  'Bumped when this record is CORRECTED in place. Every field change is '
  'appended to frontier_record_changes.';

-- ── 2. The change log ───────────────────────────────────────────────────────
-- One row per field changed, per revision. Revising a record changes the scores
-- of every item ever compared against it, so "what did this record say when that
-- item was scored" has to be answerable. Append-only by convention: nothing in
-- the codebase updates or deletes from this table.
create table if not exists frontier_record_changes (
  id             uuid primary key default gen_random_uuid(),
  record_id      uuid not null references frontier_records(id) on delete cascade,
  record_version integer not null,     -- the version this change PRODUCED
  field          text not null,        -- column name, or 'created' / 'superseded'
  old_value      text,                 -- null on creation
  new_value      text,
  reason         text,
  changed_by     text,                 -- script name, or a person
  changed_at     timestamptz default now()
);

create index if not exists frontier_changes_record
  on frontier_record_changes(record_id, record_version);

-- ── 3. Record update proposals ──────────────────────────────────────────────
-- HUMAN-GATED. The scorer (Phase 4) proposes record updates; nothing applies
-- itself. Automatic application is cheaper and lets one bad record poison every
-- subsequent comparison in its subfield, which is unrecoverable in the sense
-- that matters: the resulting scores look normal.
--
-- record_id is null when proposing a NEW record rather than a revision.
create table if not exists frontier_record_proposals (
  id             uuid primary key default gen_random_uuid(),
  record_id      uuid references frontier_records(id) on delete cascade,

  -- Enough to create a record outright if the proposal is accepted.
  subfield       text not null,
  axis           text not null,
  axis_type      text not null,
  indication     text,
  proposed_value text not null,

  -- The item that triggered the proposal, same polymorphic shape as held_by.
  item_type      text,
  item_id        uuid,

  -- Spec 8 rule 6: a proposal below `demonstrated` is discarded, never queued.
  -- Recorded here so a rejected proposal explains itself in the table.
  evidence_grade text,
  rubric_version text,
  rationale      text,

  status         text not null default 'pending',
  reviewed_by    text,
  reviewed_at    timestamptz,
  review_note    text,
  created_at     timestamptz default now(),

  constraint frontier_proposal_status_ck check (status in ('pending', 'applied', 'rejected')),
  constraint frontier_proposal_axis_type_ck check (axis_type in (
    'performance', 'longevity', 'invasiveness', 'scale',
    'regulatory', 'manufacturability', 'cost', 'evidence'
  )),
  -- A decided proposal names who decided it. An undecided one has no reviewer.
  constraint frontier_proposal_review_ck check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status <> 'pending' and reviewed_by is not null)
  )
);

create index if not exists frontier_proposals_pending
  on frontier_record_proposals(status, created_at) where status = 'pending';
create index if not exists frontier_proposals_record
  on frontier_record_proposals(record_id);

-- ── 4. Row-level security ───────────────────────────────────────────────────
-- Public select, no public write, exactly like every other table. Only the
-- scripts hold the service-role key. Read access is what lets the internal
-- inspection view (spec 9.3) render without a server, which this SPA does not
-- have. The records contain no secrets: they are published field values with
-- sources.
alter table frontier_records           enable row level security;
alter table frontier_record_changes    enable row level security;
alter table frontier_record_proposals  enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'frontier_records' and policyname = 'public read frontier_records')
    then create policy "public read frontier_records" on frontier_records for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename = 'frontier_record_changes' and policyname = 'public read frontier_record_changes')
    then create policy "public read frontier_record_changes" on frontier_record_changes for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename = 'frontier_record_proposals' and policyname = 'public read frontier_record_proposals')
    then create policy "public read frontier_record_proposals" on frontier_record_proposals for select using (true); end if;
end $$;

-- ── 5. The live-record view ─────────────────────────────────────────────────
-- What retrieval (spec 7.1.2) actually reads. Superseded records are excluded
-- here rather than in every caller, so a caller cannot forget and score an item
-- against a frontier that has already moved.
create or replace view frontier_records_live as
  select * from frontier_records where superseded_by is null;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- select subfield, axis_type, count(*) from frontier_records_live group by 1,2 order by 1,2;
-- select count(*) from frontier_records_live where axis_type = 'evidence';
-- select indication, count(*) from frontier_records_live
--   where axis_type = 'evidence' group by 1 order by 2 desc;
--
-- Duplicate live axes. MUST return zero rows; see the note above the indexes.
-- select subfield, axis, count(*) from frontier_records_live
--   group by 1,2 having count(*) > 1;
--
-- Version history for one record:
-- select record_version, field, old_value, new_value, changed_at
--   from frontier_record_changes where record_id = '...' order by record_version, changed_at;
