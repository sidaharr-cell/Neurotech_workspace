-- Neurotech Index — Supabase schema
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query)

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ── Papers ──────────────────────────────────────────────────────────────────
create table if not exists papers (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  authors     jsonb default '[]',
  journal     text,
  year        text,
  doi         text unique,
  pubmed_id   text unique,
  arxiv_id    text unique,
  url         text,
  abstract    text,
  tags        jsonb default '[]',
  source      text default 'manual', -- 'manual' | 'pubmed' | 'arxiv'
  created_at  timestamptz default now()
);

create index if not exists papers_tags_gin on papers using gin(tags);
create index if not exists papers_year on papers(year);
create index if not exists papers_created on papers(created_at desc);

-- Field-normalized impact rank (OpenAlex), populated by backfill-paper-impact.js.
-- If the table predates it, add it:
--   alter table papers add column if not exists rank_score real default 0;
alter table papers add column if not exists rank_score real default 0;
create index if not exists papers_rank on papers(rank_score desc);

-- Full-text search
alter table papers add column if not exists fts tsvector
  generated always as (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(abstract, '') || ' ' ||
      coalesce(journal, '') || ' ' ||
      coalesce(tags::text, '')
    )
  ) stored;
create index if not exists papers_fts on papers using gin(fts);

-- ── Devices ─────────────────────────────────────────────────────────────────
create table if not exists devices (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  manufacturer text,
  type         text,
  year         text,
  status       text,
  signal_type  text,
  channels     text,
  description  text,
  modality     jsonb default '[]',
  tags         jsonb default '[]',
  url          text,
  created_at   timestamptz default now()
);

create index if not exists devices_tags_gin on devices using gin(tags);

-- ── Organizations ────────────────────────────────────────────────────────────
create table if not exists organizations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  type         text,
  location     text,
  founded      text,
  description  text,
  focus_areas  jsonb default '[]',
  website      text,
  founders     jsonb default '[]',
  rank_score   real default 0,
  created_at   timestamptz default now()
);
-- If the table predates rank_score, add it:
--   alter table organizations add column if not exists rank_score real default 0;
create index if not exists organizations_rank on organizations(rank_score desc);

-- ── Researchers ──────────────────────────────────────────────────────────────
create table if not exists researchers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  affiliation  text,
  role         text,
  bio          text,
  expertise    jsonb default '[]',
  notable_work jsonb default '[]',
  created_at   timestamptz default now()
);

-- ── News feed (auto-curated by refresh.js) ───────────────────────────────────
create table if not exists news_feed (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  summary          text,
  source           text,
  url              text unique not null,
  published_at     timestamptz,
  topics           jsonb default '[]',
  relevance_score  integer default 5,
  entry_type       text,   -- 'paper' | 'preprint' | 'news'
  metadata         jsonb default '{}',
  created_at       timestamptz default now()
);

create index if not exists news_feed_score on news_feed(relevance_score desc);
create index if not exists news_feed_published on news_feed(published_at desc);
create index if not exists news_feed_topics_gin on news_feed using gin(topics);

-- ── Row-level security (read-only for anon key) ───────────────────────────────
alter table papers        enable row level security;
alter table devices       enable row level security;
alter table organizations enable row level security;
alter table researchers   enable row level security;
alter table news_feed     enable row level security;

-- Anyone can read; only service-role key can write (used by refresh.js)
create policy "public read papers"        on papers        for select using (true);
create policy "public read devices"       on devices       for select using (true);
create policy "public read organizations" on organizations for select using (true);
create policy "public read researchers"   on researchers   for select using (true);
create policy "public read news_feed"     on news_feed     for select using (true);
