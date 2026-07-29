# NeuroBase Implementation Instructions for Claude Code

## 0. How to use this document

You are implementing a set of features on NeuroBase, an open, auto-updating index for neurotechnology (papers, devices, organizations, clinical trials, and researchers). The live site is at `https://neurobase-live.vercel.app`.

Work through the phases in order. Do not skip Phase 0. Each phase has a goal, implementation steps, data considerations, and acceptance criteria. Commit at the end of each phase with a clear message. Do not batch unrelated changes into one commit.

Rules that apply to every phase:

- Inspect before you build. Read the relevant existing code and confirm how it works before changing it. Do not assume file paths, framework, or schema. Where this document guesses at a path or a name, verify it against the repo and correct course.
- Do not fabricate data. If a record has no value for a field, render "Not available" or omit the field. Never invent a clearance date, an enrollment number, an adverse-event count, or a citation. This is a research tool and a wrong fact is worse than a missing one.
- Preserve provenance. Every fact shown to a user should be traceable to a source (arXiv, bioRxiv, PubMed, ClinicalTrials.gov, openFDA) with a link and a last-updated date. If you add a field, add its provenance alongside it.
- Do not break existing routes or the ingestion pipeline. Run the build and the existing tests after every phase.
- Keep the writing plain. Any user-facing copy you add should use short declarative sentences, no marketing language, no em-dashes, and "and" rather than an ampersand.

## 1. Product context

NeuroBase indexes five entity types: Papers (Research), Devices, Organizations, Trials, and People. People are reached through inbound links only (there is no standalone People browse view). There is an AI-scored weekly Feed. Records are ingested from arXiv, bioRxiv, PubMed, ClinicalTrials.gov, and openFDA. There is an existing ranking pipeline with a multiplicative scoring formula, an "Advance" ceiling, a contradicted-by-record gate, rubric versioning, and a calibration harness.

The point of NeuroBase is not search. Google Scholar and PubMed already do search. The point is the graph: the cross-links between a paper, the device it tested, the lab that made it, the trials that cite it, and the follow-up work that replicated or contradicted it. Most of the work below exists to build and surface that graph.

## 2. Scope guardrails (read before you start)

Build these:
- Cross-linking between entities (the graph)
- Provenance on every record
- Company/Organization dossier pages
- Device pages with lineage
- Faceted filtering on technical dimensions
- Reproducibility and provenance signals on paper records
- Preprint deduplication
- A trials monitoring view
- Watchlists and a weekly digest
- Citation export (BibTeX, RIS, Zotero-detectable metadata)

Build these as a separate, clearly-labeled business layer (Phase 10), sourced differently from the research core and partitioned so they cannot alter it:
- Funding events (from SEC EDGAR where disclosed)
- Mergers and acquisitions events (from primary announcements and SEC 8-K)
- Patents (from USPTO PatentsView and EPO OPS)
- Public talent signals (from disclosed announcements only)

Do not build these under any circumstances, including inside Phase 10:
- Inferred valuations or estimated round sizes
- Analyst-style company scores, or any buy, sell, or hold judgment (NeuroBase is not a financial advisor and must not present as one)
- Any feature that depends on scraping a site in violation of its terms (notably LinkedIn for talent data)
- Any path where business signals feed the ranking pipeline, the Feed, or the research facets

If a phase seems to require one of the permanently excluded items, stop and leave a note in the phase output rather than building it.

## 3. Phase 0: Repository discovery and architecture audit

Goal: produce a short written map of the current system so the later phases target reality.

Steps:
1. Identify the framework, language, and styling approach. Confirm whether this is Next.js App Router or Pages Router, whether TypeScript is used, and what CSS or component system is in place.
2. Locate the data layer. Determine whether records live in a database (and which one), an ORM, static files, or an external API. Document how a Paper, Device, Organization, Trial, and Person are stored, and what fields each has today.
3. Locate the ingestion pipeline. Find where arXiv, bioRxiv, PubMed, ClinicalTrials.gov, and openFDA data enter the system. Document the shape of the raw data from each source and where normalization happens.
4. Locate the ranking pipeline. Find where the multiplicative score, the Advance ceiling, and the contradicted-by-record gate are computed and stored. Note the field names, because Phase 5 reads from them.
5. List the current routes and which entity each renders. Confirm what `/companies` renders today and what data it has.
6. Identify whether any authentication or per-user storage exists. Phase 8 depends on this answer.
7. Note the test setup, the lint config, and the build and typecheck commands.

