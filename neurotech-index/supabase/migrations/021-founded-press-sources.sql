-- 021-founded-press-sources.sql
--
-- Two more classes a founding year may come from, and one column to record when
-- the sources disagree. Run once, by hand, in the Supabase SQL editor.
--
-- Web search reaches what scraping could not. Measured 15 Aug 2026: crawling
-- company websites verified 8 founding years out of 703 companies, one percent,
-- and roughly a third of even those were wrong. Searching found a year for the
-- first six companies tried. The difference is not the extraction, it is that
-- most companies never state a founding year on their own site while somebody
-- else has written it down.
--
-- The new classes:
--
--   press       journalism, university and institutional news, trade press,
--               regulatory prospectuses. Written by someone other than the
--               company, usually dated, and citable at a stable URL. Axonics'
--               own SEC Form 424B5 is the model: it states that the company
--               incorporated in Delaware in March 2012 as American Restorative
--               Medicine and commenced operations in late 2013.
--
--   aggregator  Crunchbase, PitchBook, Tracxn, ZoomInfo and the like. These
--               carry a founding year for almost every company and cite nothing
--               for any of it. Admitted as a LAST resort and marked, so a
--               reader is told the year rests on an unsourced compilation. It
--               is the weakest class in this table and the UI must not present
--               it as equal to a filing.
--
-- founded_conflict records a second, different year that a credible source also
-- gave. Onward Medical is the case that prompted it: reputable sources say 2014
-- and reputable sources say 2015. Picking one silently would hide a genuine
-- disagreement behind a single confident number, which is the failure this
-- whole exercise keeps rediscovering. Where it is set, the page shows the year
-- with its disagreement rather than pretending to certainty.

alter table organizations
  add column if not exists founded_conflict text;

comment on column organizations.founded_conflict is
  'A different founding year another credible source gives, with that source. Set only when sources genuinely disagree.';

alter table organizations
  drop constraint if exists organizations_founded_year_sourced;

alter table organizations
  add constraint organizations_founded_year_sourced
  check (
    founded_year is null
    or (
      founded_source_kind in (
        'company_site', 'wikidata', 'wikipedia', 'record_description',
        'companies_house', 'press', 'aggregator'
      )
      and (founded_source_url is not null or founded_source_kind = 'record_description')
    )
  );

comment on column organizations.founded_source_kind is
  'press | wikidata | wikipedia | company_site (self-reported) | aggregator (unsourced compilation) '
  '| record_description (our own text, no URL). Incorporation dates belong in incorporated_year.';
