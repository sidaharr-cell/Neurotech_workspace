# NeuroBase Architecture Audit (Phase 0)

This is the Phase 0 deliverable required by `docs/neurobase-implementation-instructions.md`. It maps the system as it actually exists on branch `revamp` as of 2026-07-27, so the later phases target reality rather than the spec's guesses. Where the spec assumed something that is not true of this repo, that is called out explicitly under "Corrections to the spec's assumptions" at the end.

## 1. Framework, language, styling

- **Framework:** Single-page React app built with **Vite 8**. This is **not Next.js** (no App Router, no Pages Router, no server components). Routing is entirely client-side via **react-router-dom 7** (`BrowserRouter`) in `src/App.jsx`. `index.html` is the single entry; `src/main.jsx` mounts `<App/>`.
- **Language:** **Plain JavaScript with JSX** (`.jsx` / `.js`). **TypeScript is not used.** `@types/react` is present as a dev dependency but there are no `.ts`/`.tsx` files and no `tsconfig.json`. There is therefore **no typecheck step** (see §7).
- **Styling:** **Tailwind CSS 3** (`tailwind.config.js`) via PostCSS + Autoprefixer. Global CSS in `src/index.css` and `src/App.css`. Icons via `lucide-react`.
- **Deployment:** Vercel (`vercel.json`), public repo, live at https://neurobase-live.vercel.app. Deploy is push-to-`main`; dev happens on `revamp`.

## 2. Data layer

- **Store:** Supabase (hosted Postgres, Pro plan). Schema in `supabase/schema.sql`; two additive migrations in `supabase/migrations/` (`001-facets.sql`, `002-year-histogram.sql`). No ORM — the frontend and scripts talk to Supabase through `@supabase/supabase-js` (PostgREST).
- **Frontend access:** `src/lib/supabase.js` creates an anon-key client (read-only; `null` when env vars are unset). `src/lib/data.js` is the unified data layer: it queries Supabase when configured and **falls back to static JSON** in `src/data/*.json` (`papers.json`, `devices.json`, `organizations.json`, `researchers.json`) otherwise. All page components read through `data.js`, never Supabase directly.
- **Writes:** Only the Node scripts write, using the **service-role key** (`SUPABASE_SERVICE_KEY`). Row-level security allows public `select` on every table and no public writes.

### Tables and their fields (from `supabase/schema.sql` + migration 001)

| Entity | Table | Key fields today |
|---|---|---|
| Paper | `papers` | `id`, `title`, `authors` (jsonb array), `journal`, `year` (text), `doi` (unique), `pubmed_id` (unique), `arxiv_id` (unique), `url`, `abstract`, `tags` (jsonb), `source` (`manual`/`pubmed`/`arxiv`), `rank_score` (real), `fts` (tsvector), `created_at`; migration adds `mesh` (jsonb), `facet_function/access/application` (text[]), `in_scope` (bool), `classifier_version` |
| Device | `devices` | `id`, `name`, `manufacturer`, `type`, `year`, `status`, `signal_type`, `channels`, `description`, `modality` (jsonb), `tags` (jsonb), `url`, `created_at`; migration adds facet columns + `product_code` (FDA code, backfilled from `description`) |
| Organization | `organizations` | `id`, `name`, `type` (`company`/`lab`), `location`, `founded`, `description`, `focus_areas` (jsonb), `website`, `founders` (jsonb), `rank_score`, `created_at`; migration adds facet columns |
| Researcher | `researchers` | `id`, `name`, `affiliation`, `role`, `bio`, `expertise` (jsonb), `notable_work` (jsonb), `created_at` |
| Trial | **`news_feed`** with `entry_type='trial'` | trial data lives inside the feed table; the NCT id, phase, status, sponsor, enrollment are in `metadata` (jsonb). There is **no `trials` table.** |
| News / preprint / paper-in-feed | `news_feed` | `id`, `title`, `summary`, `source`, `url` (unique), `published_at`, `topics` (jsonb), `relevance_score` (int), `entry_type` (`paper`/`preprint`/`news`/`trial`), `metadata` (jsonb), `created_at`; migration adds facet columns |
| Patent | `patents` | `id`, `patent_number` (unique), `title`, `abstract`, `assignee`, `inventors` (jsonb), `grant_date`, `cpc_codes` (jsonb), `tags` (jsonb), `url`, `source`, `fts`; migration adds facet columns |
| Person | `researchers` (12 rows) + author strings on papers | People have no rich store; the `PersonProfile` page is reached by inbound link only |

