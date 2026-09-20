# NeuroBase

An open, auto-updating index of neurotechnology: papers, devices, companies and
labs, clinical trials, patents and researchers, with the coverage that surrounds
them.

Live at **https://neurobase-live.vercel.app**

Every fact on the site traces to a named source with a link and a date. The
index is rebuilt every night from public data and nothing in it is written by
hand, with the deliberate exception of the picture review described below.

## Where the data comes from

arXiv, bioRxiv and medRxiv, PubMed and Europe PMC, ClinicalTrials.gov, openFDA,
SEC EDGAR, Companies House, PatentsView and the Google Patents public dataset,
plus publisher RSS, Google News and GDELT for coverage.

Nothing is inferred and nothing is estimated. A value the sources do not supply
renders as "Not available" rather than a guess.

## Running it locally

You need Node 24 and nothing else. **The app runs with no credentials and no
backend**, falling back to the JSON snapshots committed in
`neurotech-index/src/data/`, so this works on a fresh clone:

```bash
cd neurotech-index && npm ci && npm run dev
```

That serves the site on http://localhost:5173 with a few hundred real records
in it. Everything below is only needed to rebuild the index yourself.

```bash
npm run build     # production build to dist/
npm test          # vitest, 1200+ tests
npm run lint      # oxlint
```

There is no typecheck. The codebase is plain JS and JSX with no TypeScript, so
"typecheck passes" means lint and build pass.

### Running against your own database

Copy `neurotech-index/.env.example` to `.env` and fill it in. Only the Supabase
and Anthropic values are needed to start; every other variable is optional and
the script that wants one says so and skips rather than failing.

Create the schema from `neurotech-index/supabase/schema.sql`, then apply the
numbered migrations in `supabase/migrations/` in order, in the Supabase SQL
editor. They are additive and each is meant to be run once.

```bash
npm run daily        # the whole nightly sequence
npm run verify:cron  # integrity check; exits non-zero if a table collapsed
```

Use `npm run daily`, not `npm run refresh`. The refresh is the first of fifteen
steps and leaves the day's new records without pictures. One-off backfills are
`node scripts/backfill-*.js` and most are dry-run by default, so read a script's
header before running it.

## How it fits together

```
external sources -> scripts/ (service key, write) -> Supabase
                                                       |
                                       src/lib/data.js (anon key, read)
                                                       |
                                                     pages
```

- **Client-side React SPA.** Vite 8, React 19, react-router-dom 7, Tailwind 3.
  No server routes, no API handlers, no auth, no user accounts.
- **`src/lib/data.js` is the only data layer.** No component talks to Supabase
  directly. It queries Supabase when configured and reads the static JSON when
  not.
- **Only `scripts/` write.** Row-level security allows public select on every
  table and no public writes.
- **Ids are deterministic.** An organization's id is a UUIDv5 of its name, so
  `/company/:id` URLs survive a rebuild.

Two schema facts that surprise people: there is no `trials` table, as trials
live in `news_feed` with `entry_type='trial'`; and `organizations` holds both
companies and labs, separated by `type`.

## The nightly run

`.github/workflows/refresh.yml` runs `npm run daily` at 06:23 UTC, commits the
data files it wrote, then runs `verify:cron`. The odd minute is deliberate. A
cron is when a run becomes eligible and not when it starts, and this one has
never started on time.

Every step is best-effort except the ingest, so one dead upstream API cannot
stop the rest. Whether the run was good is `verify:cron`'s call, and it checks
table shape against floors rather than trusting exit codes. It exists because a
job once reported success while deleting the entire funding dataset. See
`neurotech-index/docs/funding-data-loss-2026-07-29.md`.

## Pictures, and why there is no vision model

**No script in this repository calls a vision model, and none may.** A picture
reaches the site because a person looked at it, not because a search engine
returned it.

Candidates found by the pipeline land in a queue in
`src/data/image-review.json`. Judgement happens offline, following the runbook in
[`neurotech-index/docs/home-image-review.md`](neurotech-index/docs/home-image-review.md),
and is written back as data.
Every candidate is asked four questions, and all four must be yes to publish:
is it a photograph, is it one uninterrupted image, is it safe beside a headline,
and is it a picture **of** the thing it was queued for.

The invariant is that **unreviewed means no**. A picture with no verdict is
rejected and queued, on the page as well as in the scripts. `src/data/image-ledger.json`
remembers the two rules a single render cannot enforce: one photograph belongs
to one story permanently, and the lead story changes every day.

```bash
npm run images:queue   # what is waiting on review
```

A card with no photograph of its own shows a figure drawn from the record's own
numbers. That is a normal outcome and not a missing image.

## Tests and CI

`.github/workflows/ci.yml` runs lint, tests, build and `validate:funding` on
every push to `main` and on pull requests. `validate:funding` fails on any
financial or regulatory claim the sources do not support.

Deployment is Vercel, which builds on push to `main`.

## Documentation

- **`ARCHITECTURE.md`** at the repository root is the real architectural record. It is
  long, and it explains why things are the way they are, including the decisions
  that were reversed and what they cost.
- **`neurotech-index/docs/`** holds the implementation spec, the architecture
  audit, the classification rubric and several post-mortems.

Read `ARCHITECTURE.md` before changing anything in `scripts/` or in the image
pipeline. Most of the sharp edges in this codebase are documented there, and
nearly all of them were found the expensive way.
