-- 023-founded-institutional-sources.sql
--
-- Three more source kinds: `university`, `accelerator` and `registry`.
--
-- The web-search sweep kept landing on a class of source the constraint had no
-- name for: an institution announcing its OWN spin-off. IDIBELL's newsroom
-- saying ADmit Therapeutics was "founded at the end of 2017 as a spin-off from
-- the Bellvitge Biomedical Research Institute". tech2b, Upper Austria's public
-- startup incubator, listing Rewellio GmbH with its founders and address.
-- Maastricht Health Campus on Brain Innovation B.V.
--
-- That is not press. A journalist reporting a founding year is summarising
-- somebody else's record; the parent institute IS the record. Filing these as
-- `press` would have worked and would have understated them, and filing them as
-- `company_site` would have been wrong, because the whole point is that the
-- claim comes from someone other than the company.
--
-- Both are `weak: false` in SOURCE_CLASS, so they render with their host and no
-- caveat, unlike `aggregator`.
--
-- `registry` fixes an error rather than adding a capability. The only registry
-- kind was `companies_house`, which the UI renders as "UK register" — so three
-- companies were credited to the wrong country: SensArs to the UK when its
-- source is the Swiss commercial register (UID CHE-130.906.673), and Avantari
-- and TerraBlue XT to the UK when theirs is the Indian MCA register. A national
-- company register is a strong source and deserved a name that is not a British
-- one. `companies_house` stays, because the bulk-download pipeline writes it and
-- for those 35 rows it is accurate.
--
-- The constraint is the reason this migration exists at all rather than being a
-- one-line change to a JavaScript set. `organizations_founded_year_sourced`
-- enforces in the database that a founding year cannot exist without a source
-- kind and a URL, so widening the vocabulary is a schema change. It caught three
-- rows the moment the applier tried to write them, which is the enforcement
-- working: the invariant lives where the data lives, not only in the code that
-- happens to be writing today.

alter table organizations
  drop constraint if exists organizations_founded_year_sourced;

alter table organizations
  add constraint organizations_founded_year_sourced
  check (
    founded_year is null
    or (
      founded_source_kind in (
        'company_site', 'wikidata', 'wikipedia', 'record_description',
        'companies_house', 'press', 'aggregator',
        'university', 'accelerator', 'registry'
      )
      and (founded_source_url is not null or founded_source_kind = 'record_description')
    )
  );

comment on column organizations.founded_source_kind is
  'press | wikidata | wikipedia | companies_house | university (a parent institute announcing its own '
  'spin-off) | accelerator (an incubator''s own record) | registry (a national company '
  'register that is not the UK one) | company_site (self-reported) '
  '| aggregator (unsourced compilation) | record_description (our own text, no URL). '
  'Incorporation dates belong in incorporated_year.';
