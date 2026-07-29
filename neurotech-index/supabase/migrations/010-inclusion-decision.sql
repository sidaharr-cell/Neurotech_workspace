-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 010 — record that a company was ruled OUT, not just that it has no
-- basis
--
-- NOT YET RUN. Apply in the Supabase SQL editor. Additive: one nullable column
-- and a view replacement. No data rewritten.
--
-- The problem. `inclusion_basis` says why a company is in the neurotech set. A
-- company that is deliberately OUT has no basis, by design: that absence is what
-- keeps it off the chart. So a null basis means two different things, "nobody
-- has looked at this yet" and "we looked and the answer was no", and the
-- database cannot tell them apart. The distinction exists only in
-- scripts/data/inclusion-basis.json.
--
-- The consequence. funding_validation_failures reports 147 missing_inclusion_
-- basis rows, of which 16 are companies with a written, reviewed exclusion.
-- scripts/validate-funding.js already reads the decision file and so reports
-- correctly, which means the CI check passes while the view a human would query
-- from the dashboard shows 147 failures. A check nobody can trust is worse than
-- no check, and this is precisely the sort of false signal that makes a real one
-- easy to miss.
--
-- After this runs, scripts/backfill-inclusion.js writes the decision alongside
-- the basis. It probes for the column first, so it works either side of this
-- migration and starts populating it on the first run afterwards.
-- ═══════════════════════════════════════════════════════════════════════════

alter table organizations add column if not exists inclusion_decision text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_inclusion_decision_ck') then
    alter table organizations add constraint organizations_inclusion_decision_ck
      check (inclusion_decision is null or inclusion_decision in ('include', 'exclude'));
  end if;
  -- An included company must say why. An excluded one must not, since a basis is
  -- what puts a company on the chart.
  if not exists (select 1 from pg_constraint where conname = 'organizations_inclusion_coherent_ck') then
    alter table organizations add constraint organizations_inclusion_coherent_ck
      check (inclusion_decision is distinct from 'exclude' or inclusion_basis is null);
  end if;
end $$;

comment on column organizations.inclusion_decision is
  'include | exclude | null. Null means undecided, which is a work queue. '
  'Written by scripts/backfill-inclusion.js from scripts/data/inclusion-basis.json, '
  'which holds the written reason for each decision.';

-- ── The view, brought back in line with scripts/validate-funding.js ─────────
-- Two changes to the inclusion rule. It is scoped to the biggest raisers, since
-- a chart of 20 draws from the top of that ordering and that is where an
-- undefended inclusion is visible to a reader. And a recorded exclusion counts
-- as a decision, so the check stops going red for companies that were correctly
-- ruled out.
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
  select t.id, t.name, 'missing_inclusion_decision',
         'a record that can reach the chart has neither an inclusion_basis nor a recorded exclusion'
    from (select id, name, inclusion_basis, inclusion_decision
            from organizations
           where type = 'company' and total_raised_usd is not null
           order by total_raised_usd desc
           limit 30) t
   where t.inclusion_basis is null
     and t.inclusion_decision is distinct from 'exclude'
  union all
  select r.organization_id as id, o.name, 'round_without_source',
         'funding_rounds.amount_usd is set but source_url is null'
    from funding_rounds r join organizations o on o.id = r.organization_id
   where r.amount_usd is not null and r.source_url is null;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- select rule, count(*) from funding_validation_failures group by 1;   -- expect 0 rows
-- Then re-run scripts/backfill-inclusion.js --commit to populate the column:
-- select inclusion_decision, count(*) from organizations
--   where type = 'company' group by 1;