Output: write `docs/architecture-audit.md` with the findings above. This file is a deliverable of Phase 0. Do not proceed to Phase 1 until it exists and is accurate.

Acceptance criteria:
- `docs/architecture-audit.md` exists and describes the framework, data layer, ingestion, ranking, routes, auth state, and build commands.
- You can point to the exact files that define each entity and each source ingestion.

## 4. Phase 1: The entity graph and provenance model

Goal: give every entity typed relationships to the others, and give every record a provenance block. This is the foundation. Do it before the page work.

### 4.1 Relationships

Add typed relationships between entities. At minimum:
- Paper evaluates Device
- Paper authored_by Person
- Person affiliated_with Organization
- Device made_by Organization
- Trial studies Device
- Trial sponsored_by Organization
- Paper cites Paper
- Paper replicates Paper
- Paper contradicts Paper
- Device cleared_via RegulatoryRecord
- Device has_adverse_event MAUDERecord

Implementation:
1. In the data layer found in Phase 0, add the relationships in whatever form matches the existing schema (join tables for a relational database, relation fields for a document store, foreign keys for an ORM). Match the existing conventions, do not introduce a second pattern.
2. Where relationships can be derived from existing source data, derive them in the ingestion pipeline rather than by hand. Examples: paper-to-author from arXiv or PubMed author lists, trial-to-sponsor from ClinicalTrials.gov sponsor fields, device-clearance from openFDA.
3. Where a relationship cannot be derived confidently, leave it empty rather than guessing. Record a confidence value where the schema allows.
4. Add a `RegulatoryRecord` type if one does not exist, with fields for pathway (510(k), PMA, De Novo, Breakthrough Device, HDE), decision date, submission or clearance number, and source URL (openFDA).
5. Add a `MAUDERecord` type if one does not exist, with fields for report date, event type, device identifier, and source URL. Store the raw report reference. Do not compute conclusions from MAUDE data (it is noisy and self-reported); it is a linked count with sources, not a verdict.

### 4.2 Provenance

Add a provenance block to every entity record. Fields:
- `source` (one of: arxiv, biorxiv, pubmed, clinicaltrials, openfda, derived, manual)
- `source_id` (the native identifier: arXiv ID, DOI, PMID, NCT number, openFDA key)
- `source_url` (the canonical external link)
- `first_seen` (timestamp)
- `last_updated` (timestamp)
- `pipeline_version` (the ingestion or ranking version that last touched the record)

For records assembled from more than one source (for example a company whose devices come from openFDA and whose papers come from PubMed), store provenance per section, not one provenance for the whole record.

Acceptance criteria:
- The schema supports all relationships listed above, following existing conventions.
- Ingestion populates the relationships it can derive, and leaves the rest empty.
- Every entity record has a provenance block, and multi-source records have per-section provenance.
- The build, typecheck, and existing tests pass.

## 5. Phase 2: Company and Organization dossier pages

Goal: turn `/companies` and the individual organization page into a sourced dossier that assembles, in one place, the view a researcher or an operator currently builds by hand.

### 5.1 The index page (`/companies`)

1. Confirm what `/companies` renders today (from Phase 0) and extend rather than replace unless the current page has no reusable structure.
2. Show a list or grid of organizations. Each item shows name, one-line description, headquarters (if known), device count, active trial count, and paper count. Every count links to the filtered view on the org page.
3. Add faceted filters on the index: by organization type (company, academic lab, hospital, consortium), by device modality present, and by regulatory activity (has a clearance, has an active trial). Reuse the facet system built in Phase 4 once it exists; if you reach this phase first, build the filters here and refactor them into the shared system in Phase 4.
4. Add sort by paper count, by trial count, and by most recently updated.

### 5.2 The individual organization page

Build the page as a set of clearly separated sections. Each section carries its own provenance footer (source and last-updated).

