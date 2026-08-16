# Founding and incorporation data: where this stands

**Written 15 Aug 2026, revised 16 Aug. Branch `revamp`, not merged, not pushed.**

Read this first if you are picking the work up. The short version: the schema,
the pipelines, the guards and the UI are finished and verified. The web-search
sweep has reached 289 of 1,084 companies and is running in batches; it cannot be
left unattended, for the reason in "What cannot be automated" below.

**The sweep's most valuable output is no longer the years.** It is
`scripts/data/founding-unresolved.json` — 183 entries recording, with URLs, that
the index contains rename-duplicates, rows named after products rather than
companies, rows that are not companies at all, dead domains, wrong locations and
wrong descriptions. See "What the sweep found that nobody was looking for".

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
| sourced founding year | 392 | 36% |
| incorporation year or bound only | 184 | 17% |
| either (`age_year`) | 576 | 53% |
| neither | 508 | 47% |

By source kind: 111 company site, 96 Wikidata, 82 press, 58 aggregator, 37 our
own record description, 5 Wikipedia, 3 UK register.

These numbers move every round. Re-measure rather than quoting them.

Those last two need explaining, because Wikipedia was **withdrawn as an
automated source** — 33 of its 47 matches pointed at the wrong article, dating
Otsimo from "World Autism Awareness Day". Kernel and Kendall Research Systems
survive because a *person-driven search* landed on the right article and
corroborated it elsewhere; the evidence string on each records the corroboration.
The lesson is that the failure was in matching a name to an article without
reading it, not in the encyclopedia.

The 58 aggregator-sourced years render with a visible caveat rather than being
hidden or trusted silently.

## What cannot be automated

`WebSearch` is a tool invoked one call at a time inside a turn. It is not
scriptable the way the scrapers are, so the remaining ~508 companies without an
`age_year` need many rounds of prompting and searching. Background subagents make
each round wider — four agents at nine companies each is the configuration that
finishes without stalling — but nothing here runs unattended to completion.

The per-agent search budget is real and was learned the hard way: at seventeen
companies per agent, four of six agents exhausted their budget partway and
returned nothing for the tail of their list. Nine companies with an explicit
"2-3 searches each, then move on" cap completed 4 of 4.

Everything else here IS scriptable and has been run to completion.

## The pipelines, and what each is worth

| script | source | status |
|---|---|---|
| `backfill-incorporation.js` | SEC Form D Item 2 | run; 207 of 214 companies with a CIK |
| `backfill-companies-house-bulk.js` | UK register bulk download, no key | run; 35 written |
| `backfill-companies-house.js` | UK register API | **never run**; needs a key the project declined |
| `backfill-founded.js` | Wikidata, company sites | run over all 1,084 |
| `apply-search-findings.js` | `scripts/data/founding-findings.json` | run; rerun after each batch of searches |
| `audit-company-existence.js` | company websites | run over 703; verified 8 |
| `audit-scope.js` | stored text | run; reports only |
| `next-founding-batch.js` | Supabase + the two data files | picks what to search next |

## What the sweep found that nobody was looking for

Every one of these came out of searching for a year and reading what came back.
None of it is deleted or changed — each is a decision for a person — but the
evidence is in `scripts/data/founding-unresolved.json` against the company name.

Every entry carries one verdict from the controlled vocabulary in
`scripts/lib/verdicts.js`, so the register can be counted:

| verdict | count | meaning |
|---|---|---|
| `scope` | 71 | probably not neurotechnology |
| `not-a-company` | 11 | a project, consortium, society, facility or book |
| `dead-domain` | 11 | does not resolve, parked, or resold |
| `no-year` | 10 | searched, nothing findable |
| `product-not-company` | 9 | the year belongs to a parent the index never names |
| `renamed` | 8 | one company, trading under another name |
| `wrong-location` | 6 | the location field is wrong |
| `wrong-entity` | 5 | describes a different company than its name says |
| `year-disputed` | 5 | sources disagree, none decisive |
| `duplicate` | 3 | the same company as another row |
| `dissolved` | 2 | confirmed closed by a registry |

