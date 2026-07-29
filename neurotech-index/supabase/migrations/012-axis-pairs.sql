-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 012 — paired frontier axes (Potential Impact, FD 4)
--
-- NOT YET RUN. Apply in the Supabase SQL editor, then:
--     node --env-file=.env scripts/backfill-axis-pairs.js --commit
--
-- Additive: one new table. Nothing existing is touched.
--
-- WHY. FD 4 is the top of the frontier-delta rubric (spec 5.1.1):
--
--     4. Collapses a tradeoff. Improves one axis without the loss along a
--        paired axis the field treats as necessary.
--        Score 4 MUST name both paired axes and state why the tradeoff was
--        previously considered binding.
--
-- Nothing in the record layer said two axes were coupled, so there was no way to
-- check "improved A without regressing B" and no way to satisfy the MUST. FD 4
-- was unreachable by construction rather than by input granularity: even a full
-- paper cannot be scored 4 against a schema with no concept of a pair.
--
-- With this table FD 4 becomes largely mechanical. Given an item reporting
-- values on both axes of a pair: did it beat the record on one, and not regress
-- against the record on the other. That is arithmetic over the existing
-- frontier_records, plus a curated statement of why the pair was binding.
--
-- WHAT THIS IS NOT. It does not assert that a tradeoff is real or permanent.
-- `why_binding` records why the FIELD has treated the pair as coupled, with a
-- source. An item that collapses the tradeoff is exactly the item that proves
-- the belief was wrong, which is the point of scoring it 4.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

create table if not exists frontier_axis_pairs (
  id            uuid primary key default gen_random_uuid(),

  subfield      text not null,      -- SUBFIELD_IDS, src/lib/subfields.js
  partition_version text,

  -- The two coupled axes, as free text matching the `axis` wording on
  -- frontier_records. Deliberately not foreign keys: a pair is a statement about
  -- the FIELD and stays true while individual records are superseded, and a
  -- pair may name an axis that has no record yet.
  axis_a        text not null,
  axis_b        text not null,
  axis_a_type   text not null,
  axis_b_type   text not null,

  -- Why the field has treated improving one as costing the other. This is the
  -- text a score of 4 must cite, so it is required, not decorative.
  why_binding   text not null,

  -- How strongly the coupling is held. A pair believed on one group's say-so
  -- should not license a 4 as readily as one the field treats as settled.
  strength      text not null default 'asserted',

  source_url    text,
  notes         text,
  superseded_by uuid references frontier_axis_pairs(id) on delete set null,
  first_seen    timestamptz default now(),
  last_updated  timestamptz default now(),
  pipeline_version text,
  created_at    timestamptz default now(),

  constraint axis_pair_types_ck check (
    axis_a_type in ('performance','longevity','invasiveness','scale',
                    'regulatory','manufacturability','cost')
    and axis_b_type in ('performance','longevity','invasiveness','scale',
                        'regulatory','manufacturability','cost')
  ),
  constraint axis_pair_strength_ck check (strength in ('settled', 'contested', 'asserted')),
  -- A pair of an axis with itself is not a tradeoff.
  constraint axis_pair_distinct_ck check (axis_a is distinct from axis_b),
  constraint axis_pair_self_supersede_ck check (superseded_by is distinct from id)
);

create index if not exists axis_pairs_subfield on frontier_axis_pairs(subfield);
create index if not exists axis_pairs_live on frontier_axis_pairs(subfield)
  where superseded_by is null;

-- One live pair per (subfield, axis_a, axis_b). Unlike frontier_records this CAN
-- be a unique index: a pair is superseded by editing it, not by inserting a
-- competitor, so there is no insert-then-point sequencing problem.
create unique index if not exists axis_pairs_uniq
  on frontier_axis_pairs(subfield, axis_a, axis_b) where superseded_by is null;

comment on table frontier_axis_pairs is
  'Axis pairs the field treats as a tradeoff. Read by FD 4 scoring: an item that '
  'improves one axis without regressing its pair has collapsed the tradeoff.';

alter table frontier_axis_pairs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'frontier_axis_pairs' and policyname = 'public read frontier_axis_pairs')
    then create policy "public read frontier_axis_pairs" on frontier_axis_pairs for select using (true); end if;
end $$;

create or replace view frontier_axis_pairs_live as
  select * from frontier_axis_pairs where superseded_by is null;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- select subfield, count(*) from frontier_axis_pairs_live group by 1 order by 2 desc;
-- select strength, count(*) from frontier_axis_pairs_live group by 1;
-- Pairs whose axes have no matching record yet (these cannot yield an FD 4):
-- select p.subfield, p.axis_a, p.axis_b from frontier_axis_pairs_live p
--   where not exists (select 1 from frontier_records_live r
--                      where r.subfield = p.subfield and r.axis = p.axis_a);