Sections, in order:
1. Header: name, type, headquarters, founded year (if known), one-line description, external links (official site, ClinicalTrials.gov sponsor page, openFDA firm page where available). Do not fabricate any of these; omit what is unknown.
2. Devices: every device linked by `made_by`. For each, show name, stage or regulatory status, indication, and modality. Link to the device page.
3. Trials: every trial linked by `sponsored_by`. For each, show NCT number, status (recruiting, active, completed, terminated), phase, enrollment, and primary endpoint. Link to ClinicalTrials.gov and to the internal trial record. Separate active from completed.
4. Regulatory: `RegulatoryRecord`s linked to this org's devices. Show pathway, decision date, and number, each linking to openFDA. Below that, a MAUDE section that shows adverse-event report counts for this org's devices with a link to the underlying openFDA query. Label it plainly as self-reported report counts, not an outcome or a safety judgment.
5. Publications: papers linked either through this org's people (`affiliated_with`) or through devices it makes (`evaluates`). Show title, year, venue, and rank score. Link to the paper page.
6. People: researchers linked by `affiliated_with`, reached as inbound links (consistent with the site rule that People has no standalone browse view). Show name and role, linking to the person's inbound context.
7. Provenance footer for the page as a whole: list every source that fed the page and the oldest last-updated timestamp across sections, so a user can see how fresh the dossier is.

Acceptance criteria:
- `/companies` lists organizations with linked, accurate counts and working facets.
- An organization page renders all seven sections, each populated only from linked records, each with provenance.
- MAUDE data is presented as sourced counts with a link, never as a conclusion.
- No fabricated fields anywhere. Unknown values are omitted or shown as "Not available."
- Build, typecheck, and tests pass.

## 6. Phase 3: Device pages with lineage

Goal: let a user walk a device from first preprint to preclinical work to trial to regulatory clearance on a single page.

Steps:
1. On the device page, add a lineage timeline ordered by date. Pull events from linked records: papers that evaluate the device (`evaluates`), trials that study it (`studies`), and regulatory records (`cleared_via`). Each event shows date, type, a one-line label, and a link to the source record.
2. Add a device facts panel: maker (linked organization), modality, invasiveness (non-invasive, minimally invasive, invasive), signal direction (recording, stimulation, closed-loop), and anatomical target. Populate these from existing fields or from the facet dimensions defined in Phase 4. Leave unknown facets empty.
3. Add a "related work" section listing papers that cite, replicate, or contradict the papers that evaluated this device, so the follow-up literature is one hop away.
4. Add the standard provenance footer.

Acceptance criteria:
- The device page shows a dated lineage timeline assembled only from linked records.
- The facts panel renders known facets and omits unknown ones.
- Related work surfaces replication and contradiction links where they exist.
- Build, typecheck, and tests pass.

## 7. Phase 4: Faceted filtering on technical dimensions

Goal: let users narrow Research and Devices the way researchers actually think, which generic search cannot do.

### 7.1 Define the facet dimensions

Add these facets to Papers and Devices where applicable:
- Modality: EEG, iEEG, ECoG, DBS, LFP, single-unit, fUS (focused ultrasound), optogenetics, fNIRS, TMS, tDCS, EMG, PNS (peripheral nerve). Extend this controlled list as the data requires, but keep it controlled. Do not allow free-text modalities.
- Invasiveness: non-invasive, minimally invasive, invasive.
- Signal direction: recording, stimulation, closed-loop.
- Anatomical target: cortex, subcortical, spinal, peripheral nerve, muscle, other.
- Interface or electrode type where known (for example: penetrating array, surface grid, depth lead, wearable).

### 7.2 Populate the facets

1. Derive facets during ingestion where the source data supports it (for example, mapping MeSH terms from PubMed, or device product codes from openFDA, to the controlled facet values). Maintain the mapping in one place so it can be audited.
2. Where a facet cannot be derived confidently, leave it unset. A wrong facet is worse than a missing one, because it corrupts filtering.

### 7.3 Build the filter UI

1. Build one reusable faceted-filter component and use it on Research, Devices, and the `/companies` index. If Phase 2 built filters locally, refactor them into this component now.
2. Facets combine with AND across dimensions and OR within a dimension. Reflect active filters in the URL query string so a filtered view is shareable and linkable.
3. Show result counts per facet value, and disable or hide facet values that would return zero results given the current selection.

