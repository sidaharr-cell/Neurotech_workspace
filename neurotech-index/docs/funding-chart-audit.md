# Funding chart audit (Phase 0)

Reconnaissance for the funding chart revision. No files were edited in this phase.

Date: 2026-07-28. Branch: `revamp`. All paths relative to `neurotech-index/`.

---

## 1. The chart component

**File:** `src/components/FundingChart.jsx` (87 lines).
**Rendered at:** `src/pages/Companies.jsx:121`, directly under the page heading. It is the only usage.

**Charting library: none.** There is no chart library in `package.json`. The bars are plain
`<div>` elements with a Tailwind `bg-accent` class and an inline `width` percentage. Bar opacity
fades by row index (`opacity: 1 - i * 0.018`). Layout is flexbox rows inside a `<figure>`.

This matters for Phase 4: there is no chart API to fight with, and adding stage badges, rank
numbers, or a table view is ordinary React and Tailwind work. The "do not restyle" rule is easy to
honour because every visual decision is already an explicit class name in one file.

Formatting helpers live at the top of the same file:

- `fmtMoney` renders `$1.3B` above 1000 and `$649M` below. Values are in millions.
- `dateLabel` uses `{ month: 'short', year: '2-digit' }`, which produces `Jun 25`. This is the
  defect named in Phase 4.
- `monthsSince` drives the mint "recent raise" dot at under 6 months.

Name truncation is CSS (`truncate` on a `w-28 sm:w-44` span) with the full name in a `title`
attribute. There is no JavaScript string slicing to remove.

---

## 2. The organization data model

**Table:** `organizations` in Supabase. Base definition at `supabase/schema.sql:66`, extended by
migrations `001-facets.sql`, `003-entity-graph.sql`, `007-org-image.sql`.

Live column list, confirmed by querying a row:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | no | primary key, `gen_random_uuid()` |
| `name` | text | no | the join key everything else uses |
| `type` | text | yes | `company` or `lab` in practice |
| `location` | text | yes | free text, for example `Eindhoven, NL` |
| `founded` | text | yes | year as a string, often empty |
| `description` | text | yes | |
| `focus_areas` | jsonb | yes | default `[]` |
| `website` | text | yes | |
| `founders` | jsonb | yes | default `[]` |
| `rank_score` | real | yes | default 0 |
| `created_at` | timestamptz | yes | default `now()` |
| `facet_function` | text[] | yes | default `{}`, values like `stimulates`, `records`, `decodes` |
| `facet_access` | text[] | yes | default `{}` |
| `facet_application` | text[] | yes | default `{}`, values like `pain`, `movement_restoration` |
| `in_scope` | boolean | yes | default true |
| `classifier_version` | text | yes | |
| `source` | text | yes | from `003-entity-graph.sql` |
| `source_id` | text | yes | |
| `source_url` | text | yes | |
| `first_seen` | timestamptz | yes | default `now()` |
| `last_updated` | timestamptz | yes | default `now()` |
| `pipeline_version` | text | yes | |
| `image_url` | text | yes | |

**There is no funding column.** There is no `status`, no `modality`, no `furthest_stage`, no
`legal_name`, no `display_name`, no `cik`. Every field Phase 1 asks for is new.

Row counts: 1,084 rows with `type = 'company'`, all with distinct names, so a name resolves to
exactly one company id. There are also a handful of stray rows with `type = 'Company'` (capital C),
including a second "Neuralink" and a second "Blackrock Neurotech". Those rows are invisible to
`getCompanyById`, which filters `.eq('type', 'company')`, so they are unreachable dead records
rather than an ambiguity risk. Worth cleaning, but not in scope here.

**Existing near-equivalents to Phase 1 fields.** Per hard rule 4, use these rather than duplicating:

