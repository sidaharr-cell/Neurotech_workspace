-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 008 — funding moves into Postgres, with provenance
--
-- Run ONCE in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Fast: all-nullable column adds plus one empty table. No table rewrite.
--
-- Context. Until now funding lived in two committed JSON files merged in the
-- browser by company-name string (src/data/funding.json from SEC EDGAR, and
-- src/data/companies-funding.json curated by hand). See
-- docs/funding-chart-audit.md. That overlay carried a dollar figure and a
-- check date and nothing else: no source URL, no accession number, no CIK, no
-- confidence, and one undifferentiated "n/a" standing in for five different
-- situations. This migration creates the columns those facts need.
--
-- Everything here is ADDITIVE. The JSON overlay and the chart that reads it
-- keep working untouched. Figures are NOT copied in by this migration or by its
-- backfill, because the existing figures have no source URL to copy with them
-- and hard rule 1 forbids writing a financial figure without one. The rows fill
-- in Phase 2, when the re-run of backfill-funding.js captures the CIK,
-- accession number, and archive URL it currently discards.
--
-- Three deviations from the spec, each because the data contradicts it:
--
--   1. `status` is NULLABLE, not NOT NULL. The spec's enum has no unknown
--      value, and 1,084 company rows have never had their status researched.
--      A NOT NULL column forces a default, and the only available default is
--      'private', which would assert a fact about 1,084 companies that nobody
--      has checked. Null means "not yet verified" and is what the verification
--      queue reads. The CHECK still refuses any value outside the enum.
--
--   2. `total_raised_usd` and `latest_raise_usd` are BIGINT, not integer.
--      int4 tops out at $2.147B. Neuralink is already at $1.33B.
--
--   3. `last_verified_at` is a generated column over the non-null verification
--      timestamps. LEAST ignores nulls, so a record verified in one dimension
--      and never in another reads as fresh here. Freshness for the verification
--      queue is therefore "last_verified_at is old OR any confidence is
--      unverified", which is what Phase 2's CLI implements, not this column
--      alone.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Status and capital scope ─────────────────────────────────────────────
-- status            what the company is now. Drives which funding questions are
--                   even applicable: a public or acquired company is not raising
--                   private rounds, so its null latest raise is information, not
--                   a gap. NULL = not yet researched.
-- capital_scope     what total_raised_usd counts for THIS record. Set globally
--                   to private_only, stored per record so a mixed set is
--                   detectable rather than silent. A private_only total on a
--                   public or acquired company is a partial total, and the chart
--                   marks it as one.
alter table organizations add column if not exists status text;
alter table organizations add column if not exists status_effective_date date;
alter table organizations add column if not exists status_source_url text;
alter table organizations add column if not exists status_verified_at timestamptz;
alter table organizations add column if not exists capital_scope text default 'private_only';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_status_ck') then
    alter table organizations add constraint organizations_status_ck
      check (status is null or status in ('private', 'public', 'acquired', 'subsidiary', 'defunct'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_capital_scope_ck') then
    alter table organizations add constraint organizations_capital_scope_ck
      check (capital_scope in ('private_only', 'all_capital'));
  end if;
end $$;

-- ── 2. Funding figures, each with its own provenance ────────────────────────
-- Every figure carries three companions: where it came from, when we read it,
-- and how good the source is.
--   filing_verified  traceable to an SEC filing or a company release
--   press_reported   reputable outlet, no primary document
--   unverified       not yet checked; the default, and a work queue
--
-- Amounts are whole US dollars. The JSON overlay stores millions; the loader in
-- Phase 2 multiplies. Storing dollars means a $649,000,000 round is one number
-- and not a rounding decision.
alter table organizations add column if not exists total_raised_usd bigint;
alter table organizations add column if not exists total_raised_source_url text;
alter table organizations add column if not exists total_raised_retrieved_at timestamptz;
alter table organizations add column if not exists total_raised_confidence text default 'unverified';

alter table organizations add column if not exists latest_raise_usd bigint;
alter table organizations add column if not exists latest_raise_date date;
alter table organizations add column if not exists latest_raise_source_url text;
alter table organizations add column if not exists latest_raise_retrieved_at timestamptz;
alter table organizations add column if not exists latest_raise_confidence text default 'unverified';
alter table organizations add column if not exists latest_raise_accession_number text;

-- What the date on a raise actually means. The current pipeline records the SEC
-- filing date and the chart presents it as when the company raised. Those differ
-- by days to weeks. Store which one it is instead of blurring them.
alter table organizations add column if not exists latest_raise_date_basis text default 'filing_date';

-- Replaces the ambiguous n/a. Set only when latest_raise_usd is null.
--   no_filing_found            searched, nothing located
--   not_applicable_public      publicly traded; private rounds are not the
--                              relevant instrument
--   not_applicable_acquired    acquired; no longer raising independently
--   foreign_issuer_not_covered not a US issuer, so Form D does not apply
--   unverified                 not yet checked (default; a work queue, never a
--                              display state)
alter table organizations add column if not exists latest_raise_unavailable_reason text default 'unverified';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_total_conf_ck') then
    alter table organizations add constraint organizations_total_conf_ck
      check (total_raised_confidence in ('filing_verified', 'press_reported', 'unverified'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_latest_conf_ck') then
    alter table organizations add constraint organizations_latest_conf_ck
      check (latest_raise_confidence in ('filing_verified', 'press_reported', 'unverified'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_raise_reason_ck') then
    alter table organizations add constraint organizations_raise_reason_ck
      check (latest_raise_unavailable_reason is null or latest_raise_unavailable_reason in (
        'no_filing_found', 'not_applicable_public', 'not_applicable_acquired',
        'foreign_issuer_not_covered', 'unverified'));
  end if;
  -- The reason exists to explain an absent figure. A record cannot carry both.
  -- Whatever writes an amount must clear the reason in the same update.
  if not exists (select 1 from pg_constraint where conname = 'organizations_raise_reason_excl_ck') then
    alter table organizations add constraint organizations_raise_reason_excl_ck
      check (latest_raise_usd is null or latest_raise_unavailable_reason is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_raise_basis_ck') then
    alter table organizations add constraint organizations_raise_basis_ck
      check (latest_raise_date_basis is null or latest_raise_date_basis in ('filing_date', 'announced_date'));
  end if;
  -- A figure and its source travel together, enforced at the row level rather
  -- than only in the CI check. This is the one rule worth making impossible to
  -- break by hand in the Supabase table editor.
  if not exists (select 1 from pg_constraint where conname = 'organizations_total_needs_source_ck') then
    alter table organizations add constraint organizations_total_needs_source_ck
      check (total_raised_usd is null or total_raised_source_url is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_latest_needs_source_ck') then
    alter table organizations add constraint organizations_latest_needs_source_ck
      check (latest_raise_usd is null or latest_raise_source_url is not null);
  end if;
end $$;

-- ── 3. Classification ───────────────────────────────────────────────────────
-- modality is a SINGLE primary value. It is deliberately separate from the
-- existing facet_function / facet_application arrays, which use a different
-- vocabulary (records | stimulates | decodes | images), are multi-valued, and
-- are populated for only about half of the funded set. Treat the facets as an
-- input to modality, never as modality itself.
--
-- computational_neuro covers companies building computational models of neural
-- systems. It is not a drug-discovery bucket; the inclusion rule excludes
-- general-purpose discovery platforms. It is expected to be empty at launch.
-- Phase 2 verification decides whether to drop the value rather than ship a dead
-- legend entry.
alter table organizations add column if not exists modality text;
alter table organizations add column if not exists modality_secondary text;

-- Why this company is in the neurotech set, in prose, defensible against the
-- inclusion rule in docs/funding-chart-audit.md. Required for any record that
-- carries a funding figure. If it cannot be written, the record does not belong
-- on the chart.
alter table organizations add column if not exists inclusion_basis text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_modality_ck') then
    alter table organizations add constraint organizations_modality_ck
      check (modality is null or modality in (
        'implanted_bci', 'neuromodulation', 'diagnostics_imaging',
        'digital_therapeutic', 'computational_neuro', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_modality2_ck') then
    alter table organizations add constraint organizations_modality2_ck
      check (modality_secondary is null or modality_secondary in (
        'implanted_bci', 'neuromodulation', 'diagnostics_imaging',
        'digital_therapeutic', 'computational_neuro', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_inclusion_len_ck') then
    alter table organizations add constraint organizations_inclusion_len_ck
      check (inclusion_basis is null or char_length(inclusion_basis) <= 200);
  end if;
end $$;

-- ── 4. Regulatory and clinical stage ────────────────────────────────────────
-- furthest_stage must be DERIVABLE from stage_evidence_id. A stage with no
-- evidence is null, never a guess from a company description.
--   stage_evidence_type  clinicaltrials_gov | openfda | company_release | none
--   stage_evidence_id    the NCT number, FDA submission number, or URL
alter table organizations add column if not exists furthest_stage text;
alter table organizations add column if not exists stage_evidence_type text default 'none';
alter table organizations add column if not exists stage_evidence_id text;
alter table organizations add column if not exists stage_verified_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_stage_ck') then
    alter table organizations add constraint organizations_stage_ck
      check (furthest_stage is null or furthest_stage in (
        'preclinical', 'first_in_human', 'feasibility', 'pivotal', 'de_novo_granted',
        'cleared_510k', 'approved_pma', 'ce_marked', 'commercial', 'withdrawn'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_stage_ev_ck') then
    alter table organizations add constraint organizations_stage_ev_ck
      check (stage_evidence_type is null or stage_evidence_type in (
        'clinicaltrials_gov', 'openfda', 'company_release', 'none'));
  end if;
  -- A stage is only ever as good as the record behind it.
  if not exists (select 1 from pg_constraint where conname = 'organizations_stage_needs_evidence_ck') then
    alter table organizations add constraint organizations_stage_needs_evidence_ck
      check (furthest_stage is null or (stage_evidence_type is not null
             and stage_evidence_type <> 'none' and stage_evidence_id is not null));
  end if;
end $$;

-- The enum is ordered, and a Phase 3 range filter needs that order in SQL.
-- withdrawn is terminal rather than advanced, so it sorts last on its own.
create or replace function stage_rank(stage text) returns integer
language sql immutable strict parallel safe as $$
  select case stage
    when 'preclinical'      then 1
    when 'first_in_human'   then 2
    when 'feasibility'      then 3
    when 'pivotal'          then 4
    when 'de_novo_granted'  then 5
    when 'cleared_510k'     then 6
    when 'approved_pma'     then 7
    when 'ce_marked'        then 8
    when 'commercial'       then 9
    when 'withdrawn'        then 99
  end
$$;

-- ── 5. Naming and freshness ─────────────────────────────────────────────────
-- display_name is what the chart renders, in full, with no truncation at the
-- data layer. legal_name is as filed with the SEC, which is how a Form D issuer
-- is matched. `name` stays the join key every other table and script uses.
alter table organizations add column if not exists display_name text;
alter table organizations add column if not exists legal_name text;
alter table organizations add column if not exists cik text;

-- Computed, not entered: the oldest of the record's verification timestamps.
-- Null until something has been verified. See deviation 3 in the header.
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'organizations' and column_name = 'last_verified_at') then
    alter table organizations add column last_verified_at timestamptz
      generated always as (least(status_verified_at, total_raised_retrieved_at,
                                latest_raise_retrieved_at, stage_verified_at)) stored;
  end if;
end $$;

create index if not exists organizations_total_raised
  on organizations(total_raised_usd desc nulls last);
create index if not exists organizations_status on organizations(status);
create index if not exists organizations_modality on organizations(modality);

-- ── 6. Funding rounds ───────────────────────────────────────────────────────
-- One row per round. Trailing-window sorting needs individual rounds; a single
-- latest-raise field cannot answer "how much did this company raise in the last
-- 24 months".
--
-- round_date is the date the round is dated BY, and date_basis says which date
-- that is. Form D gives a filing date, which is not the announcement date. The
-- overlay conflates them today; this does not.
--
-- Absent history is absent. A company with one known round gets one row, not a
-- reconstructed series.
create table if not exists funding_rounds (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  amount_usd       bigint,
  round_date       date,
  date_basis       text default 'filing_date',   -- filing_date | announced_date
  round_type       text,                          -- 'Series C', 'Seed', 'IPO', free text as sourced
  source           text,                          -- edgar_form_d | company_release | press | curated
  source_url       text,
  accession_number text,                          -- SEC accession when source is a Form D
  confidence       text default 'unverified',     -- filing_verified | press_reported | unverified
  retrieved_at     timestamptz,
  first_seen       timestamptz default now(),
  last_updated     timestamptz default now(),
  pipeline_version text,
  created_at       timestamptz default now(),
  constraint funding_rounds_conf_ck
    check (confidence in ('filing_verified', 'press_reported', 'unverified')),
  constraint funding_rounds_basis_ck
    check (date_basis is null or date_basis in ('filing_date', 'announced_date')),
  -- Same rule as the organization figures: no amount without a source.
  constraint funding_rounds_needs_source_ck
    check (amount_usd is null or source_url is not null)
);

create index if not exists funding_rounds_org on funding_rounds(organization_id, round_date desc);
create index if not exists funding_rounds_date on funding_rounds(round_date desc);
-- One row per filing. NULLS NOT DISTINCT (Postgres 15+) so a curated round with
-- no accession number does not duplicate on every re-run of the backfill.
create unique index if not exists funding_rounds_uniq
  on funding_rounds(organization_id, accession_number) nulls not distinct;

alter table funding_rounds enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'funding_rounds' and policyname = 'public read funding_rounds')
    then create policy "public read funding_rounds" on funding_rounds for select using (true); end if;
end $$;

-- ── 7. Validation ───────────────────────────────────────────────────────────
-- One row per rule violation. scripts/validate-funding.js reads this and exits
-- non-zero, so CI fails on a record that asserts a fact it cannot support.
--
-- Scope note. The spec's rule is "a record has a null inclusion_basis fails".
-- Applied to all 1,084 company rows that would fail on the day the migration
-- lands, before anyone has written a single basis, and a check that is red by
-- construction gets ignored. So inclusion_basis is required of records that
-- carry a funding figure, which is exactly the set that can reach the chart.
-- Widen it when the funded set is fully written up.
create or replace view funding_validation_failures as
  select o.id, o.name, 'figure_without_source' as rule,
         'total_raised_usd is set but total_raised_source_url is null' as detail
    from organizations o
   where o.total_raised_usd is not null and o.total_raised_source_url is null
  union all
  select o.id, o.name, 'figure_without_source',
         'latest_raise_usd is set but latest_raise_source_url is null'
    from organizations o
   where o.latest_raise_usd is not null and o.latest_raise_source_url is null
  union all
  select o.id, o.name, 'missing_unavailable_reason',
         'latest_raise_usd is null and latest_raise_unavailable_reason is null'
    from organizations o
   where o.type = 'company' and o.latest_raise_usd is null
     and o.latest_raise_unavailable_reason is null
  union all
  select o.id, o.name, 'stage_without_evidence',
         'furthest_stage is set but stage_evidence_type is none or null'
    from organizations o
   where o.furthest_stage is not null
     and (o.stage_evidence_type is null or o.stage_evidence_type = 'none')
  union all
  select o.id, o.name, 'missing_inclusion_basis',
         'record carries a funding figure but has no inclusion_basis'
    from organizations o
   where o.total_raised_usd is not null and o.inclusion_basis is null
  union all
  select r.organization_id as id, o.name, 'round_without_source',
         'funding_rounds.amount_usd is set but source_url is null'
    from funding_rounds r join organizations o on o.id = r.organization_id
   where r.amount_usd is not null and r.source_url is null;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- select count(*) from funding_validation_failures;            -- expect 0
-- select count(*) from funding_rounds;                         -- expect 0 after this migration
-- select count(*) filter (where capital_scope = 'private_only') , count(*) from organizations;
-- select latest_raise_unavailable_reason, count(*) from organizations
--   where type = 'company' group by 1;                         -- expect all 'unverified'