Acceptance criteria:
- Facets are a controlled vocabulary, populated by an auditable mapping, unset when unknown.
- One shared filter component serves Research, Devices, and the companies index.
- Filter state lives in the URL and is shareable.
- Build, typecheck, and tests pass.

## 8. Phase 5: Reproducibility and provenance signals on papers

Goal: surface the signals that change what a researcher reads first.

Steps:
1. Contradiction and replication badges. Read the contradicted-by-record state from the existing ranking pipeline (located in Phase 0). On the paper page and in list rows, show a clear badge when a paper has been contradicted by a later record, and a separate badge when it has been replicated. Link each badge to the contradicting or replicating record.
2. Code and data availability. During ingestion, scan paper metadata and abstract for links to code (github.com, gitlab.com) and data (osf.io, zenodo.org, figshare.com, datadryad.org). Store any found links as structured fields. On the paper page, show "Code available" and "Data available" indicators that link out. When none are found, show nothing rather than "none," because absence in the abstract does not prove absence.
3. Preprint versus peer-reviewed status. Show whether the record is a preprint (arXiv, bioRxiv) or peer-reviewed (PubMed with a journal venue), using the provenance source. This feeds Phase 6.
4. Do not compute a reproducibility score. Show the raw signals and let the reader judge. A synthesized score would imply certainty the data does not support.

Acceptance criteria:
- Contradiction and replication badges read from the existing pipeline and link to the related record.
- Code and data links are detected during ingestion and shown only when present.
- Preprint versus peer-reviewed status is visible and sourced.
- No synthesized reproducibility score exists.
- Build, typecheck, and tests pass.

## 9. Phase 6: Preprint deduplication

Goal: collapse the arXiv, bioRxiv, and published versions of one paper into a single record with a version history, so the same paper does not appear three times.

Steps:
1. Add a deduplication step to the ingestion pipeline. Cluster candidate duplicates using, in priority order: shared DOI, then normalized-title match combined with author-set overlap above a threshold. Keep the matching logic in one auditable place.
2. Model the result as a canonical record with a `versions[]` list. Prefer the peer-reviewed published version as canonical when it exists; otherwise the most recent preprint version.
3. On the paper page, show the version history (each version with its source, date, and link) under the canonical record.
4. Make the dedup conservative. When confidence is below the threshold, keep records separate rather than wrongly merging two different papers. A false merge hides a real paper, which is worse than a visible duplicate.
5. Backfill: run the dedup over existing records once, and log every merge so a wrong merge can be found and reversed.

Acceptance criteria:
- Ingestion clusters duplicates by DOI then by title-plus-author overlap, conservatively.
- Canonical records carry a `versions[]` history, preferring the published version.
- The paper page shows version history.
- The backfill run is logged and reversible.
- Build, typecheck, and tests pass.

## 10. Phase 7: Trials monitoring view

Goal: make ClinicalTrials.gov watchable by theme and by organization, which the source site does poorly.

Steps:
1. Add a trials view that lists trials with filters by indication, by modality (reusing Phase 4 facets), by sponsor organization, by status, and by phase.
2. For each trial show NCT number, status, phase, enrollment, sponsor (linked org), studied device (linked device), primary endpoint, and last-updated. Link to ClinicalTrials.gov and to the internal record.
3. Track status changes. On each ingestion run, compare a trial's status and key fields to the stored version and record a change event (for example, "recruiting to active" with a date). Show a recent-changes list in the trials view. This change log is what Phase 8 subscribes to.
4. Sort by most recently changed by default, so a returning user sees what moved.

Acceptance criteria:
- The trials view filters by indication, modality, sponsor, status, and phase.
- Each trial row is fully linked to its sponsor and device.
- Status changes are detected on ingestion and shown as dated events.
- Build, typecheck, and tests pass.

## 11. Phase 8: Watchlists and weekly digest

Goal: let a user follow specific entities and receive a weekly summary of what changed.

First, check the Phase 0 finding on authentication.

### 11.1 If no authentication exists