- `facet_function` and `facet_application` already carry a classification close to `modality`. They
  are multi-valued arrays, they are populated for only about half of the top 20, and their vocabulary
  (`stimulates` / `records` / `decodes`) cuts across the proposed modality enum rather than matching
  it. Recommendation: add `modality` as a new single-value field, and note in the migration that it
  is derived from, not equal to, the facet arrays.
- `in_scope` is an existing boolean that expresses roughly what `inclusion_basis` is meant to defend.
  See section 8, because it currently disagrees with the chart.
- `source_url`, `last_updated`, `first_seen`, `pipeline_version` are the existing provenance columns
  on the entity. They cover the record, not individual funding figures.

---

## 3. The funding data model

**Funding is not in the database.** This is the single most important constraint for the whole plan.

Funding lives in two committed JSON files, merged at render time in the browser:

- `src/data/funding.json` — machine-generated from SEC EDGAR by `scripts/backfill-funding.js`.
  1,084 entries, one per company row in the DB. 144 have a dollar total. The other 940 are negative
  markers of the shape `{ "source": "none", "checkedAt": "..." }`.
- `src/data/companies-funding.json` — 28 hand-curated entries. This is where IPO proceeds, foreign
  rounds, and acquisitions get in.

The merge is `src/lib/companyFunding.js`. It keys on **company name string**, builds a module-level
`MAP` at import time, and exports `getFunding(name)` and `topFunded(limit)`. The merge rule is
`total = max(sec.total, curated.total)`, with round metadata taken from whichever source has the more
recent `latestDate`.

Per-company shape after merge:

```
{ total, latestAmount, latestDate, latestRound, roundYear, rounds: [{date, amount}], source }
```

`total` and `latestAmount` are in millions of dollars. `source` is one of `sec`, `curated`,
`sec+curated`, `none`.

**A rounds array already exists.** `funding.json` stores per-round `{ date, amount }` for
SEC-resolved companies, produced by 120-day clustering of Form D filings. 107 of the 144
SEC-sourced companies have two or more rounds. `CompanyPage.jsx` already renders a per-year funding
timeline from it. This directly contradicts the Phase 2 assumption that no round history exists; see
section 8.

Consequences for Phase 1 and Phase 2:

1. A Postgres migration alone does not fix the chart. Either funding moves into Supabase (new
   `organizations` columns plus a `funding_rounds` table, with `backfill-funding.js` rewritten to
   write rows instead of JSON), or the new fields are added to the JSON overlay and the migration is
   deferred. That is a decision to make at the start of Phase 1, and it should be made explicitly
   rather than by picking whichever is easier.
2. The chart currently does zero network requests. Moving funding into Supabase makes the Companies
   page depend on a query it does not make today.
3. Name-string keying is the join. Any new table needs an `organization_id` foreign key, and the
   backfill has to resolve 28 curated names plus 144 SEC names to org ids. Spot-checked all 20
   top-chart names against `organizations` where `type = 'company'`: all 20 resolve exactly, so the
   resolution is mechanical.

---

## 4. The SEC Form D ingestion path

**Script:** `scripts/backfill-funding.js` (188 lines).
**Runs:** daily at 06:00 UTC from `.github/workflows/refresh.yml`, step "Refresh company funding",
with `continue-on-error: true`. The workflow commits the regenerated `funding.json` back to `main`.

Flow:

1. `loadCompanies()` reads every `organizations` row with `type = 'company'`, taking `name` and
   `founded`. Falls back to `src/data/companies.json` when Supabase is not configured.
2. Incremental skip: an entry with a `checkedAt` inside `STALE_DAYS = 21` is copied forward
   untouched, including negative `source: none` markers.
3. `resolve(name)` calls EDGAR full-text search:
   `https://efts.sec.gov/LATEST/search-index?q="<name>"&forms=D`.
4. Hits are filtered twice. `BAD` drops issuers whose display name contains `spv|fund|trust|partners|
   capital|ventures|holdings|series|lp`. Then `core(displayName) === core(queryName)`, where `core`
   strips a `(CIK ...)` suffix, strips legal words via the `LEGAL` regex, lowercases, and removes
   non-alphanumerics. This is exact-match-after-normalisation, not prefix matching.
