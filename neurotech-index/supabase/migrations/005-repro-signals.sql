-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 005 — reproducibility signals on papers (Phase 5)
--
-- Run ONCE in the Supabase SQL editor. Fast (two nullable columns + no rewrite).
--
-- Structured code/data availability links detected in a paper's title/abstract
-- during ingestion. Populated by scripts/backfill-repro.js for existing rows and
-- by refresh.js going forward. Absent links mean "not found in the abstract",
-- not "no code exists", so the UI shows an indicator only when a link is present.
--
-- Preprint vs peer-reviewed status is derived from the existing `source` column
-- (arxiv/biorxiv = preprint, pubmed = peer-reviewed), so it needs no new column.
-- Contradiction/replication badges read the Phase 1 relationships table.
-- ═══════════════════════════════════════════════════════════════════════════

alter table papers add column if not exists code_urls jsonb default '[]';
alter table papers add column if not exists data_urls jsonb default '[]';
