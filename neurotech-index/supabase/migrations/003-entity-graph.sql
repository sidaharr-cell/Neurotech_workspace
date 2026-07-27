-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 003 — the entity graph and the provenance model (Phase 1)
--
-- Run ONCE in the Supabase SQL editor (Dashboard → SQL Editor → New query),
-- BEFORE running scripts/backfill-graph.js, which populates the edges this
-- migration creates.
--
-- Everything here is ADDITIVE. No existing column is dropped or altered, so the
-- live site keeps working. Two things are added:
--   1. A provenance block on every entity table (source, source_id, source_url,
--      first_seen, last_updated, pipeline_version), backfilled from the columns
--      that already carry that information.
--   2. The graph: a `relationships` edge table for the typed inter-entity links,
--      plus `regulatory_records` and `maude_records` as first-class entities
--      that hang off a device.
--
-- Design note on the edge table. The spec suggests join tables. This schema has
-- no existing join tables to match, and the entities are heterogeneous (trials
-- live inside news_feed; people are split between the researchers table and
-- author strings on papers). Eleven near-identical two-column join tables would
-- not model that cleanly. A single typed, polymorphic `relationships` table with
-- a CHECK-constrained predicate is the honest relational fit, and it carries the
-- confidence value and per-edge provenance the spec asks for. regulatory_records
-- and maude_records are NOT edges — they are real records with their own fields,
-- so they get their own tables with a real FK to devices.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ── 1. Provenance block on every entity table ───────────────────────────────
-- source            arxiv | biorxiv | pubmed | clinicaltrials | openfda |
--                   patentsview | airtable | derived | manual  (free text; not
--                   constrained, because a row may predate a known source)
-- source_id         the native identifier (arXiv id, DOI, PMID, NCT, K/PMA no.)
-- source_url        the canonical external link
-- first_seen        when the row first entered NeuroBase
-- last_updated      when ingestion last touched the row
-- pipeline_version  the ingestion/backfill version that last wrote the row
--
-- Some of these already exist on some tables (papers.source, patents.source,
-- news_feed.source). `add column if not exists` is a no-op for those, so this is
-- safe to run as-is. Adding a column with a `default now()` is metadata-only in
-- Postgres 11+ (no table rewrite), so this is fast even on the fat papers and
-- patents tables. Existing rows get the migration-time now() for the timestamps.

do $$
declare t text;
begin
  foreach t in array array['papers', 'devices', 'organizations', 'researchers', 'news_feed', 'patents']
  loop
    execute format('alter table %I add column if not exists source text', t);
    execute format('alter table %I add column if not exists source_id text', t);
    execute format('alter table %I add column if not exists source_url text', t);
    execute format('alter table %I add column if not exists first_seen timestamptz default now()', t);
    execute format('alter table %I add column if not exists last_updated timestamptz default now()', t);
    execute format('alter table %I add column if not exists pipeline_version text', t);
  end loop;
end $$;

-- NOTE: filling source_url / source_id / etc. from the columns that already hold
-- that information (url, pubmed_id, product_code, ...) is a per-row backfill.
-- On papers (~84k) and patents (~47k) a single full-table UPDATE rewrites every
-- row and exceeds the SQL editor's upstream timeout, so it is deliberately NOT
-- done here. Run it from the terminal instead, batched and idempotent:
--     node --env-file=.env scripts/backfill-provenance.js
-- Until then existing rows carry the migration-time first_seen/last_updated and
-- null source_url; new rows written by refresh.js/trials.js are fully stamped.

-- ── 2. RegulatoryRecord ─────────────────────────────────────────────────────
-- A cleared/approved regulatory decision for a device. Sourced from openFDA.
-- pathway is the FDA route; number is the K/PMA/DEN number. Its own provenance.
create table if not exists regulatory_records (
  id            uuid primary key default gen_random_uuid(),
  device_id     uuid references devices(id) on delete cascade,
  pathway       text,          -- 510(k) | PMA | De Novo | Breakthrough Device | HDE
  decision_date text,          -- YYYY or YYYY-MM-DD as available
  number        text,          -- K number, PMA number, or De Novo (DEN) number
  source        text default 'openfda',
  source_url    text,          -- the accessdata.fda.gov record
  first_seen    timestamptz default now(),
  last_updated  timestamptz default now(),
  pipeline_version text,
  created_at    timestamptz default now()
);
create index if not exists regulatory_device on regulatory_records(device_id);
-- NULLS NOT DISTINCT (Postgres 15+) so a device with an unparseable number gets
-- exactly one null-numbered record, not a fresh duplicate on every backfill run.
create unique index if not exists regulatory_device_number
  on regulatory_records(device_id, number) nulls not distinct;