5. The most frequent CIK among surviving hits wins. All of that CIK's filings are fetched
   individually at `/Archives/edgar/data/<cik>/<adsh>/primary_doc.xml`, and the amount is
   `max(totalAmountSold, totalOfferingAmount)`.
6. `clusterTotal` and `clusterRounds` group filings into rounds with a 120-day gap threshold and take
   the peak amount per cluster.
7. Namesake rejection: if `founded` is known and the latest filing predates it, the whole result is
   discarded.
8. Rate limiting: 120 ms between filing fetches, 200 ms between companies. User-Agent is set as
   EDGAR requires.

**Failure handling is the core defect.** Every failure mode collapses into one output,
`{ source: 'none' }`:

- no EDGAR hits at all,
- hits that all failed the `BAD` or `core` filters,
- a matched CIK whose filings all parsed to zero,
- any thrown exception, since `resolve` wraps everything in `try { } catch { return null }`,
- a result rejected by the founding-year check.

Nothing distinguishes "not a US issuer" from "never matched" from "matched, no recent round" from
"the fetch threw". There is no log of which branch fired. Phase 2 item 1 is therefore not
instrumentation-on-top; the diagnostic information is discarded at the point of failure and the
`catch` needs to be split before anything can be measured.

There is also a `--verify` mode that re-checks only entries currently marked `source: 'sec'`, used to
purge namesake false positives after a matcher change.

---

## 5. How the top 20 is selected, and what the sorts do

`FundingChart.jsx:21` calls `topFunded(limit * 3)`, so the candidate pool is the **top 60 companies
by total raised**. The active sort then reorders that pool and slices to 20.

So the prompt's description is half right. The toggles do reselect, but only within a pool that is
itself fixed by total raised. A company ranked 61st or lower by lifetime total can never appear under
"Latest raise size," no matter how large its recent round. The misleading-title problem is real: the
heading says "by funding raised" under all three sorts, and the bar length switches to the latest
raise amount under the `latest` sort while the heading does not change.

Current sorts, from the `SORTS` array:

| id | Label | Comparator |
|---|---|---|
| `total` | Total raised | `b.total - a.total` |
| `latest` | Latest raise size | `b.latestAmount - a.latestAmount` |
| `recent` | Latest raise date | `monthsSince(a) - monthsSince(b)` |

Companies with no latest raise get `latestAmount = 0` and `monthsSince = Infinity`, so they sort last
under both of the non-default sorts. That is already the behaviour Phase 3 asks for.

There is no filter control of any kind today. No status filter, no modality filter, no stage filter.
Phase 3 adds the first ones.

**The live top 20** (computed from the committed data on 2026-07-28):

| # | Company | Total | Latest raise | Source | Rounds |
|---|---|---|---|---|---|
| 1 | Neuralink | $1330M | $649M, 2025-06-12 | sec+curated | 5 |
| 2 | Setpoint Medical | $581M | $115M, 2025-10-28 | sec+curated | 11 |
| 3 | NeuroPace | $340M | $85M, 2021-04-22 | curated | 0 |
| 4 | Ceribell | $334M | $180M, 2024-10-11 | curated | 0 |
| 5 | Cognito Therapeutics | $312M | $105M, 2026-03-05 | sec+curated | 3 |
| 6 | Saluda Medical | $300M | $30M, 2025-11-12 | sec+curated | 2 |
| 7 | Science Corporation | $290M | none | curated | 0 |
| 8 | Pear Therapeutics | $268M | $132M, 2021-03-02 | sec | 4 |
| 9 | Precision Neuroscience | $252M | $150M, 2024-10-17 | sec+curated | 4 |
| 10 | Merge Labs | $250M | none | curated | 0 |
| 11 | Onward Medical | $250M | none | curated | 0 |
| 12 | Nalu Medical | $231M | $115M, 2024-10-09 | sec+curated | 3 |
| 13 | Atomwise | $228M | $50M, 2025-03-14 | sec | 3 |
| 14 | iSchemaView, Inc. | $225M | $75M, 2025-09-04 | sec | 3 |
| 15 | Blackrock Neurotech | $210M | none | curated | 0 |
| 16 | MicroTransponder | $198M | $65M, 2025-03-14 | sec | 11 |
| 17 | Neuros Medical | $191M | $65M, 2025-08-06 | sec+curated | 11 |
| 18 | ShiraTronics | $180M | $66M, 2024-09-30 | sec | 4 |
| 19 | Cala Health | $170M | $51M, 2024-12-09 | sec+curated | 4 |
| 20 | Axonics Modulation Technologies | $163M | none | curated | 0 |

