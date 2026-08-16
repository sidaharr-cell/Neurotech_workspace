# Founding and incorporation data: where this stands

**Written 15 Aug 2026, end of session. Branch `revamp`, not merged, not pushed.**

Read this first if you are picking the work up. The short version: the schema,
the pipelines, the guards and the UI are finished and verified. The web-search
sweep is 16 companies into 1,084 and cannot be finished without a person driving
it, for the reason in "What cannot be automated" below.

## What a reader sees now

A company page and the companies list show a founding year **only when it has a
source**, and always with the class of that source. `icn2.cat (reported)` reads
differently from `pitchbook.com (unsourced compilation)`, which is the point.
Incorporation appears only when no founding year is known, is labelled
"Incorporated" and never "Founded", and carries a line saying why the two
differ. Disputed years show a dagger and state the disagreement.

The companies list sorts oldest or newest first over `age_year`. Companies with
no date sort LAST in both directions: a null is unknown, not new.

The capital-versus-stage figure sizes each dot by company age, taking a founding
year first and falling back to incorporation.

## Coverage

| | count | of 1,084 |
|---|---|---|
| sourced founding year | 192 | 18% |
| incorporation year or bound | 242 | 22% |
| either (`age_year`) | 376 | 35% |
| neither | 708 | 65% |

By source: 96 Wikidata, 86 company site, 28 our own record description, 13 from
web search. Wikipedia was tried and **withdrawn** — 33 of its 47 matches pointed
at the wrong article.

## What cannot be automated

`WebSearch` is a tool invoked one call at a time inside a turn. It is not
scriptable the way the scrapers are, so the remaining ~1,068 companies need
roughly a hundred rounds of a person prompting and the model searching. There is
no way to leave it running.

Everything else here IS scriptable and has been run to completion.

## The pipelines, and what each is worth

| script | source | status |
|---|---|---|
| `backfill-incorporation.js` | SEC Form D Item 2 | run; 207 of 214 companies with a CIK |
| `backfill-companies-house-bulk.js` | UK register bulk download, no key | run; 35 written |
| `backfill-companies-house.js` | UK register API | **never run**; needs a key the project declined |
| `backfill-founded.js` | Wikidata, company sites | run over all 1,084 |
| `apply-search-findings.js` | `scratch/search-findings.json` | run; rerun after each batch of searches |
| `audit-company-existence.js` | company websites | run over 703; verified 8 |
| `audit-scope.js` | stored text | run; reports only |

## How to resume the search

1. Pick the next companies: highest `rank_score` with `age_year is null`.
2. Search. Record each result into `scratch/search-findings.json` with `name`,
   `year`, `kind`, `url`, `evidence`, `confidence`, and `conflict` where sources
   disagree.
3. `node --env-file=.env scripts/apply-search-findings.js` to preview, then
   `--commit`.

The applier refuses anything it cannot match to exactly one company by name, and
refuses a low-confidence finding that does not carry the conflict explaining it.

## What is known to be wrong, and left alone

**The legacy `founded` column.** 22 values, no source, and five of the twelve
that can be checked against a filing disagree with it. It no longer renders
anywhere. It was NOT overwritten from filings, though that was asked for, because
filings give an *incorporation* year: Saluda Medical's filing reads 2023 for a
company that predates it by a decade, so the overwrite would have made it worse.
The decision is still open.

**One duplicate company row.** "Precision Neuroscience" and
"PrecisionNeuroscience" hash to different UUIDv5 ids and both exist.
`audit-duplicate-orgs.js` reports it and can merge fields onto the fuller row; it
never deletes, because which `/company/:id` stops working is a decision for a
person.

An earlier version of this document said NINE duplicates. That was wrong, and
worth recording why: the scope audit paginated on `rank_score` with no unique
tiebreaker, so page boundaries shuffled and 1,084 rows came back holding 1,061
distinct ids — 23 served twice, 23 never read. Every paginated read over
organizations now ends with `.order('id')`.

**301 descriptions that never mention the nervous system.** A description
problem far more often than a scope problem — electroCore makes a vagus nerve
stimulator and its stored description is about smartphones, which is scraped from
the wrong place. Worth its own pass.

**13 rows that read as something other than a company**: a professional society,
several universities, four clinics, an agency. Listed in
`scratch/scope-audit.json`. Nothing was deleted.

## Things that were wrong and are now fixed

Kept because they are the reason the guards exist, and any future source will be
tempted by the same mistakes.

- **Wikipedia matched the wrong article 33 times in 47.** Otsimo was dated from
  "World Autism Awareness Day", Northstar Neuroscience from "North Star Mall".
  Source withdrawn.
- **Eight companies were all dated 2005** from `hugedomains.com` — a parking
  page's own footer year — because redirects were followed off-site.
- **Two companies were scraped from LinkedIn**, which CLAUDE.md forbids.
- **Sana Health was dated 1993** from "he has been pain-free since 1993";
  Litesprite 2018 from "Logan Niles, player since 2018". About pages are full of
  biographies and testimonials.
- **The UK register matched 124 companies and most were not British** — ableX in
  Auckland, AE Studio in Los Angeles — until a jurisdiction gate was added. 35
  survived.
- **`preferIncorporation` kept the weaker of two bounds**, understating the age
  of every company that filed Form D more than once.
- **A Supabase read was silently truncated at 1,000 rows** of 1,084, which would
  have counted 84 companies as having no founding year without anyone noticing.
- **Paginated reads ordered on a non-unique column** served 23 rows twice and
  skipped 23 entirely, which is where the phantom "nine duplicates" came from.

Every one of those is now a test with the real string in it.
