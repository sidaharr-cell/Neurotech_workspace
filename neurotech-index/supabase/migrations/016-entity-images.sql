-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 016 — sourced images, with provenance and a licence
--
-- Run ONCE in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Fast: all-nullable column adds. No table rewrite, no backfill here.
--
-- Context. Cards used to fall back to generated art when a record had no
-- picture. They now show a photograph when one can be sourced, and the
-- sourcing is a pipeline (scripts/lib/images.js, scripts/backfill-images.js).
-- An image is only worth showing if the page can say where it came from, so
-- every image column arrives with the provenance block beside it.
--
-- Two columns carry the honesty of the thing:
--
--   image_subject  'item'  the picture IS this record: a figure from this
--                          paper, this company's own logo.
--                  'class' the picture is a licensed photograph of the
--                          TECHNOLOGY, not of this exact device or trial.
--                          There is no photograph of an individual 510(k)
--                          submission anywhere, so a spinal cord stimulator
--                          clearance borrows a real photograph of a spinal
--                          cord stimulator. The UI labels these "Illustration"
--                          and prints the credit; without that label the image
--                          would be a claim the record cannot support.
--
--   image_license  the licence string as the source states it (CC BY 4.0,
--                  Public domain, …), with image_credit naming the author.
--                  Attribution is a condition of the CC licences, so a row
--                  without a credit is not shown.
--
-- Nothing is copied onto our own storage: image_url points at the source, and
-- scripts/verify-images.js re-checks it and clears the row when it rots.
-- image_checked_at is when that last happened.
--
-- news_feed (news, papers, trials) keeps its image inside metadata jsonb,
-- where it already lived, using the same key names in camelCase.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── devices ────────────────────────────────────────────────────────────────
alter table devices add column if not exists image_url text;
alter table devices add column if not exists image_kind text;         -- photo | figure | logo | illustration
alter table devices add column if not exists image_subject text;      -- item | class
alter table devices add column if not exists image_credit text;
alter table devices add column if not exists image_license text;
alter table devices add column if not exists image_license_url text;
alter table devices add column if not exists image_source text;       -- commons | wikidata | site | europepmc | biorxiv | og
alter table devices add column if not exists image_source_url text;   -- the page the file is described on
alter table devices add column if not exists image_w integer;
alter table devices add column if not exists image_h integer;
alter table devices add column if not exists image_checked_at timestamptz;

-- ── organizations (image_url already exists, from migration 007) ───────────
alter table organizations add column if not exists image_kind text;
alter table organizations add column if not exists image_subject text;
alter table organizations add column if not exists image_credit text;
alter table organizations add column if not exists image_license text;
alter table organizations add column if not exists image_license_url text;
alter table organizations add column if not exists image_source text;
alter table organizations add column if not exists image_source_url text;
alter table organizations add column if not exists image_w integer;
alter table organizations add column if not exists image_h integer;
alter table organizations add column if not exists image_checked_at timestamptz;

-- ── constraints: an image cannot arrive without its provenance ─────────────
-- A URL with no source, or a licensed file with no credit, is exactly the
-- state that turns into an unattributed image on a public page. The database
-- refuses it rather than trusting every future writer to remember.
alter table devices drop constraint if exists devices_image_provenance;
alter table devices add constraint devices_image_provenance check (
  image_url is null or (image_source is not null and image_subject in ('item', 'class'))
);

alter table organizations drop constraint if exists organizations_image_provenance;
alter table organizations add constraint organizations_image_provenance check (
  image_url is null or (image_source is not null and image_subject in ('item', 'class'))
);

-- ── indexes: the pages ask "which rows still need one" every run ───────────
create index if not exists devices_image_checked_idx on devices (image_checked_at nulls first);
create index if not exists organizations_image_checked_idx on organizations (image_checked_at nulls first);
