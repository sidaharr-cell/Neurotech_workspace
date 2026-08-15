-- 020-founded-source-kinds.sql
--
-- Widen the sources a founding year may come from, and say what each one is
-- worth. Run once, by hand, in the Supabase SQL editor.
--
-- Migration 019 allowed two kinds. Three more earn a place:
--
--   wikipedia           an infobox founding year on a page whose external links
--                       include the company's own domain. Third-party and
--                       edited, but less structured than Wikidata: Wikidata
--                       needs a P571 claim, while a Wikipedia infobox line
--                       exists for many companies that have no such claim.
--
--   record_description  a founding year already present in this index, inside
--                       organizations.description, which is displayed on the
--                       company page today. Extracting it structures a
--                       sentence a reader is already being shown.
--
--   companies_house     reserved. NOT used for founded_year: the UK register
--                       gives date_of_creation, which is INCORPORATION, the same
--                       class as SEC Form D, and belongs in incorporated_year
--                       from migration 018. Listed here only so the constraint
--                       does not have to change again if that ever moves.
--
-- The source_url exemption, and why it is narrow:
--
--   record_description has no URL to point at. organizations.source_url is null
--   for every company row, so the description's own provenance was never
--   recorded. That is a real weakness and the constraint now states it in one
--   place instead of leaving it implicit: a founding year may omit its URL ONLY
--   when it came from our own stored description, and every other kind must
--   carry one. The company page renders that class differently, so a reader is
--   never shown a bare year whose origin cannot be followed.

alter table organizations
  drop constraint if exists organizations_founded_year_sourced;

alter table organizations
  add constraint organizations_founded_year_sourced
  check (
    founded_year is null
    or (
      founded_source_kind in (
        'company_site', 'wikidata', 'wikipedia', 'record_description', 'companies_house'
      )
      and (founded_source_url is not null or founded_source_kind = 'record_description')
    )
  );

comment on column organizations.founded_source_kind is
  'wikidata | wikipedia | company_site (self-reported) | record_description (our own text, no URL). '
  'Incorporation dates do not belong here: see incorporated_year.';