Rank 21 is Conformal Medical at $162M, which is the record that would be promoted if Atomwise is
dropped. Note that Conformal Medical builds a left atrial appendage occlusion device, which is
cardiac, not neurological. It cannot get an `inclusion_basis` under the stated rule either. Rank 22
is Elucid Bioimaging at $160M, which is cardiovascular imaging software and also fails. Rank 23 is
Axon Therapies at $154M, which despite the name is splanchnic nerve ablation for heart failure, so it
is a genuine edge case. Rank 24 is Paradromics at $145M, which is an unambiguous implanted BCI.

That is a Phase 1 finding worth flagging now: dropping Atomwise does not open one slot, it opens a
run of them, and the honest replacement is probably Paradromics or Synchron. See section 8.

The five `n/a` cells in the current top 20 are Science Corporation, Merge Labs, Onward Medical,
Blackrock Neurotech, and Axonics. All five are curated-only records whose curated entry has a
`latestRound` label and a `roundYear` but no `latestAmount` and no `latestDate`. Their SEC entries
are all `source: none`. The five underlying situations really are different:

| Company | Real reason | Phase 1 enum value |
|---|---|---|
| Science Corporation | US private, no Form D matched | `no_filing_found` |
| Merge Labs | US private, founded 2025, no Form D matched | `no_filing_found` |
| Onward Medical | Dutch, listed on Euronext | `foreign_issuer_not_covered` and `public` |
| Blackrock Neurotech | US private, strategic investment, no Form D matched | `no_filing_found` |
| Axonics | Acquired by Boston Scientific in 2024 | `not_applicable_acquired` |

Two non-US companies in the top 20, as the prompt predicts, but they are Onward Medical (NL) and
Saluda Medical (Sydney, AU). Saluda does resolve to SEC filings, presumably through a US subsidiary,
so the foreign-issuer branch must not blindly null out a company with real US filings.

---

## 6. Provenance currently stored for funding figures

Almost none.

| Wanted | Stored today |
|---|---|
| Source URL | No. `backfill-funding.js` builds the archive URL, fetches it, and discards it. |
| Retrieval timestamp | Partly. `checkedAt` per company in `funding.json`. Nothing per figure, and the curated file has no timestamp at all. |
| Filing accession number | No. `h._source.adsh` is used to build the fetch URL and never persisted. |
| CIK | No. Resolved in memory each run and thrown away, which is also why the matcher cannot improve incrementally. |
| Confidence | No. The `source` string (`sec` / `curated` / `sec+curated` / `none`) is the nearest thing. |

Two further hazards found in the data:

- The `source` field inside `companies-funding.json` is unreliable. The Neuralink and Saluda entries
  are labelled `"source": "sec"` in the curated file, but they are hand-entered numbers. Do not carry
  that field into `total_raised_confidence` without re-verifying each of the 28 entries.
- `latestDate` is the EDGAR filing date, not the round announcement date. The chart presents it as
  when the company raised. The gap is usually days to weeks, but the label should say what it is.