**Volumes (from project memory, approximate):** ~83.8k papers, ~8.3k trials (in `news_feed`), ~6k devices, ~2.4k labs + ~1,084 companies (both in `organizations`), 12 researchers, ~47.4k patents.

### There is no entity graph yet

This is the single most important finding for Phase 1. **No join tables and no cross-entity foreign keys exist.** A paper does not reference the device it tests; a device does not reference its maker org; a trial does not reference a sponsor org row. Cross-entity association is done **at query time by string matching**, e.g. `getCompanyRelated(name)` in `src/lib/data.js` runs `ILIKE` on `devices.manufacturer`, `patents.assignee`, and `news_feed.metadata->>sponsor`. That is the entire "graph" today. Phase 1 builds the real one.

### Provenance is partial, not a block

There is no unified provenance block. What exists: native ids as columns (`doi`, `pubmed_id`, `arxiv_id`, `patent_number`, NCT in `metadata`), `url`, `source` (on `papers`/`patents`/`news_feed`), and `created_at`. What is missing per the Phase 1 spec: `source_url` as a distinct canonical field on every table, `first_seen` vs `last_updated` (only `created_at` exists; there is no update timestamp), `pipeline_version`, and per-section provenance for assembled records (companies). `classifier_version` exists but only stamps the taxonomy classifier, not ingestion.

## 3. Ingestion pipeline

- **Daily cron:** `scripts/refresh.js`, run by GitHub Actions (6am UTC per its header) and `npm run refresh`. It pulls, scores with Claude, and upserts into Supabase.
  - **PubMed** via NCBI E-utilities (`esearch`/`efetch`, XML parsed with `xml2js`); term list in `PUBMED_TERMS`. Date parsing in `parsePubmedDate`.
  - **arXiv** via the Atom export API; queries in `ARXIV_QUERIES`.
  - **News** via RSS feeds + GDELT (`fetchRssFeed`, `fetchGdelt`, `fetchMedia`), image enrichment (`getOgImage`, Europe PMC figures).
  - **Trials** via `scripts/trials.js` `syncTrials()` — ClinicalTrials.gov API v2, upserted into `news_feed` as `entry_type='trial'`, stale rows pruned.
  - **Enrichment:** `enrichOpenAlex()` adds OpenAlex field-normalized impact (FWCI, citation percentile) by DOI; Semantic Scholar citation counts (`fetchCitations`).
  - **Classification:** `classify()` from `src/lib/classify.js` assigns the three facets + scope.
- **One-off / periodic backfills** (`scripts/backfill-*.js`, `seed*.js`):
  - `backfill-devices.js` — openFDA device data (product codes, clearances).
  - `backfill-patents.js` / `backfill-patents-bq.js` / `seed-patents.js` — USPTO PatentsView and a BigQuery patents path; CPC-based neurotech selection.
  - `backfill-pubmed.js`, `backfill-mesh.js`, `backfill-paper-impact.js` — bulk papers, MeSH headings, OpenAlex impact.
  - `backfill-companies.js` / `backfill-labs.js` / `rollup-labs.js` — companies and academic labs from the NeuroTechX ecosystem Airtables via `scripts/lib/airtable.js` (auto-updating in the daily cron).
  - `backfill-funding.js` — SEC EDGAR funding (Phase 10 business layer, already partly built; overlay in `src/data/companies-funding.json`, chart in `src/components/FundingChart.jsx`, logic in `src/lib/companyFunding.js`).
  - `backfill-company-analytics.js` + `audit-publications.js` — precomputed per-company publication analytics served as static `/company-analytics/<id>.json` (fetched by `getCompanyAnalytics`).

## 4. Ranking pipeline

