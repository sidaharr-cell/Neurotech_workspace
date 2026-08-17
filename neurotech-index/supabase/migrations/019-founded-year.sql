-- 019-founded-year.sql
--
-- A SOURCED founding year, separate from the incorporation year in 018 and from
-- the unsourced `founded` text column that predates both.
--
-- Additive. Run once, by hand, in the Supabase SQL editor.
--
-- Three columns of the same fact already exist or are proposed, which looks like
-- duplication and is not:
--
--   founded                  text, no source, no retrieval date, nobody knows
--                            where it came from. 22 rows. Five of the values
--                            that can be checked against a filing disagree with
--                            it (Merge Labs 2025/2016, Saluda 2013/2023). Left
--                            in place and no longer rendered on its own.
--
--   incorporated_year        migration 018. SEC Form D Item 2, the issuer's own
--                            declaration to a regulator. 207 rows. Authoritative
--                            but it is INCORPORATION, which a redomiciliation
--                            resets while the company is unchanged.
--
--   founded_year             this migration. What the company says about when it
--                            was founded, from Wikidata or from its own site.
--
-- founded_source_kind is what keeps the last of those honest. A value read off a
-- company's marketing page is self-reported, unverified, and can change without
-- notice; a Wikidata inception date carries third-party references. They are not
-- the same class of evidence and the UI states which one it is showing, so the
-- column is required whenever a year is set.
--
-- founded_evidence holds the sentence the year was read from, so a wrong value
-- can be judged without re-fetching a page that may since have changed.

alter table organizations
  add column if not exists founded_year         int,
  add column if not exists founded_source_url   text,
  add column if not exists founded_source_kind  text,
  add column if not exists founded_evidence     text,
  add column if not exists founded_retrieved_at timestamptz;

comment on column organizations.founded_year is
  'Year the company says it was founded. Not incorporation: see incorporated_year.';
comment on column organizations.founded_source_kind is
  'company_site (self-reported, unverified) or wikidata (third-party, referenced).';
comment on column organizations.founded_evidence is
  'The sentence fragment the year was read from, kept so a wrong value can be judged.';

-- A year never appears without a source and a class for that source. This is the
-- never-fabricate rule expressed where the database can hold it, rather than
-- only in the script that happens to write the column today.
alter table organizations
  drop constraint if exists organizations_founded_year_sourced;
alter table organizations
  add constraint organizations_founded_year_sourced
  check (
    founded_year is null
    or (founded_source_url is not null
        and founded_source_kind in ('company_site', 'wikidata'))
  );

create index if not exists organizations_founded_year_idx
  on organizations (founded_year)
  where founded_year is not null;