For contrast, the entity layer does have provenance. `regulatory_records` (3,251 rows) carries
`source`, `source_url`, `number`, `pathway`, `decision_date`, `first_seen`, `last_updated`. The
funding layer is the outlier.

---

## 7. Organization links to other entities, and the detail route

**A detail route exists:** `/company/:id`, where `:id` is the org uuid, wired at `src/App.jsx:33` to
`src/pages/CompanyPage.jsx`. Labs use `/lab/:id`. Company cards in the Companies list already link to
it (`src/pages/Companies.jsx:63`). The funding chart does not, because it only has a name string.
Adding the Phase 4 row link needs a name-to-id map, which is cheap given that all 20 names resolve
uniquely.

**Links to other entities exist by two independent mechanisms:**

1. The `relationships` table from `003-entity-graph.sql`, with 373,870 rows. `getOrgGraph(orgId)` in
   `src/lib/data.js:445` reads edges pointing at the org with predicates `made_by` (devices),
   `sponsored_by` (trials, stored in `news_feed` with `entry_type = 'trial'`), and `affiliated_with`
   (researchers). Confidence is stored per edge.
2. `getCompanyRelated(name)` in `src/lib/data.js:395`, a live `ILIKE` name match against devices by
   manufacturer, patents by assignee, trials by sponsor, and news by title or summary. This is the
   fuzzy fallback and it runs alongside the graph.

Edge coverage for the top 20 is thin and uneven. Measured counts of edges pointing at each org:

- Devices via `made_by`: Ceribell 13, Cala Health 5, and 1 each for Neuralink, Blackrock Neurotech,
  Precision Neuroscience, Nalu Medical. Zero for the other 14.
- Trials via `sponsored_by`: Setpoint 9, MicroTransponder 7, NeuroPace 7, Neuralink 6, Science 6,
  Onward 4, Nalu 3, ShiraTronics 2, Cala 1. Zero for the other 11.
- Researchers via `affiliated_with`: zero for all 20.

`regulatory_records` links to `device_id`, not to an organization, so an FDA clearance reaches a
company only through the device `made_by` edge. With only 6 of 20 companies having any device edge,
`furthest_stage` derived from `stage_evidence_type = 'openfda'` will be null for most of the top 20
on day one. Trials give better coverage, 9 of 20, so `clinicaltrials_gov` is the more productive
evidence source to build first.

Phase 5 depends on this. A scatter restricted to records with real stage evidence would plot
roughly 9 to 12 of the 20 today, and only after someone reads the trials to determine phase.

---

## 8. Assumptions in the prompt document that turned out wrong

**1. "The data model for organizations" implies funding is on the organization record, or in a table.
It is neither.** Funding is two committed JSON files merged in the browser by company name. Every
Phase 1 field about funding, and the whole of Phase 2's rounds table, has to start with a decision
about whether funding moves into Postgres. The prompt never asks that question.

**2. "The Phase 2 backfill populates `funding_rounds` from the existing latest-raise fields only, so
the table will hold at most one round per company on day one."** Wrong. `funding.json` already stores
a dated `rounds` array per SEC-resolved company, built by 120-day clustering of individual Form D
filings. 107 of 144 SEC-sourced companies have two or more rounds. Within the current top 20, 13 have
multiple rounds and 10 have history spanning three years or more.

This weakens but does not remove the case for shipping with `total_raised`. The seven top-20 records
with no round history at all are the curated-only ones, and they include four of the five largest
non-Neuralink totals. A trailing-24-month sort would silently drop NeuroPace, Ceribell, Science,
Merge Labs, Onward, Blackrock, and Axonics to the bottom because nobody has entered their rounds, not
because they did not raise. So: keep `total_raised` as the launch default, but the switch condition
should be measured as "80 percent of records have round history spanning three years," not "the table
holds more than one round." The existing data already satisfies the weaker reading, and shipping
against the weaker reading would be wrong.

