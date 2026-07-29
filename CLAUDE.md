# NeuroBase

Open, auto-updating index for neurotechnology (papers, devices, organizations, clinical trials, researchers). React + Vite + Supabase. App lives in `neurotech-index/`. Live at https://neurobase-live.vercel.app.

Dev on branch `revamp`, merge to `main` to deploy. Dev server runs on localhost:5173.

## Active build plan

The current implementation spec is **[`neurotech-index/docs/neurobase-implementation-instructions.md`](neurotech-index/docs/neurobase-implementation-instructions.md)**. It is the source of truth for what to build and in what order. Read it before starting feature work.

Key points from that spec (read the full doc for detail):

- **Work phases in order.** Phase 0 (repo audit → `docs/architecture-audit.md`) and Phase 1 (entity graph + provenance) are prerequisites for everything. Commit at the end of each phase; do not batch unrelated changes.
- **Inspect before you build.** Verify paths, schema, and framework against the repo; the spec's path guesses may be wrong.
- **Never fabricate data.** Missing values render "Not available" or are omitted. Every user-facing fact must be traceable to a source (arXiv, bioRxiv, PubMed, ClinicalTrials.gov, openFDA) with a link and last-updated date.
- **Business layer stays partitioned.** Funding / M&A / patents / talent (Phase 10) must never feed the ranking pipeline, the Feed, or the research facets. No inferred valuations, no buy/sell/hold judgments, no LinkedIn scraping.
- **Verify every phase.** Build, typecheck, lint, existing tests must stay green; spot-check real records for fabricated facts.
- **User-facing copy:** short declarative sentences, no marketing language, no em-dashes, "and" not "&".
