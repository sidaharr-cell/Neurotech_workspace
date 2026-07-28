-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 007 — a curated representative image per organization
--
-- Run ONCE in the Supabase SQL editor. Fast (one nullable column).
--
-- image_url holds a link to a REAL, relevant, correctly-licensed photo of the
-- company or its product (for example a device photo or a patient using it). It
-- is intentionally left empty for now: NeuroBase does not auto-scrape or embed
-- arbitrary web images, because that risks copyright infringement and wrong or
-- AI-generated pictures. Populating it is a curation step -- a human supplies a
-- licensed image URL per company. The company page renders the image responsively
-- when this field is set, and shows nothing when it is not.
-- ═══════════════════════════════════════════════════════════════════════════

alter table organizations add column if not exists image_url text;