The spec (product context) describes the ranking as "a multiplicative scoring formula, an Advance ceiling, a contradicted-by-record gate, rubric versioning, and a calibration harness." **That description does not match this repo.** The real ranking is a set of **additive weighted formulas**, all in `scripts/`:

- `computeRank(item)` in `refresh.js` — feed rank: `0.40*aiNorm + 0.25*citeNorm + 0.15*inflNorm + 0.20*recNorm`.
- `mediaScore(item)` — news rank: `0.50*relevance + 0.30*recency + 0.20*authority` (outlet tiers in `MEDIA_TIERS`).
- `researchScore(item)` — paper rank on OpenAlex field/age-normalized impact percentile, with a trust gate (`impactTrusted`: percentile only counts once `citedBy>=3` or age>60d) and weight redistribution for fresh papers. Weights in `RESEARCH_W`. Venue prestige in `VENUE_TIERS`.
- `trialScore(t)` in `trials.js` — phase/status/enrollment/sponsor/recency weighted sum.

**Where rank is stored:** `papers.rank_score`, `organizations.rank_score`, `news_feed.relevance_score` (integer, Claude's neurotech-centrality score 1–10) and `news_feed.metadata.rankScore` (the computed float). There is **no `advance` field, no contradicted-by-record flag, and no replication/contradiction state anywhere in the schema or scripts.**

**"Rubric versioning" and "calibration harness" refer to the taxonomy/classification system, not ranking:** `docs/taxonomy-rubric.md`, `scripts/gold-set.js` (LLM-labeled gold set, `rubric: 'v2'`), `scripts/score-taxonomy.js` / `score-facets.js` (Wilson-interval scorecards), `audit-taxonomy.js`. Phase 5's "read the contradicted-by-record state from the existing ranking pipeline" **cannot be satisfied as written** — no such state exists and would have to be built from scratch (likely in Phase 1's relationships: `Paper contradicts Paper` / `Paper replicates Paper`).

## 5. Routes (from `src/App.jsx`)

All under a shared `<Shell/>` layout (`src/components/Layout.jsx`):

| Path | Component | Renders |
|---|---|---|
| `/` (index) | `pages/Feed.jsx` | AI-scored magazine feed (`news_feed`) |
| `/media` | `pages/Media.jsx` | News-only feed |
| `/research` | `pages/Research.jsx` | Papers, faceted search |
| `/trials` | `pages/Trials.jsx` | Trials (`news_feed` `entry_type='trial'`) |
| `/companies` | `pages/Companies.jsx` | **DB-backed** org list, `type='company'`, faceted (`searchCompanies` in `data.js`) |
| `/devices` | `pages/Devices.jsx` | Devices, faceted search |
| `/search` | `pages/SearchPage.jsx` | Cross-type search |
| `/how-it-works` | `pages/HowItWorks.jsx` | Methodology/transparency |
| `/company/:id` | `pages/CompanyPage.jsx` | Company dossier: `getCompanyById` + `getCompanyRelated` (name-matched devices/patents/trials/news) + `getCompanyAnalytics` |
| `/item/:id` | `pages/ItemDetail.jsx` | Generic feed-item detail |
| `/paper/:pmid` | `pages/PaperDetail.jsx` | Paper detail |
| `/people/:slug` | `pages/PersonProfile.jsx` | Person page, **inbound-link only** (deliberately absent from nav and default search) |
| `*` | redirect to `/` | |

**What `/companies` has today:** a real, paginated, faceted list of organizations of `type='company'` from Supabase (`searchCompanies`), each linking to `/company/:id`. The individual company page already assembles related devices, patents, trials, news, funding, and precomputed publication analytics — but entirely via name-matching, not real relationships. Phase 2 extends this (add the seven sourced sections, per-section provenance, real links) rather than starting from zero.

## 6. Authentication and per-user storage

**None.** There is no Supabase Auth, no login, no user accounts, and no `localStorage`-based per-user state anywhere in `src/`. The anon key is read-only. **Phase 8 therefore takes the "no authentication exists" path**: watchlists must be local-first (browser storage) with a JSON export and an on-demand "what changed" view; email delivery is out of scope until a backend/auth is deliberately added.

## 7. Build, lint, typecheck, tests

