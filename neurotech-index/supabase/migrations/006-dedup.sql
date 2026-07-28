-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 006 — preprint deduplication (Phase 6)
--
-- Run ONCE in the Supabase SQL editor. Fast (two nullable columns + one index).
--
-- A paper can enter the index up to three times: an arXiv preprint, a bioRxiv
-- preprint, and the peer-reviewed published version. This collapses them into a
-- single canonical record with a version history.
--   canonical_id  NULL  => this row is canonical (or standalone), shown normally
--                 set   => this row was merged into canonical_id and is hidden
--   versions      on the canonical row: [{source, source_id, url, year,
--                 peer_reviewed}] for every merged version, newest/published first
--
-- scripts/dedup-papers.js fills these, conservatively and with a reversible log.
-- ═══════════════════════════════════════════════════════════════════════════

alter table papers add column if not exists canonical_id uuid references papers(id) on delete set null;
alter table papers add column if not exists versions jsonb default '[]';

-- Listings filter on canonical_id IS NULL; this partial index keeps that fast on
-- the fat papers table without indexing the (rare) merged rows.
create index if not exists papers_canonical_null on papers(id) where canonical_id is null;