1. Implement watchlists as local-first storage in the browser (not server accounts). A user can star any entity (organization, device, trial, paper, or a facet query) and see a "My watchlist" view assembled from local state.
2. Provide an export of the watchlist (JSON download) so a user does not lose it.
3. For the digest, generate an on-demand "What changed" view that computes changes across watched entities since the user's last visit, using the change events from Phases 6 and 7. Do not send email in this path. Note in the phase output that email delivery requires the backend work in 11.2.

### 11.2 If authentication exists (or is added deliberately)

1. Store watchlists per user in the data layer.
2. Add a scheduled job (a cron on the existing deployment platform) that, once a week, compiles each user's changes (new linked papers, trial status changes, new clearances, new adverse-event reports on watched devices) into a digest.
3. Send the digest through a real transactional email provider. Do not stub or fake sending. If no provider is configured, stop and leave the wiring documented in the phase output rather than pretending mail is sent.

Guardrail: the digest reports only the in-scope changes (papers, trials, devices, regulatory, adverse-event counts). It does not report funding, deals, patents, or talent, per Section 2.

Acceptance criteria:
- Users can star entities and facet queries and see a watchlist.
- Changes are computed from real change events, not invented.
- Email is either sent through a real provider or left clearly unimplemented with wiring documented. Nothing is faked.
- Build, typecheck, and tests pass.

## 12. Phase 9: Citation export

Goal: get a citation out of a paper in two clicks, and let the Zotero connector detect records automatically.

Steps:
1. Add a "Cite" control on every paper page and paper list row. It offers BibTeX and RIS, each with a copy-to-clipboard action and a file download. Generate both from the stored record fields (authors, title, venue, year, DOI, URL). Do not scrape a third party for the citation.
2. Add machine-readable citation metadata to the paper page head so the Zotero browser connector detects it without a plugin. Use Highwire Press tags (`citation_title`, `citation_author`, `citation_publication_date`, `citation_journal_title`, `citation_doi`, `citation_pdf_url`) and, where practical, Dublin Core tags. Verify with the Zotero connector that a paper page is detected as a single item with correct authors and DOI.
3. Escape fields correctly for BibTeX (braces, special characters) so the output imports cleanly. Add a test that round-trips a sample record through BibTeX and RIS.

Acceptance criteria:
- Paper pages and rows offer BibTeX and RIS with copy and download.
- The Zotero connector detects a paper page as one item with correct metadata.
- BibTeX and RIS output imports without errors, covered by a test.
- Build, typecheck, and tests pass.

## 13. Phase 10: Business and market context (separate layer)

Goal: give operators (industry, competitive-intelligence, and investor users) a sourced view of company funding, deals, patents, and public talent signals. Keep it in a clearly separated layer so it does not change the researcher-first core or the ranking.

Read this before you build the phase. The rest of NeuroBase runs on open, free, structured sources (arXiv, bioRxiv, PubMed, ClinicalTrials.gov, openFDA). None of the data in this phase comes from those. The sourcing is harder, thinner, and lower confidence, and one data type has no compliant source at all. Honor the source posture below for each type. Do not paper over a gap with a guess.

### 13.1 Sources and their posture

- Funding: SEC EDGAR is open and structured. Form D covers US private placements, S-1 and 424B cover IPOs, and 8-K covers material events. Non-US rounds and undisclosed raises are not in EDGAR. Do not fill those gaps. A press release may be used as a secondary source, marked at lower confidence.
- Mergers and acquisitions: there is no single open structured feed. Deals are disclosed through primary announcements, and public acquirers also file 8-K. Model each deal as an event record tied to a primary announcement link.
- Patents: USPTO PatentsView (open, free, structured API) and EPO OPS (open, requires registration). This is the strongest open source in the set.
- Talent: there is no compliant open API for talent moves. LinkedIn prohibits scraping in its terms, and scraping it carries legal and terms-of-service risk. Restrict talent signals to what is disclosed in press releases, company announcements, or the organization's own site (for example, a named new Chief Medical Officer in a press release). Do not scrape LinkedIn or any site that prohibits it.

### 13.2 Partitioning (this is the point of the phase)

1. Put business data under a separate, plainly labeled section or tab on the organization page (for example "Business"), visually and structurally distinct from the research dossier built in Phase 2.
2. Business fields must not feed the ranking pipeline, the Feed, or the research facets. The score that ranks a paper must not change because the company that makes the device raised money. Verify this by inspecting the ranking inputs after the phase.
3. Give business records their own provenance block with an explicit confidence level, since a news-sourced item is lower confidence than an EDGAR filing or a USPTO record.

