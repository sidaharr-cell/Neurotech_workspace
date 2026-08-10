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
npm run daily            # THE daily run: ingest, backfills, then the whole image sequence
npm run refresh          # ingest only: PubMed + arXiv + media + trials -> Supabase
npm run verify:cron      # post-cron integrity check; exits non-zero on data collapse
npm run validate:funding # fails on any unsupported financial/regulatory claim (runs in CI)
npm run verify:funding
```

**Use `npm run daily`, not `npm run refresh`.** `refresh` is the first of fifteen steps
and nothing else: it ingests, and it does not source a picture for anything it ingested,
so a run that looks complete leaves the day's new records showing data figures. The
order lives once, in `scripts/daily.js`, and the workflow calls it.

One-off backfills are `node scripts/backfill-*.js` / `scripts/seed*.js`. Several take
`--commit`; **those are dry-run by default** so a local run cannot write to production
by accident. Check a script's header before running it.

There is **no typecheck** — the codebase is plain JS/JSX with no TypeScript. Where the
build spec asks for "typecheck passes", read it as "build + lint pass".

CI (`.github/workflows/ci.yml`, on push to `main`/`revamp` and on PRs) runs lint, tests,
build, and `validate:funding`. `.github/workflows/refresh.yml` runs `npm run daily` at
6am UTC, then commits the data files it wrote, then `verify:cron`. The workflow holds no
sequence of its own: it used to list every step in YAML, which is how the sequence and
the manual command drifted apart.

Every step in `daily.js` is best-effort except the ingest, so one dead upstream API
cannot stop the rest. A failed step prints a `::warning::` and the script still exits 0
— on purpose, because the workflow steps AFTER it commit `notable.json` and
`image-focus.json` and run `verify:cron`, and exiting non-zero would skip both. Whether
the run was good is `verify:cron`'s call. **Settled 4 Aug 2026: a short home page
section stays a warning and does not fail the build.** Only data loss goes red.

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
pages read the stored columns. `src/lib/classify.js` applies it and `applyFacets` in
`data.js` filters (OR within a facet, AND across facets). `FilterBar.jsx` is the UI
everywhere: one closed line of dropdowns carrying the three facet groups plus whatever
single-select `extras` a page adds, per-value `counts`, and a `histogram`
(the results-by-year bars, which live inside a Year dropdown).

**Every filter surface carries counts** — the seven are `/`, `/media`, `/research`,
`/trials`, `/companies`, `/devices`, `/search` — because a value that would return
nothing should not cost a click to discover. A count sits beside each value and a
zero-count value is hidden. `null` counts mean "not counted", which is a different thing
from zero: nothing is printed and nothing is hidden, and it is what a page falls back to
rather than show a number it cannot stand behind. Where the results are paginated
server-side the numbers come from `facetCounts` in `data.js` — ONE grouped `facet_counts`
RPC (migration 017) answered entirely from a covering index, because a count per value is
not affordable on papers, where a single facet-filtered count already exceeds the
statement timeout. Those counts reflect facets, kind, and the scope gate only, so the
pages hide them during a text search rather than print numbers the results would not
honour, which is the rule the histogram already followed. Where the page holds its
results in memory (the feed, Media, search) `countFacets` in `facets.js` counts them
there, and can be exact about every other control as well. Two invariants: a count holds
the OTHER dimensions' selections fixed and leaves its own free, or a reader could never
see what switching within a dimension would give them; and it applies the same scope gate
as the search it describes — `includeOutOfScope` for organizations, which abstain rather
than fall out of scope, and the `canonical_id` dedup gate for papers, whose search hides
rows merged into a canonical version.

**The same query returns the exact total**, and that is what the pages print as
"N results". Both numbers they printed before were wrong. `searchPapers` and
`searchPatents` count `estimated` — a planner guess, measured 25-28% low — because an
exact count over the fat tables used to exceed the statement timeout, which the covering
index is what fixes. The year histogram's bucket sum, used as the total where the
estimate was too coarse, is exact only for rows it can PLACE: an unparseable year, or one
outside the buckets it emits, is counted nowhere, and on Trials it read the whole
`news_feed` table, so it counted press items as trials. That page printed 152 for a facet
holding 155. Order of preference per page: the exact count, then the histogram sum where
the search's own count is an estimate (so a database without migration 017 degrades to
the old number, not to the estimate), then the search count. Where the search already
counts `exact` — devices, trials, organizations — its total is simply used.
`FacetSidebar.jsx` is the open left rail it replaced and **is no longer imported by anything** — it held the
same controls permanently expanded down a 240px column, which on pages thousands of
pixels tall left a rail of nothing beside most of the content and took a fifth of the
width from the results to do it.

**Page width** is one of two values, and the distinction is index versus detail.
`.page-wide` (in `index.css`, 1440px) is for anything that LISTS things — the home
page, the five topic pages, search. Anything showing ONE record keeps its own narrower
measure (`max-w-prose`, `max-w-3xl`) and must not take `.page-wide`: an abstract set
1440px wide is unreadable. Nature News, for reference, runs a 1152px grid inside a
1320px wrapper and caps there at any viewport.
The older eight-class `DEVICE_CLASSES` scheme in `taxonomy.js` is superseded — do not
add to it. Calibration lives in `scripts/gold-set.js`, `score-facets.js`,
`score-taxonomy.js`, and `audit-taxonomy.js`, with the rubric in `docs/taxonomy-rubric.md`.

**Ranking is per-type and additive**, all in `scripts/`: `computeRank` (feed),
`mediaScore` (news, with `MEDIA_TIERS` authority), and `researchScore` (papers, on
OpenAlex field/age-normalized impact behind an `impactTrusted` gate, with `VENUE_TIERS`
prestige) in `refresh.js`; `trialScore` in `trials.js`. Scores are stored in
`papers.rank_score`, `organizations.rank_score`, `news_feed.relevance_score` (Claude's
1–10 centrality) and `news_feed.metadata.rankScore`.

**Images are sourced, never generated.** `scripts/lib/images.js` resolves a picture
for a record and returns it with its provenance: source, credit, licence, and the page
the file is described on. `image_subject` says what the picture IS — `'item'` (a figure
out of this paper, this company's logo, the photograph the outlet ran) or `'class'` (a
licensed photograph of the *technology*, because no photograph of an individual 510(k)
submission or clinical trial exists anywhere). Class photographs come from the reviewed
pool in `scripts/data/class-images.json`, resolved once by `npm run images:classes`;
each candidate must be affirmed by BOTH the file's own title and a vision model, and a
class with no confirmable photograph yields nothing rather than something approximate.
`npm run images:backfill` assigns them and `npm run verify:images` clears rotted
hotlinks. The nightly workflow runs the whole sequence, and the ORDER is load-bearing:
`verify-image-fit` first, so records it clears are refilled in the same run;
`backfill-images`; then `apply-card-images`, so hand-placed pictures beat the general
sources; then `fill-page-images`, which sees what is already spoken for and keeps every
card on the page distinct; then `set-image-focus`. That last one writes
`image-focus.json`, which the workflow's commit step must stage or the work is discarded. Three files carry judgement the pipeline cannot make:
`class-images-rejected.json` (pictures a person looked at and turned down, so a rebuild
cannot reinstate them), `card-images.json` (a picture chosen by hand for one record,
with the reason), and `image-focus.json` (where the subject sits, handed to CSS
object-position, because a card crops to the middle and the subject often is not there).
**Every picture sits in a declared frame and fills it** (`objectFitOf` in `src/lib/image.js`):
a picture shown whole inside a landscape card is letterboxed, and a letterboxed portrait
beside a filled neighbour reads as a vertical picture in a row of horizontal ones. A logo
is the one exception, since cropping would cut the wordmark. Frames are flex children in
places, so they need `self-start` or the row stretches them and the declared ratio never
applies.

Because everything crops, **the focal point has to hold the SUBJECT, not point at it**.
`src/lib/crop.js` is that geometry, and it is pure and tested (`crop.test.js`): at
`object-position: p` the visible window spans `[p·(1−frac), p·(1−frac)+frac]`, so
`positionFor` takes the subject's *extent* and returns a position that contains it,
falling back to centring on the subject only when the subject is wider than the window.
`set-image-focus.js` therefore asks a vision model for a bounding BOX, not a centre
point: a subject centred at 72% but running 55%–90% is cut by placing the window at 72%,
and held by placing it at the extent-aware answer. Each picture is solved for whichever
of 4:3 and 16:9 crops it harder (`frameFor`), so it holds in either. `--recompute-crops`
re-reads pictures losing more than 10% of an axis; without it only pictures with no entry
are read, which is what the daily run wants.
`scripts/verify-image-fit.js` re-reads every class assignment and clears the ones the
current classifier no longer supports — the reading changes underneath a stored picture,
and the mismatch is otherwise silent. Anything `class`-subject must render with the "Illustration" label
and its credit (`src/lib/image.js`, `ImageCredit` in `Figure.jsx`) — the attribution is a
licence condition, and the label is what keeps the picture from making a claim.
Publisher pages 403 every script, so a recent paywalled paper has no figure to source.

**The home page has a fixed budget of 43 items**, split across its sections in
`SLOTS` in `src/lib/homepage.js` and counted by `homepage.test.js`. **Every section is
expected to FILL its slots, and every story frame to hold a picture**, and
`scripts/verify-homepage.js` (in the daily run, last) is what says whether they do.
Both fail silently otherwise: nothing errors, the row is just half empty and the frame
holds a plate. It asks through the page's own `composeStories`, `pickNotable`,
`assignImages` and `leadPicture`, so the answer cannot drift from what a reader sees,
which needs Vite's resolution, so `daily.js` runs that one step through `vite-node`.
A blank frame means the reviewed pool ran dry or the day's stories all landed on the
same few technologies; the fix is more pictures in the pool (`npm run images:classes`),
not a looser rule.

The rail is the section that starves, for two compounding reasons. `syncNotable` used to
draw candidates only from the day's ingest, which is ~200 papers, few of which are
top-decile for their field and in window — so it drained. Then `pickNotable` drops any
paper already shown in the feed above, so a rail of four can render three. `topUpNotable`
now refills from the papers table through the SAME gates (trusted impact, top decile, in
window, on topic) up to `NOTABLE_MAX` of 12. Nothing is relaxed to fill a slot: a short
rail is better than a padded one.

Every card carries a picture: a photograph when the
record has one, otherwise a figure drawn from that record's own fields
(`src/components/Figure.jsx` — trial phase and enrollment, FDA submission number and
pathway, round amount, citation impact). Figures are `aria-hidden`, so anything a
figure shows must also be printed as text on its card. No generated placeholder art,
ever: a picture is a photograph somebody took, or it is a figure of the record's own
numbers.

**How far a photograph may be from its record is a per-surface decision.** The ingest
pipeline holds the strict line: it gives a record a picture of the technology its
classifier named, and nothing else. The home page's story cards hold a looser one.
Settled 4 Aug 2026: those fifteen frames are filled from the reviewed pool by
relevance, and a card whose own technology has no photograph left takes the best
unused picture of a NEIGHBOURING one rather than running a plate. `rankClasses` in
`src/lib/class-match.js` is that ordering — the technologies the record's own words
name, then the ones its facets imply, then the rest, most general first — and the
second pass of `assignImages` in `src/lib/image.js` spends the pool against it. It
reads local data only: no API call, no model call, no picture that a person has not
already reviewed, and every one of them is stamped `'class'`, so it renders labelled
"Illustration" with its credit and licence. The pool is `src/data/class-images.json`,
39 pictures; the page needs 15, and `image.test.js` covers what happens when it runs
dry, which is that a card shows its data figure rather than repeat a picture already
on the page.

**The home page splits both rules by section.** The stories (lead, More stories,
Featured, Latest) carry the photographs; the four record rails — In the clinic, FDA
decisions, Funding, Notable research — carry only their data figure, shrunk to a 96px
thumbnail beside the text, and are left out of `assignImages` entirely. Two reasons.
No photograph of an individual 510(k) submission exists, so a card built around a
picture frame asks those records for something they cannot supply and blows a tinted
plate up to card size to cover it, which beside a real photograph reads as an image
that failed to load. And a sourced photograph obliges an `ImageCredit` line, which at
list-row density costs more than the picture returns. A figure drawn from the record's
own fields owes no attribution, so the rows stay tight. Photographs still run on the
section pages (`/trials`, `/devices`, `/companies`, `/research`).

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
