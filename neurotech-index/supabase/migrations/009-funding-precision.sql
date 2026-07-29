-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 009 — two facts the chart currently has to work around
--
-- NOT YET RUN. Apply in the Supabase SQL editor (Dashboard → SQL Editor → New
-- query). Both changes are additive: one widens a CHECK, one adds two nullable
-- columns. No table rewrite, no data touched.
--
-- The application code is written to work BEFORE and AFTER this runs, so
-- applying it needs no redeploy and skipping it breaks nothing. What changes is
-- that two workarounds stop being workarounds.
--
-- ── 1. A defunct company can say so ────────────────────────────────────────
--
-- latest_raise_unavailable_reason has five values and none of them is defunct,
-- so unavailableReason() in scripts/lib/funding.js files a defunct company under
-- 'not_applicable_acquired'. Pear Therapeutics did not get acquired. It filed
-- for chapter 11 on 7 April 2023.
--
-- Storing it that way is lossy. Rendering it that way asserts something false,
-- so src/lib/fundingBoard.js has an unavailableLabel() that prefers the sourced
-- status over the stored reason. That special case is correct but it exists only
-- because the column cannot hold the truth.
--
-- After this runs, change the line in scripts/lib/funding.js from
--     if (status === 'acquired' || status === 'defunct') return 'not_applicable_acquired'
-- to
--     if (status === 'acquired') return 'not_applicable_acquired'
--     if (status === 'defunct') return 'not_applicable_defunct'
-- and add 'not_applicable_defunct' to UNAVAILABLE_REASONS in fundingBoard.js.
-- Do NOT make that code change first: the CHECK below has to exist before
-- anything writes the new value, or the daily backfill fails its upsert.
--
-- ── 2. Whether a company ever raised on the public markets ─────────────────
--
-- The partial-total marker says "this private-only figure is not the whole
-- story". It currently fires for status public or acquired. Pear Therapeutics is
-- defunct, and its $255M private total is also partial, because it listed
-- through a SPAC in 2021 and raised public capital before the bankruptcy.
--
-- Firing the marker on `defunct` alone would be wrong: a company that dies
-- having never listed has a complete private total, and marking it partial
-- claims public capital that never existed. The distinguishing fact is whether
-- the company was ever publicly traded, which no column holds, so it gets one.
--
-- Written from scripts/data/org-status.json, where each entry carries the filing
-- that establishes it, and read by src/lib/fundingBoard.js.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Widen the unavailable-reason enum ────────────────────────────────────
do $$ begin
  alter table organizations drop constraint if exists organizations_raise_reason_ck;
  alter table organizations add constraint organizations_raise_reason_ck
    check (latest_raise_unavailable_reason is null or latest_raise_unavailable_reason in (
      'no_filing_found', 'not_applicable_public', 'not_applicable_acquired',
      'not_applicable_defunct', 'foreign_issuer_not_covered', 'unverified'));
end $$;

-- ── 2. Public-listing history ───────────────────────────────────────────────
-- Null means not researched, which is the honest default for 1,063 companies
-- whose status nobody has looked at. It is deliberately NOT defaulted to false:
-- false is a claim that a company never listed, and absence of research is not
-- that claim.
alter table organizations add column if not exists was_publicly_traded boolean;
alter table organizations add column if not exists public_listing_source_url text;

do $$ begin
  -- The fact needs a source, exactly like a dollar figure does.
  if not exists (select 1 from pg_constraint where conname = 'organizations_listing_needs_source_ck') then
    alter table organizations add constraint organizations_listing_needs_source_ck
      check (was_publicly_traded is not true or public_listing_source_url is not null);
  end if;
end $$;

-- A currently public company is trivially one that has been publicly traded.
-- This is a derivation from a fact already stored with its own source, not a new
-- assertion, so it carries that same source URL across.
update organizations
   set was_publicly_traded = true,
       public_listing_source_url = status_source_url
 where status = 'public'
   and status_source_url is not null
   and was_publicly_traded is null;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- select count(*) from funding_validation_failures;                    -- expect 0
-- select status, was_publicly_traded, count(*) from organizations
--   where type = 'company' group by 1, 2 order by 3 desc;
-- select name, status, was_publicly_traded, public_listing_source_url
--   from organizations where was_publicly_traded is true;
