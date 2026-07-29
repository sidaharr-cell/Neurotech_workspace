-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 013 — the extraction layer (Potential Impact, Phase 3)
--
-- NOT YET RUN. Apply in the Supabase SQL editor, then:
--     node --env-file=.env scripts/extract-items.js --sample 50 --commit
--
-- Additive: one new table. Nothing existing is touched.
--
-- WHY A SEPARATE TABLE. Extraction is pass one of two (spec section 7). The
-- claim-versus-demonstration separation is the control the whole anti-hype
-- design rests on, and the spec keeps it as its own step because it is
-- materially more reliable done before scoring. Storing it separately means:
--
--   - a rescore under a new rubric does not have to re-extract, which is the
--     expensive half;
--   - `claimed` and `demonstrated` stay inspectable side by side, which is what
--     the internal inspection view (spec 9.3) has to show;
--   - re-extraction when better input arrives is traceable rather than silent.
--
-- INPUT GRANULARITY IS STORED, NOT ASSUMED. Roughly 28% of this corpus can ever
-- reach full text (measured; see docs/potential-impact-input-granularity.md), so
-- an extraction is only as good as what it was given. Recording the granularity
-- is what lets Phase 4 cap FD and METH per item rather than applying one global
-- cap that would either discard the good 28% or license scores the evidence
-- does not carry.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

create table if not exists item_extractions (
  id                uuid primary key default gen_random_uuid(),

  -- Polymorphic item reference, same shape as relationships and held_by.
  -- 'news_feed' covers both trials and feed items; entity_type disambiguates.
  item_type         text not null,
  item_id           uuid not null,
  entity_type       text not null,   -- research | device | trial | feed

  -- Spec 7.2. The two that matter most are first.
  claimed           text,
  demonstrated      text,            -- null when no evidence is disclosed
  gap_flagged       boolean not null default false,

  quantitative_results jsonb not null default '[]',
  methods_disclosed boolean not null default false,
  artifacts_released   jsonb not null default '[]',
  constraints_addressed jsonb not null default '[]',
  -- Recorded for monitoring (spec 13): correlation between marker count and
  -- potential_impact should stay near zero. Never a scoring input.
  rhetorical_markers   jsonb not null default '[]',

  -- Trials only. Registry-sourced fields are copied from the registration;
  -- `powered` and `null_interpretable` are the only model-inferred entries, and
  -- registry_sourced inside the blob names which is which.
  trial_design      jsonb,

  input_granularity text not null,
  extractor_version text not null,
  model             text,

  extracted_at      timestamptz default now(),
  created_at        timestamptz default now(),

  constraint extraction_entity_type_ck check (entity_type in ('research', 'device', 'trial', 'feed')),
  constraint extraction_granularity_ck check (input_granularity in ('metadata', 'abstract', 'registry', 'full_text')),
  -- A trial_design block belongs only to a trial.
  constraint extraction_trial_design_ck check (trial_design is null or entity_type = 'trial')
);

-- One current extraction per item per extractor version. A new version writes a
-- new row rather than overwriting, so a rescore can be compared against what the
-- previous extractor said.
create unique index if not exists extractions_item_version
  on item_extractions(item_type, item_id, extractor_version);
create index if not exists extractions_item on item_extractions(item_type, item_id);
create index if not exists extractions_entity on item_extractions(entity_type);
create index if not exists extractions_gap on item_extractions(gap_flagged) where gap_flagged;
create index if not exists extractions_granularity on item_extractions(input_granularity);

comment on column item_extractions.demonstrated is
  'What the disclosed evidence supports. NULL means nothing was disclosed, which '
  'is a real and common answer, not a failed extraction.';
comment on column item_extractions.input_granularity is
  'What the extractor was actually given. Phase 4 caps FD and METH against this; '
  'see docs/potential-impact-input-granularity.md.';

alter table item_extractions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'item_extractions' and policyname = 'public read item_extractions')
    then create policy "public read item_extractions" on item_extractions for select using (true); end if;
end $$;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- select entity_type, input_granularity, count(*) from item_extractions group by 1,2 order by 1,2;
-- select count(*) filter (where gap_flagged) as gaps, count(*) from item_extractions;
-- select count(*) filter (where demonstrated is null) as nothing_demonstrated from item_extractions;
-- Marker frequency, the drift signal in spec 13:
-- select jsonb_array_length(rhetorical_markers) as markers, count(*)
--   from item_extractions group by 1 order by 1;