### 13.3 Sub-features

1. Funding events: from SEC EDGAR. Show round type where derivable, date, amount if disclosed, and the filing link. Mark undisclosed amounts as undisclosed. Never estimate an amount.
2. M&A events: acquirer, target, date, and the primary announcement link. Corroborate public-acquirer deals with the 8-K where available.
3. Patents: from PatentsView and EPO OPS, linked to the organization as assignee. Show title, filing or grant date, patent number, and a link. Link a patent to a device only where the mapping is confident, and leave it unmapped otherwise.
4. Public talent signals: only from disclosed announcements. Show role, name, date, and the source announcement link. No LinkedIn-derived data.

### 13.4 Verification additions for this phase

- Confirm every business record links to a primary filing or announcement.
- Confirm no business field influences a rank score or the Feed, by checking the ranking inputs directly.
- Confirm talent data originates only from disclosed announcements, with a source link on each record.

Acceptance criteria:
- The business layer lives on a separate, labeled section of the org page, sourced from EDGAR, PatentsView or EPO, and disclosed announcements.
- Amounts are shown as disclosed or undisclosed, never estimated, and no valuation is inferred.
- No talent data comes from non-compliant scraping.
- Business signals do not feed the ranking pipeline, the Feed, or the research facets.
- No investment guidance appears anywhere.
- Build, typecheck, and tests pass.

## 14. Cross-cutting requirements

Apply these throughout, not as a separate phase:

- Accessibility. Every interactive control is keyboard reachable and labeled. Facet filters, the Cite control, and watchlist stars work with a keyboard and a screen reader. Color is never the only signal for a badge; pair it with text or an icon. Check contrast on new UI.
- Performance. Graph and facet queries can be heavy. Paginate lists, and avoid loading a full org dossier's linked records eagerly if the data layer allows lazy or partial loading. Confirm that adding relationships in Phase 1 did not create unbounded queries on high-degree entities (a large lab with hundreds of papers).
- Empty and loading states. Every new view has an explicit empty state ("No trials linked yet") and a loading state. Never render a blank panel.
- No layout regressions on existing routes. After each phase, load the Feed, Research, Devices, Trials, and existing company routes and confirm they still render.

## 15. Verification (run at the end of every phase)

1. Run the build. It must pass with no new errors.
2. Run the typecheck. It must pass with no new errors.
3. Run the linter. Fix new warnings you introduced.
4. Run the existing test suite. It must stay green. Add tests for new logic (dedup matching, BibTeX and RIS generation, facet mapping, change detection).
5. Load the routes you touched and the main routes you did not, and confirm they render.
6. Spot-check three real records end to end: pick one organization, one device, and one paper, and confirm every fact on the page traces to a source link and that nothing is fabricated.
7. Write a short phase summary in the commit body: what changed, what you verified, and anything you left unbuilt and why.

## 16. Suggested sequencing

Ship in this order, because each phase depends on the ones before it:

1. Phase 0 (audit) and Phase 1 (graph and provenance) are prerequisites for everything. Do them first and do not shortcut them.
2. Phase 2 (company dossiers) next, since it is the page in focus and it exercises the graph end to end, which will surface any gaps in Phase 1.
3. Phase 4 (facets) before Phase 3 and Phase 7, because both reuse the facet component.
4. Phase 3 (device lineage), Phase 5 (reproducibility signals), and Phase 6 (dedup) in any order after facets exist.
5. Phase 7 (trials monitoring), which needs change events.
6. Phase 8 (watchlists and digest), which subscribes to the change events from Phases 6 and 7.
7. Phase 9 (citation export), which is self-contained and can be done at any point after Phase 1, but is listed last among the core phases because it is lowest risk.
8. Phase 10 (business layer) last, and only once the research core is solid. It attaches to the organization page from Phase 2, but its sourcing and partitioning are independent of the other phases. Do not start it before Phase 2 exists, and do not let it delay the core.

Do not attempt all phases in one pass. Complete, verify, and commit one phase before starting the next.
