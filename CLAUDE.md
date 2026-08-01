# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# NeuroBase

Open, auto-updating index for neurotechnology (papers, devices, organizations, clinical trials, patents, researchers). React + Vite + Supabase. App lives in `neurotech-index/`. Live at https://neurobase-live.vercel.app.

Dev on branch `revamp`, merge to `main` to deploy (Vercel builds on push to `main`). Dev server runs on localhost:5173.

## Commands

All commands run from `neurotech-index/`.

```bash
npm run dev          # Vite dev server, port 5173 (PORT env var overrides)
npm run build        # vite build -> dist/
npm run lint         # oxlint (config .oxlintrc.json)
npm test             # vitest run
npm run preview      # serve the production build
```

Run a single test file or one test:

```bash
npx vitest run src/lib/dedup.test.js
npx vitest run -t "never selects withdrawn as the furthest stage"
```

Data pipeline (needs `.env`; scripts load it via `--env-file-if-exists`):

```bash
npm run refresh          # the daily cron: PubMed + arXiv + media + trials -> Supabase
npm run verify:cron      # post-cron integrity check; exits non-zero on data collapse
npm run validate:funding # fails on any unsupported financial/regulatory claim (runs in CI)
npm run verify:funding
```

One-off backfills are `node scripts/backfill-*.js` / `scripts/seed*.js`. Several take
`--commit`; **those are dry-run by default** so a local run cannot write to production
by accident. Check a script's header before running it.

There is **no typecheck** — the codebase is plain JS/JSX with no TypeScript. Where the
build spec asks for "typecheck passes", read it as "build + lint pass".

CI (`.github/workflows/ci.yml`, on push to `main`/`revamp` and on PRs) runs lint, tests,
build, and `validate:funding`. `.github/workflows/refresh.yml` runs the nightly data
refresh at 6am UTC, then the companies / labs / funding / status / inclusion / stage
backfills, then `verify:cron`.

## Architecture

**Client-side React SPA.** Vite 8, React 19, react-router-dom 7 (`BrowserRouter` in
`src/App.jsx`), Tailwind 3, lucide-react icons. No Next.js, no server routes, no API
handlers, no auth, no user accounts. Anything needing a server has nowhere to attach;
use SPA-compatible approaches (e.g. head metadata written at render time).

**Data flows one direction:** external sources → Node scripts (service-role key) →
Supabase → `src/lib/data.js` → pages.

- `src/lib/supabase.js` creates an **anon, read-only** client, and returns `null` when
  env vars are unset.
- `src/lib/data.js` (~950 lines) is the only data layer. Every page reads through it;
  **no component talks to Supabase directly**. It queries Supabase when configured and
  falls back to the static JSON in `src/data/*.json` otherwise, so the app runs with no
  backend.
- Only the `scripts/` write. RLS allows public `select` on every table and no public writes.

**Schema** lives in `supabase/schema.sql` plus numbered additive migrations in
`supabase/migrations/` (run once, by hand, in the Supabase SQL editor). Core tables:
`papers`, `devices`, `organizations`, `researchers`, `news_feed`, `patents`, plus
`relationships`, `regulatory_records`, `maude_records` (003), `trial_changes` (004),
`funding_rounds` (008).

Two schema facts that trip people up:

- **There is no `trials` table.** Trials live in `news_feed` with `entry_type='trial'`;
  NCT id, phase, status, sponsor, and enrollment are inside `metadata` (jsonb).
- **`organizations` holds both labs and companies**, distinguished by `type` (`'lab'` /
  `'company'`). Ids are a deterministic UUIDv5 of the name (`scripts/lib/uuid.js`) so
  `/company/:id` URLs stay stable across rebuilds.

**The entity graph** is a single typed, polymorphic `relationships` edge table with a
CHECK-constrained predicate, carrying confidence and per-edge provenance — not eleven
join tables. Older code still cross-links by query-time string matching (e.g.
`getCompanyRelated(name)` runs `ILIKE` against `devices.manufacturer`,
`patents.assignee`, and `news_feed.metadata->>sponsor`); migrate to real edges where
confidence allows.

