-- 024-founded-filing-source.sql
--
-- One more source kind: `filing`.
--
-- A regulatory filing is not a company register and it is not press. Bionik
-- Laboratories' Form 10-K states, in its corporate history, that Bionik Canada
-- was incorporated on 24 March 2011 and that the Delaware entity was renamed
-- Bionik Laboratories Corp. on 13 February 2015 — two facts filed under penalty
-- of perjury. Jogo Health's Reg CF offering statement says the same kind of
-- thing: "Neural Therapeutics Inc was incorporated in the State of Delaware in
-- June 2010. The company was renamed Jogohealth Inc. in 2016."
--
-- Both were being forced into `press` or `registry`, and both labels lie a
-- little: `press` says a journalist reported it, `registry` renders as "company
-- register" and means a national companies house.
--
-- `filing` is already the label the UI uses for an INCORPORATION year sourced
-- from Form D (see foundingLine in src/lib/founded-display.js). A founding year
-- sourced the same way should read the same way, so this adds the kind rather
-- than inventing a second name for it.

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
        'university', 'accelerator', 'registry', 'filing'
      )
      and (founded_source_url is not null or founded_source_kind = 'record_description')
    )
  );

comment on column organizations.founded_source_kind is
  'press | wikidata | wikipedia | companies_house | registry (a national company register that is '
  'not the UK one) | filing (a regulatory filing: SEC 10-K, Reg CF offering) | university (a parent '
  'institute announcing its own spin-off) | accelerator (an incubator''s own record) '
  '| company_site (self-reported) | aggregator (unsourced compilation) '
  '| record_description (our own text, no URL). Incorporation dates belong in incorporated_year.';