**3. "Two companies in the current top twenty are non-US" and the implication that both should get
`foreign_issuer_not_covered`.** The two are Onward Medical (Eindhoven, NL) and Saluda Medical
(Sydney, AU). Saluda has real, resolved Form D filings, presumably via a US entity. So an
absent-CIK or non-US-location heuristic must not override an existing successful match. Onward is
also publicly listed on Euronext, so it hits two not-applicable reasons at once, and the enum forces
a single value. Suggest ordering the branches: public and acquired first, foreign issuer second.

**4. "Removing Atomwise opens a slot, so the record entering at rank 20 needs an `inclusion_basis`."**
It opens more than one. Ranks 21 and 22 (Conformal Medical, cardiac occlusion; Elucid Bioimaging,
cardiovascular imaging) fail the inclusion rule for the same reason Atomwise does. Rank 23 (Axon
Therapies, splanchnic nerve ablation for heart failure) is a genuine judgement call: it modulates a
nerve, but the indication is cardiac. The first clean entrant is rank 24, Paradromics. Expect to
write four or five `inclusion_basis` decisions, not one.

**5. The prompt does not mention `in_scope`, which already exists and already disagrees with the
chart.** Six of the current top 20 are flagged `in_scope = false` by the existing classifier:
Setpoint Medical, Pear Therapeutics, Nalu Medical, Atomwise, iSchemaView, and Neuros Medical. The
funding chart reads the JSON overlay directly and never consults `in_scope`, so out-of-scope
companies appear on it. Two of those six (Setpoint, Nalu) look like classifier false negatives, since
both build implanted neuromodulation devices. `inclusion_basis` should be reconciled with `in_scope`
rather than added beside it, or the site will hold two contradictory answers to the same question.

**6. "The toggles only reorder a fixed set" of 20.** The pool is the top 60 by total raised, not 20.
The reselection defect is real but narrower than stated, and the fix in Phase 3 is to widen or remove
the pool cap, not to introduce reselection from scratch.

**7. "Add a check, run in CI."** There is no CI for the app. `.github/workflows/refresh.yml` is a
daily data cron; it never runs `npm run build`, `npm run lint`, or `npm test`. Vercel runs the build
on push, but nothing runs the test suite anywhere. Phase 1's validation check needs a CI workflow
created for it, which is unbudgeted work in the prompt.

**8. Charting library.** The prompt asks which one. There is not one. Nothing needs to be worked
around, and nothing constrains the Phase 4 additions.

**9. Modality.** `facet_function` and `facet_application` already classify organizations, with a
different vocabulary and multi-valued semantics. They are populated for 12 of the top 20 and are
partly wrong where populated (Nalu Medical, an implanted stimulator, has empty facets and
`in_scope = false`). Treat them as an input to `modality`, not as `modality`.

**10. `computational_neuro`.** Correctly predicted to be empty. Nothing in the top 25 belongs in it
once Atomwise is dropped. Recommend dropping the enum value at Phase 1 rather than at Phase 2, since
no record can populate it.

---

## Recommended first decision for Phase 1

Before writing any migration, settle this: does funding move into Supabase, or do the new fields
extend the JSON overlay?

Moving to Supabase is the right long-term answer and it is what Phases 1 through 3 are written
against. It also means rewriting `backfill-funding.js` to upsert rows, adding a query path to a page
that currently makes no network call, resolving 172 name strings to org ids, and keeping the daily
cron green through the switch. That is most of a phase of work on its own and it should be
acknowledged rather than absorbed silently into "write the migration."

The alternative, adding `status`, `modality`, `inclusion_basis`, and the provenance fields to the
JSON overlay first, gets the chart honest in days instead of weeks and defers the migration until
`funding_rounds` genuinely needs to be queryable. It costs a second migration later.

I recommend the Supabase migration, because provenance that lives in a hand-edited JSON file is
provenance nobody maintains, and because the validation check in Phase 1 has nothing to run against
otherwise. But this is a scope call, not a technical one, and it is yours.