- **Build:** `npm run build` (`vite build`) — **passes.** Only warning is a >500 kB chunk-size notice (the app is a single bundle). No test/typecheck runs as part of build.
- **Lint:** `npm run lint` (`oxlint`, config `.oxlintrc.json`) — **passes with pre-existing warnings** (react `only-export-components` in `Filters.jsx`, a few `no-unused-vars` in scripts). No errors. New code should not add warnings.
- **Typecheck:** **does not exist** (plain JS, no `tsc`). The spec's repeated "typecheck passes" acceptance criterion is not applicable; treat "build + lint pass" as its equivalent unless TypeScript is introduced.
- **Tests:** **no test suite exists** (no vitest/jest, no `*.test.js`, no `test` script in `package.json`). The spec asks several phases to "add tests for new logic" (dedup, BibTeX/RIS, facet mapping, change detection). A test runner (e.g. vitest, which pairs with Vite) will need to be added the first time a phase requires a test; note that in the phase that does it.

## Corrections to the spec's assumptions

The implementation spec was written against an assumed system. These points differ and should govern the later phases:

1. **Not Next.js.** It is a client-side React + Vite SPA with react-router. There are no server routes or API handlers; "add machine-readable metadata to the page head" (Phase 9) must be handled in an SPA-compatible way (document head manipulation at render), and any server-side work (Phase 8 email) has no existing backend to attach to.
2. **No TypeScript, so no typecheck.** Substitute "build + lint pass."
3. **No test suite.** A runner must be introduced before the first test-bearing phase.
4. **The ranking is additive, not multiplicative, and has no Advance ceiling or contradicted-by-record gate.** Rubric/calibration language in the spec maps to the *taxonomy classifier*, not ranking. Phase 5's contradiction/replication badges depend on relationships that do not exist yet and must be built in Phase 1.
5. **The entity graph does not exist.** Cross-linking is string-matched at query time. Phase 1 is genuinely foundational: it introduces the first real relationships, and Phase 2's company page should migrate from name-matching to those relationships where confidence allows.
6. **Trials are not a table.** They live in `news_feed` as `entry_type='trial'` with data in `metadata`. Phase 7's "trials view" reads from there; a decision is needed on whether to promote trials to their own table or keep the feed representation (recommend keeping it and adding relationships, to avoid a disruptive migration).
7. **Facets are already partly built (Phase 4 overlap).** A three-facet controlled scheme already exists — `facet_function` (records/stimulates/images/decodes/none), `facet_access` (non_invasive/minimally_invasive/implanted_non_penetrating/implanted_penetrating/not_applicable), `facet_application` (13 values) — as `text[]` columns with GIN indexes, populated by `src/lib/classify.js` and stamped with `classifier_version`, filtered in `data.js` via `applyFacets` (OR within facet, AND across), with a `FacetSidebar.jsx` UI and URL state. This differs from the spec's proposed dimensions (Modality / Invasiveness / Signal direction / Anatomical target). Phase 4 should reconcile the two (the existing `facet_access` already covers invasiveness; `facet_function` overlaps signal direction) rather than introduce a parallel scheme, per the spec's own "do not introduce a second pattern" rule.

## Pointers (exact files)

- Entity definitions / schema: `supabase/schema.sql`, `supabase/migrations/001-facets.sql`, `supabase/migrations/002-year-histogram.sql`.
- Frontend data layer: `src/lib/data.js`, `src/lib/supabase.js`.
- Ingestion: `scripts/refresh.js` (cron), `scripts/trials.js`, `scripts/backfill-*.js`, `scripts/lib/airtable.js`.
- Ranking: `computeRank`/`mediaScore`/`researchScore` in `scripts/refresh.js`; `trialScore` in `scripts/trials.js`.
- Classification/facets: `src/lib/classify.js`, `src/lib/facets.js`, `docs/taxonomy-rubric.md`, `docs/classification-system.md`.
- Routes: `src/App.jsx`; pages in `src/pages/`.
- Business layer (Phase 10, partly built): `scripts/backfill-funding.js`, `src/lib/companyFunding.js`, `src/components/FundingChart.jsx`, `scripts/backfill-patents*.js`.
