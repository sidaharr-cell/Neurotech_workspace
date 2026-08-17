-- 022-company-age-year.sql
--
-- One column to sort and filter companies by age. Run once, by hand, in the
-- Supabase SQL editor.
--
-- Why a generated column rather than ordering on founded_year:
--
--   Three columns can answer "how old is this company", and they answer it with
--   different confidence. Ordering on founded_year alone would silently drop the
--   242 companies whose only date is an incorporation year — they would sort as
--   though they had no age at all, which is exactly the kind of quiet exclusion
--   that has already bitten this table twice.
--
--   PostgREST cannot express a coalesce in an `order`, and doing it in the
--   client would only work within one page of results, which for a paginated
--   list is not sorting at all. So the coalesce is stored, and Postgres does it.
--
-- The precedence mirrors ageBand() in src/lib/fundingBoard.js exactly. Change
-- one, change the other:
--
--   founded_year              what "how old is this company" actually asks
--   incorporated_year         a proxy that can trail founding by years, and
--                             resets entirely on a redomiciliation
--   incorporated_before_year  a bound; the latest year it permits is the only
--                             year it actually asserts
--
-- STORED, not a view: it is read on every list page and sorted on, and it
-- changes only when one of its three inputs does.

alter table organizations
  add column if not exists age_year int
  generated always as (
    coalesce(founded_year, incorporated_year, incorporated_before_year)
  ) stored;

comment on column organizations.age_year is
  'Best available year for company age: founded_year, else incorporated_year, else '
  'incorporated_before_year. Generated. Mirrors ageBand() precedence in fundingBoard.js. '
  'Sort and filter only — a page must show which of the three answered, since they are '
  'different facts with different confidence.';

-- Partial: most rows have no date at all, and every query that uses this column
-- is asking for the ones that do.
create index if not exists organizations_age_year_idx
  on organizations (age_year desc)
  where age_year is not null;
