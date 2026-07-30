-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 015 — the score layer (Potential Impact, Phase 4)
--
-- NOT YET RUN. Apply in the Supabase SQL editor, then:
--     node --env-file=.env scripts/score-items.js --sample 50 --commit
--
-- Additive. Two tables: the score, and the reset log section 8 requires.
--
-- NOTHING HERE IS USER-FACING. Spec 9.1: no numeric scores, no dimension names,
-- no rubric vocabulary in the interface. The only fields a page may read are
-- user_facing_reason, tags and horizon. Everything else exists for the internal
-- inspection view (9.3) and for monitoring (13).
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

create table if not exists impact_scores (
  id                uuid primary key default gen_random_uuid(),

  item_type         text not null,
  item_id           uuid not null,
  entity_type       text not null,          -- research | device | trial | feed
  subfield          text,

  rubric_version    text not null,
  extractor_version text,
  model             text,

  potential_impact  double precision not null default 0,
  path_taken        text,                   -- frontier | leverage | gap | gate
  base              double precision,
  multiplier        double precision,
  recency           double precision,

  -- Dimension blocks, each carrying its own justification and referent so the
  -- inspection view can show why a score was given without re-deriving it.
  fd                jsonb, lv jsonb, tr jsonb,
  gap               jsonb, gate jsonb, meth jsonb,

  translational_distance integer,
  evidence_grade    text,
  evidence_variant  text,                   -- standard | trial_design
  uncertainty       text,

  frontier_records_consulted jsonb not null default '[]',
  record_update_proposed     jsonb,
  gates_triggered   jsonb not null default '[]',
  flags             jsonb not null default '[]',

  -- What bound each dimension, so a capped item can say so rather than looking
  -- like a weak one. See docs/potential-impact-phase4-design.md.
  ceilings_applied  jsonb not null default '[]',
  fd_ceiling        integer,
  input_granularity text,

  claim_vs_demonstration jsonb,
  gap_flagged       boolean not null default false,
  -- Count only. The markers themselves stay in item_extractions; spec 13 wants
  -- the CORRELATION between this count and potential_impact to stay near zero,
  -- and calls it the single most important number in monitoring.
  rhetorical_marker_count integer not null default 0,

  user_facing_reason text,
  reason_from_template boolean not null default false,
  tags              jsonb not null default '[]',
  horizon           text,

  -- Phase 5 scores a 2016-2019 corpus against a 2016 record set. Tagging the run
  -- keeps calibration scores out of the live sort without a second table.
  run_label         text not null default 'live',
  scored_at         timestamptz default now(),

  constraint impact_entity_type_ck check (entity_type in ('research', 'device', 'trial', 'feed')),
  constraint impact_path_ck check (path_taken is null or path_taken in ('frontier', 'leverage', 'gap', 'gate')),
  constraint impact_horizon_ck check (horizon is null or horizon in ('near', 'medium', 'long')),
  constraint impact_nonneg_ck check (potential_impact >= 0)
);

create unique index if not exists impact_scores_item
  on impact_scores(item_type, item_id, rubric_version, run_label);
create index if not exists impact_scores_rank
  on impact_scores(run_label, potential_impact desc);
create index if not exists impact_scores_subfield on impact_scores(subfield);
create index if not exists impact_scores_path on impact_scores(run_label, path_taken);
create index if not exists impact_scores_gap on impact_scores(gap_flagged) where gap_flagged;

-- ── The reset log, spec 8 ───────────────────────────────────────────────────
-- "Log every reset with item id, rule number, and original value. Reset rates
-- are a monitoring signal: a rising rate on rule 1 or 3 means the model is
-- drifting toward unanchored judgment."
create table if not exists impact_score_resets (
  id           uuid primary key default gen_random_uuid(),
  item_type    text not null,
  item_id      uuid not null,
  run_label    text not null default 'live',
  rule         integer not null,
  field        text not null,
  from_value   text,
  to_value     text,
  note         text,
  created_at   timestamptz default now(),
  constraint reset_rule_ck check (rule between 1 and 8)
);

create index if not exists resets_rule on impact_score_resets(run_label, rule);
create index if not exists resets_item on impact_score_resets(item_type, item_id);

alter table impact_scores       enable row level security;
alter table impact_score_resets enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'impact_scores' and policyname = 'public read impact_scores')
    then create policy "public read impact_scores" on impact_scores for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename = 'impact_score_resets' and policyname = 'public read impact_score_resets')
    then create policy "public read impact_score_resets" on impact_score_resets for select using (true); end if;
end $$;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- select run_label, count(*), round(avg(potential_impact)::numeric,3) from impact_scores group by 1;
-- select path_taken, count(*) from impact_scores where run_label='live' group by 1;  -- spec 13 path split
-- select rule, count(*) from impact_score_resets group by 1 order by 1;              -- spec 8 reset rates
-- select entity_type, count(*) from impact_scores where run_label='live' group by 1; -- spec 13 distribution