`normalise()` throws on an unrecognised verdict rather than defaulting, because
the field had already drifted into 60-odd strings for these 18 categories before
anyone noticed — "no year", "no year found", "no founding year found" and "no
founding year established" all meaning one thing.

**Rows that are not companies** include BrainGate, an academic BCI consortium;
the San Francisco chapter of the IEEE Engineering in Medicine and Biology
Society; EyeWire, a citizen-science game from Sebastian Seung's lab; SAM App, a
UWE Bristol project; Panic Away, a self-help book; and the Neurorobotics Research
Laboratory at Berliner Hochschule für Technik.

**Rows named after a product** include Sleepio (Big Health), BioMind
(Hanalytics), Pegaces (NeuroGeneces), NeuroFUS (Sonic Concepts), URGONight
(URGOTECH), BrainVoyager (Brain Innovation B.V.) and Mightier (Neuromotion Inc).

**Included on the name rather than the business.** Medibrane makes polymer covers
for stents — the "brane" is membrane. DataNovo is patent analytics whose only
neuro connection is the phrase "neural network" in its AI marketing. Vita Beans
Neural Solutions is edtech whose name comes from an AI origin story. This is a
distinct failure mode from ordinary scope drift, and worth a targeted pass.

**Facts that are simply wrong.** Neutun is in Toronto, not Palo Alto; Lucid Care
in Palo Alto, not Los Angeles; Brainbit in California, not New York; NeuroCrowd
in Mexico City, not Houston. Zed Medical's stored description calls it a cerebral
aneurysm device — it is a coronary catheter.

**Roughly fifteen websites are dead, parked, or now serve something unrelated.**
A parked domain still returns 200 and still has a footer year, which is how eight
companies were once all dated 2005 from `hugedomains.com`.

## How to resume the search

0. `node --env-file=.env scripts/next-founding-batch.js 36` prints the next
   companies, skipping every name already in the findings or unresolved file.
1. Or pick them by hand: highest `rank_score` with `age_year is null`.
2. Search. Record each result into `scripts/data/founding-findings.json` with `name`,
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

**Three duplicate company rows, found two different ways.** "Precision
Neuroscience" and "PrecisionNeuroscience" hash to different UUIDv5 ids and both
exist; `audit-duplicate-orgs.js` finds that one by normalising the name. The
other two — G-Therapeutics/ONWARD Medical and Eegapps Medical/Incereb — are
renames, share no letters, and were found only because a searcher read a company
history. The audit never deletes, because which `/company/:id` stops working is a
decision for a person.

This has a live consequence: Precision Neuroscience's founding year, 2021, is
sitting in `founding-findings.json` and **cannot be written**. The applier refuses
it with "matches 2 rows in the database" rather than picking one. Merge the rows
and it lands.

An earlier version of this document said NINE duplicates. That was wrong, and
worth recording why: the scope audit paginated on `rank_score` with no unique
tiebreaker, so page boundaries shuffled and 1,084 rows came back holding 1,061
distinct ids — 23 served twice, 23 never read. Every paginated read over
organizations now ends with `.order('id')`.

**Seventeen descriptions hold a region instead of a description.** customKYnetics
reads "USA - Southeast", DeepMind reads "UK", Deep Brain Innovations reads
"USA - Chicago/Midwest". They sit at alphabetical positions 278 to 294 with NO
gaps — a contiguous run of seventeen, which is a single batch write rather than
seventeen coincidences. Every one already has a `location` that is strictly more
specific than its description ("Cleveland, USA" against "USA - Chicago/Midwest"),
so the description is both wrong and redundant and can be cleared without losing
anything.

A caution about how NOT to date this: every row in the table carries
`first_seen` of 2026-07-29, because the whole table was rebuilt that day after
the funding data loss. That timestamp therefore says nothing about which rows the
bad write touched, and an earlier draft of this note wrongly cited it as
evidence. The contiguity is the evidence.

A further eleven rows carry the literal string "N/A" or "n/a" as their
description. Those are scattered rather than contiguous and look like an ordinary
missing-value defect, not the same bug.

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