**Provenance** is a block on every entity table: `source`, `source_id`, `source_url`,
`first_seen`, `last_updated`, `pipeline_version`. Ingestion stamps it
(`PIPELINE_VERSION` in `refresh.js`).

**Classification** is the three-facet scheme in `src/lib/facets.js` — FUNCTION, ACCESS,
APPLICATION — stored as `text[]` columns with GIN indexes and stamped with
`CLASSIFIER_VERSION`. It is deterministic (no model calls), runs once at ingest, and
pages read the stored columns. `src/lib/classify.js` applies it, `FacetSidebar.jsx` is
the UI, and `applyFacets` in `data.js` filters (OR within a facet, AND across facets).
The older eight-class `DEVICE_CLASSES` scheme in `taxonomy.js` is superseded — do not
add to it. Calibration lives in `scripts/gold-set.js`, `score-facets.js`,
`score-taxonomy.js`, and `audit-taxonomy.js`, with the rubric in `docs/taxonomy-rubric.md`.

**Ranking is per-type and additive**, all in `scripts/`: `computeRank` (feed),
`mediaScore` (news, with `MEDIA_TIERS` authority), and `researchScore` (papers, on
OpenAlex field/age-normalized impact behind an `impactTrusted` gate, with `VENUE_TIERS`
prestige) in `refresh.js`; `trialScore` in `trials.js`. Scores are stored in
`papers.rank_score`, `organizations.rank_score`, `news_feed.relevance_score` (Claude's
1–10 centrality) and `news_feed.metadata.rankScore`.

**The home page has a fixed budget of 30 items**, split across its sections in
`SLOTS` in `src/lib/homepage.js` and counted by `homepage.test.js`. Every card carries a picture: a photograph when the
record has one, otherwise a figure drawn from that record's own fields
(`src/components/Figure.jsx` — trial phase and enrollment, FDA submission number and
pathway, round amount, citation impact). Figures are `aria-hidden`, so anything a
figure shows must also be printed as text on its card. No generated placeholder art:
a picture either says something about its item or is not shown.

## Working rules

The current implementation spec is
**[`neurotech-index/docs/neurobase-implementation-instructions.md`](neurotech-index/docs/neurobase-implementation-instructions.md)** —
the source of truth for what to build and in what order. Read it before feature work,
along with [`docs/architecture-audit.md`](neurotech-index/docs/architecture-audit.md),
which records where the spec's assumptions differ from this repo.

- **Work phases in order.** Commit at the end of each phase; do not batch unrelated changes.
- **Inspect before you build.** Verify paths and schema against the repo; the spec's path guesses may be wrong.
- **Never fabricate data.** Missing values render "Not available" or are omitted. Every user-facing fact must be traceable to a source (arXiv, bioRxiv, PubMed, ClinicalTrials.gov, openFDA, SEC EDGAR, PatentsView) with a link and a last-updated date.
- **Business layer stays partitioned.** Funding / M&A / patents / talent (Phase 10) must never feed the ranking pipeline, the Feed, or the research facets. No inferred valuations, no buy/sell/hold judgments, no LinkedIn scraping.
- **Verify every phase.** Build, lint, and tests stay green; spot-check real records for fabricated facts.
- **User-facing copy:** short declarative sentences, no marketing language, no em-dashes, "and" not "&".

### The write invariant

> `organizations` has more than one owner. Any script that writes company rows upserts
> the columns it owns. Nothing deletes a row to update it.

On 29 July 2026 a nightly `delete().eq('type','company')` followed by a fresh insert
destroyed 205 funding totals, 629 `funding_rounds` (by cascade), 90 stages and 63
inclusion decisions, silently, because every individual pipeline reported success. See
[`docs/funding-data-loss-2026-07-29.md`](neurotech-index/docs/funding-data-loss-2026-07-29.md).
`scripts/backfill-labs.js` still uses delete-and-insert; it is safe only because nothing
else writes lab rows yet. `verify:cron` checks table *shape* against floors rather than
job exit codes, which is what would have caught this.