-- ── 3. MAUDERecord ──────────────────────────────────────────────────────────
-- A single MAUDE adverse-event report for a device. Left EMPTY by Phase 1;
-- MAUDE is not yet ingested. This is a linked count with sources, never a
-- verdict (MAUDE is noisy and self-reported). raw_report keeps the source row.
create table if not exists maude_records (
  id               uuid primary key default gen_random_uuid(),
  device_id        uuid references devices(id) on delete cascade,
  report_date      text,
  event_type       text,       -- e.g. Malfunction | Injury | Death (as reported)
  device_identifier text,      -- brand/generic name or FDA report key
  raw_report       jsonb default '{}',
  source           text default 'openfda',
  source_url       text,
  first_seen       timestamptz default now(),
  last_updated     timestamptz default now(),
  pipeline_version text,
  created_at       timestamptz default now()
);
create index if not exists maude_device on maude_records(device_id);

-- ── 4. The typed relationship edge table ────────────────────────────────────
-- One row per directed, typed link between two entities. subject/object are
-- (kind, id) pairs; kind names the table the id lives in ('news_feed' for a
-- trial, since trials live there). predicate is a controlled vocabulary matching
-- the Phase 1 relationship list. confidence is 0..1 (a derived name-match edge is
-- lower confidence than one read straight from a source field). Each edge carries
-- its own provenance so the dossier can cite how a link was established.
create table if not exists relationships (
  id            uuid primary key default gen_random_uuid(),
  subject_type  text not null,   -- papers | devices | organizations | researchers | news_feed | regulatory_records | maude_records
  subject_id    uuid not null,
  predicate     text not null,
  object_type   text not null,
  object_id     uuid not null,
  confidence    real default 1.0,
  note          text,            -- how the edge was derived, human-readable
  source        text,            -- 'derived' for name-matched, or a data source
  first_seen    timestamptz default now(),
  last_updated  timestamptz default now(),
  pipeline_version text,
  created_at    timestamptz default now(),
  constraint relationships_predicate_ck check (predicate in (
    'evaluates',        -- paper      -> device
    'authored_by',      -- paper      -> researcher (person)
    'affiliated_with',  -- researcher -> organization
    'made_by',          -- device     -> organization
    'studies',          -- trial      -> device
    'sponsored_by',     -- trial      -> organization
    'cites',            -- paper      -> paper
    'replicates',       -- paper      -> paper
    'contradicts',      -- paper      -> paper
    'cleared_via',      -- device     -> regulatory_record
    'has_adverse_event' -- device     -> maude_record
  ))
);

-- No duplicate edges; fast traversal both directions.
create unique index if not exists relationships_uniq
  on relationships(subject_type, subject_id, predicate, object_type, object_id);
create index if not exists relationships_subject
  on relationships(subject_type, subject_id, predicate);
create index if not exists relationships_object
  on relationships(object_type, object_id, predicate);

-- ── 5. Row-level security (read-only for the anon key, like every other table) ─
alter table regulatory_records enable row level security;
alter table maude_records      enable row level security;
alter table relationships      enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'regulatory_records' and policyname = 'public read regulatory_records')
    then create policy "public read regulatory_records" on regulatory_records for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename = 'maude_records' and policyname = 'public read maude_records')
    then create policy "public read maude_records" on maude_records for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename = 'relationships' and policyname = 'public read relationships')
    then create policy "public read relationships" on relationships for select using (true); end if;
end $$;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- select count(*) filter (where source_url is not null) as with_url, count(*) from devices;
-- select predicate, count(*) from relationships group by predicate order by 2 desc;
-- select count(*) from regulatory_records;
