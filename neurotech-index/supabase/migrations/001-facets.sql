-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 001 — three-facet classification
--
-- Run this ONCE in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- before running backfill-mesh.js or the facet classifier.
--
-- Everything here is ADDITIVE. No existing column is dropped or altered, so the
-- live site keeps working on `tags`/`topics` until the new columns are filled
-- and the pages are switched over.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── MeSH subject headings for papers ────────────────────────────────────────
-- Assigned by NLM indexers; the highest-quality classification signal available
-- for the papers table. Populated by scripts/backfill-mesh.js.
alter table papers add column if not exists mesh jsonb default '[]';
create index if not exists papers_mesh_gin on papers using gin(mesh);

-- ── Facet columns on every classified table ─────────────────────────────────
-- facet_function     records | stimulates | images | decodes | none
-- facet_access       non_invasive | minimally_invasive |
--                    implanted_non_penetrating | implanted_penetrating | not_applicable
-- facet_application  movement_restoration | communication_speech | ... (13 values)
-- in_scope           false = indexed but not neurotechnology; hidden by default
-- classifier_version stamp so a stored value never silently drifts

do $$
declare t text;
begin
  foreach t in array array['papers', 'devices', 'patents', 'news_feed', 'organizations', 'researchers']
  loop
    execute format('alter table %I add column if not exists facet_function text[] default ''{}''', t);
    execute format('alter table %I add column if not exists facet_access text[] default ''{}''', t);
    execute format('alter table %I add column if not exists facet_application text[] default ''{}''', t);
    execute format('alter table %I add column if not exists in_scope boolean default true', t);
    execute format('alter table %I add column if not exists classifier_version text', t);

    execute format('create index if not exists %I on %I using gin(facet_function)', t || '_fn_gin', t);
    execute format('create index if not exists %I on %I using gin(facet_access)', t || '_ax_gin', t);
    execute format('create index if not exists %I on %I using gin(facet_application)', t || '_app_gin', t);
    execute format('create index if not exists %I on %I (in_scope)', t || '_in_scope', t);
  end loop;
end $$;

-- ── Devices: keep the FDA product code as a real column ─────────────────────
-- It is currently buried in a sentence inside `description`. It is the
-- regulator's own classification, present on 100% of rows, and drives both
-- scope and facets — so it belongs in its own indexed column.
alter table devices add column if not exists product_code text;
create index if not exists devices_product_code on devices(product_code);

-- Backfill it from the existing description text (one-off, safe to re-run).
update devices
   set product_code = substring(description from 'product code ([A-Z]{3})')
 where product_code is null
   and description ~ 'product code [A-Z]{3}';

-- ── Verify ──────────────────────────────────────────────────────────────────
-- select count(*) filter (where product_code is not null) as coded,
--        count(*) as total
--   from devices;
