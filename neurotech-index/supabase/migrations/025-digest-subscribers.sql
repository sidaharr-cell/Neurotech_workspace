-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 025 — who gets "What's new today" by email
--
-- NOT YET RUN. Apply in the Supabase SQL editor (Dashboard → SQL Editor).
--
-- Additive: one new table and its policies. Nothing existing is touched.
--
-- WHY THE ANON KEY MAY INSERT AND MAY NOT SELECT. There is no server in this
-- project and no authentication: the page is a static bundle talking to
-- Supabase with the anon key, and that key is in every reader's browser. A
-- subscribe box therefore has exactly one safe shape — insert-only. With a
-- select policy, anyone could read the list of addresses out of the page's own
-- credentials; without one, the same credentials can add an address and learn
-- nothing else. The daily run reads the table with the service key.
--
-- The duplicate is handled by the unique index rather than by a read-then-write:
-- a client that checked first would need select, which is the thing it must not
-- have. src/lib/whatsNew.js treats the resulting 23505 as success, because a
-- reader who signs up twice has asked for the same outcome twice.
--
-- Addresses are stored lower-cased (the client normalises before insert) so the
-- unique index is a real constraint rather than one that Reader@x.com slips
-- past. citext would do this in the database; it is an extension, and one
-- lower() in the one writer is a smaller thing to depend on.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

create table if not exists digest_subscribers (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  -- Set when a send bounces or a reader unsubscribes; the row is kept so the
  -- address is not silently re-added by a stale form still open in a tab.
  unsubscribed_at timestamptz,
  -- Written by scripts/send-digest.js after a successful send, so a failed
  -- night is visible as a stale timestamp rather than as nothing at all.
  last_sent_at    timestamptz,
  created_at      timestamptz default now()
);

create unique index if not exists digest_subscribers_email on digest_subscribers (lower(email));
create index if not exists digest_subscribers_active on digest_subscribers (unsubscribed_at) where unsubscribed_at is null;

alter table digest_subscribers enable row level security;

-- Insert-only for the anon key. No select policy, deliberately: RLS denies
-- anything not granted, so the list cannot be read back with the page's key.
drop policy if exists "public subscribe" on digest_subscribers;
create policy "public subscribe" on digest_subscribers for insert with check (true);
