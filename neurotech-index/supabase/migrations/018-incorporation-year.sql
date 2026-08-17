-- 018-incorporation-year.sql
--
-- When a funded company was incorporated, from its own Form D filing, so the
-- capital-versus-stage scatter can carry company age and the age-as-confounder
-- question can be asked with something other than nine unsourced values.
--
-- Additive. Run once, by hand, in the Supabase SQL editor.
--
-- Why not `organizations.founded`:
--
--   That column is text, carries no source_url and no retrieved_at, and nobody
--   can say where its values came from. Of the nine values that overlap with a
--   filing, four disagree with it — Motif Neurotech 2021/2022, Cala Health
--   2014/2013, Neurable 2015/2016, and Saluda Medical 2013/2023. Overwriting it
--   would destroy the only record of that disagreement, and would still leave a
--   field with no provenance. It is left exactly as it is.
--
-- Why two year columns:
--
--   Form D Item 2 asks the issuer for its year of incorporation, but an issuer
--   formed more than five years before filing answers "over five years ago" and
--   gives no year. That is a real finding and the one that places the OLDEST
--   companies, which never state a year at all. Storing it as a bound keeps it;
--   rounding it into `incorporated_year` would assert a date the filing does
--   not, and dropping it would lose a quarter of the set.
--
--   Exactly one of the two is ever set. See docs/founded-backfill-scope.md.
--
-- This is INCORPORATION, not founding. A company can trade for years before it
-- incorporates, and redomiciling into the US resets the declared year while the
-- company is unchanged. Anything user-facing must say so.

alter table organizations
  add column if not exists incorporated_year         int,
  add column if not exists incorporated_before_year  int,
  add column if not exists incorporated_source_url   text,
  add column if not exists incorporated_retrieved_at timestamptz;

comment on column organizations.incorporated_year is
  'Year of incorporation as declared by the issuer on Form D Item 2. Exact. Not a founding year.';
comment on column organizations.incorporated_before_year is
  'Upper bound: the issuer declared "over five years ago" on a filing five years after this. Set only when incorporated_year is null.';
comment on column organizations.incorporated_source_url is
  'The Form D primary_doc.xml the value was read from.';

-- A row asserts one reading or the other, never both.
alter table organizations
  drop constraint if exists organizations_incorporation_one_reading;
alter table organizations
  add constraint organizations_incorporation_one_reading
  check (incorporated_year is null or incorporated_before_year is null);

-- Partial: most organizations are labs, or companies with no filing, and the
-- scatter only ever asks for the ones that have a reading.
create index if not exists organizations_incorporated_year_idx
  on organizations (incorporated_year)
  where incorporated_year is not null;
