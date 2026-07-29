# NeuroBase: funding chart revision

A phased prompt for Claude Code. Run one phase per session. Do not paste the whole file at once.

Each phase ends with a checkpoint. Review the diff before starting the next phase.

---

## Decisions

These are settled. Change them here rather than mid-phase, because Phases 1, 3, and 4 all read from this table.

| Slot | Value |
|---|---|
| `CAPITAL_SCOPE` | `private_only` |
| `DEFAULT_SORT` | `total_raised` (see the switch condition below) |
| `DEFAULT_STATUS_FILTER` | `active_only`, defined as `private` plus `public`. Excludes `acquired` and `defunct`. |
| `INCLUSION_RULE` | See below. |
| `ATOMWISE_DECISION` | Drop. |

### Inclusion rule (exact text, render this in the chart caption)

> Companies whose primary product interfaces with, measures, or modulates the nervous system. This includes implanted and external neuromodulation devices, brain-computer interfaces, neurological diagnostic and imaging software, and prescription digital therapeutics for neurological or psychiatric indications. It excludes companies developing drugs for neurological indications, and excludes general-purpose platforms that are not specific to the nervous system.

Every record needs an `inclusion_basis` that can be defended against this text. If a record cannot get one, remove it and promote the next company by total raised. Removing Atomwise opens a slot, so the record entering at rank 20 needs an `inclusion_basis` written before the chart ships.

### Public and acquired companies stay, with a marker

Under `private_only`, any record with `status` of `public` or `acquired` carries the partial-total marker described in Phase 4. Do not remove these records from the database or from the filterable set. Their private capital totals are real and are the most interesting figures on the chart, because they show what it cost to reach approval or acquisition.

They are excluded from the default view by `DEFAULT_STATUS_FILTER`, not by deletion. The filter control shows a count of what is hidden, for example "4 acquired or defunct companies hidden," so the omission is visible rather than silent.

### Switch condition for `DEFAULT_SORT`

`trailing_24mo` is the better default, but it cannot be the launch default. The Phase 2 backfill populates `funding_rounds` from the existing latest-raise fields only, so the table will hold at most one round per company on day one. A trailing 24-month sort against that data would be wrong in a way that looks authoritative.

Ship with `total_raised`. Switch the default to `trailing_24mo` once `funding_rounds` holds at least three years of history for 80 percent of records. Add that threshold as a check in the verification CLI from Phase 2 so the condition reports itself rather than being remembered.

---

## Hard rules (apply to every phase)

1. **Never write a financial figure that does not have a source.** Every dollar amount, date, and status value needs a source URL and a retrieval date stored alongside it. If you cannot find a source, write `null` and set the reason field. Do not estimate. Do not carry a number forward from a previous record without re-checking its source. Do not fill a gap from your own training data.
2. **Do not restyle the component.** The existing visual system (typography, blue bar palette, card layout, spacing) stays. Use existing design tokens. New elements inherit from them. This task is about information, not aesthetics.
3. **Investigate before editing.** Read the actual schema, the actual ingestion code, and the actual component. Do not assume file paths or field names from this document.
4. **Ask when the codebase contradicts this spec.** If a field already exists under a different name, use the existing name and say so. Do not create a duplicate.
5. **No migration runs against production data without explicit approval.** Write the migration, show it, stop.

---

## Phase 0: reconnaissance

Do not edit any files in this phase.

Find and report:

- The component that renders the "Top 20 neurotech companies by funding raised" chart. Give the file path and the charting library.
- The data model for organizations. List every field, its type, and whether it is nullable.
- The data model for funding rounds, if one exists separately from the organization record. If funding is stored as flat fields on the organization, say so explicitly, because that constrains everything downstream.
- The ingestion path for SEC Form D data. Which endpoint, what parsing, what matching logic maps a filing to an organization record, and how failures are handled.
- How the top 20 set is currently selected, and whether the sort toggles reorder a fixed set or reselect the set.
- Whether any provenance is currently stored for funding figures (source URL, retrieval timestamp, filing accession number).
- Whether organization records already link to trials, devices, papers, and people, and whether an organization detail route exists.

Write the findings to `docs/funding-chart-audit.md`. Include a short section listing every assumption in this prompt document that turned out to be wrong.

**Checkpoint. Stop here.**

---

## Phase 1: schema

Extend the organization model. Use existing field names where equivalents already exist.

### Status and scope

- `status`: enum. `private`, `public`, `acquired`, `subsidiary`, `defunct`. Not nullable.
- `status_effective_date`: date. When the company entered this status.
- `status_source_url`, `status_verified_at`.
- `capital_scope`: enum. `private_only` or `all_capital`. Describes what `total_raised_usd` counts for this record. Set globally to `CAPITAL_SCOPE`, but store per record so mixed sets are detectable.

### Funding with provenance

Every figure gets three companions: a source URL, a retrieval timestamp, and a confidence value.

- `total_raised_usd`: integer or null.
- `total_raised_source_url`, `total_raised_retrieved_at`.
- `total_raised_confidence`: enum. `filing_verified` (traceable to an SEC filing or company release), `press_reported` (reputable outlet, no primary document), `unverified`.
- `latest_raise_usd`, `latest_raise_date`, `latest_raise_source_url`, `latest_raise_retrieved_at`, `latest_raise_confidence`.
- `latest_raise_accession_number`: the SEC accession number when the source is a Form D.

### Replace the ambiguous n/a

- `latest_raise_unavailable_reason`: enum, nullable. Set only when `latest_raise_usd` is null.
  - `no_filing_found`: searched, nothing located.
  - `not_applicable_public`: company is publicly traded, private rounds are not the relevant instrument.
  - `not_applicable_acquired`: company was acquired, no longer raising independently.
  - `foreign_issuer_not_covered`: company is not a US issuer, so Form D does not apply.
  - `unverified`: not yet checked. This is the default for new records and should be treated as a work queue, not a display state.

The current chart shows one `n/a` for five different situations. That is the specific defect this field fixes.

### Classification

- `modality`: enum. `implanted_bci`, `neuromodulation`, `diagnostics_imaging`, `digital_therapeutic`, `computational_neuro`, `other`. Single primary value.

`computational_neuro` covers companies building computational models of neural systems. It is deliberately not a drug discovery category, since the inclusion rule excludes general-purpose discovery platforms. Expect it to be empty or near-empty at launch. If it is still empty after Phase 2 verification, drop the value rather than leaving a dead legend entry in the chart.
- `modality_secondary`: same enum, nullable.
- `inclusion_basis`: text, max 200 characters. Why this company is in the neurotech set. Required for every record. If you cannot write one, the record does not belong.

### Regulatory and clinical stage

- `furthest_stage`: enum, ordered. `preclinical`, `first_in_human`, `feasibility`, `pivotal`, `de_novo_granted`, `cleared_510k`, `approved_pma`, `ce_marked`, `commercial`, `withdrawn`.
- `stage_evidence_type`: enum. `clinicaltrials_gov`, `openfda`, `company_release`, `none`.
- `stage_evidence_id`: the NCT number, FDA submission number, or URL.
- `stage_verified_at`.

`furthest_stage` must be derivable from `stage_evidence_id`. A stage with no evidence is `null`, not a guess.

### Naming and freshness

- `display_name`: the common name. This is what the chart renders. No truncation at the data layer.
- `legal_name`: as filed.
- `last_verified_at`: the oldest of the individual verification timestamps on the record. Computed, not entered.

### Validation

Add a check, run in CI, that fails when:

- A non-null dollar figure has a null source URL.
- A null `latest_raise_usd` has a null `latest_raise_unavailable_reason`.
- A non-null `furthest_stage` has `stage_evidence_type` of `none`.
- A record has a null `inclusion_basis`.

Write the migration. Write a backfill script that sets every new field to `null` or `unverified` rather than guessing. Do not run either.

**Checkpoint. Stop here.**

---

## Phase 2: ingestion and verification

### Fix the Form D coverage gaps

The current pipeline produces null for at least five of twenty companies. Diagnose each before writing code.

1. Log why each null occurred. Distinguish "the entity was never matched to a filing" from "the entity was matched and has no recent filing."
2. Foreign issuers do not file Form D. Detect this from the entity record or from an absent CIK, and set `foreign_issuer_not_covered` rather than `no_filing_found`. Two companies in the current top twenty are non-US.
3. Public and acquired companies need their own branch. When `status` is `public` or `acquired`, do not query Form D. Set the corresponding not-applicable reason.
4. Entity name matching is the likely failure point. Check whether the matcher handles legal suffixes, DBA names, and holding company structures. Report the match rate before and after any change.

### Add a rounds table if one does not exist

Trailing-window sorting needs individual rounds, not a single latest-raise field. If funding is currently stored as flat fields, create a `funding_rounds` table with organization foreign key, amount, date, round type, source URL, accession number, and retrieved timestamp. Backfill from existing latest-raise fields only, marking older rounds as absent rather than reconstructing them.

### Verification queue

Add a CLI command that lists records where `last_verified_at` is older than 90 days or any confidence value is `unverified`. Output as a table sorted by total raised descending, so the most visible records surface first.

### Tests

- A public company never gets a Form D query.
- A foreign issuer resolves to `foreign_issuer_not_covered`.
- A figure without a source URL fails validation.
- Backfill never writes a non-null dollar amount.

**Checkpoint. Stop here.**

---

## Phase 3: query layer

### Sort keys

- `total_raised`: current behavior.
- `trailing_24mo`: sum of `funding_rounds.amount` where date falls within the last 24 months. Companies with no qualifying round sort last, not as zero-with-a-bar.
- `latest_raise_size`.
- `latest_raise_date`.

Set `DEFAULT_SORT` as the default.

### Fix the set-versus-sort mismatch

Right now the title fixes the set at the top 20 by total raised, and the toggles only reorder that fixed set. Under "Latest raise size," a company with a large recent round but a smaller lifetime total can never appear. That is misleading.

Reselect the set for each sort key. The top 20 by trailing 24-month capital is a different set of companies than the top 20 by total raised, and that difference is the point.

Update the title to reflect the active sort. "Top 20 neurotech companies by capital raised in the last 24 months" when that sort is active.

### Filters

- `status`: multi-select. Default to `DEFAULT_STATUS_FILTER`.
- `modality`: multi-select. Default all.
- `furthest_stage`: range. Default all.

### Response payload

Every row returns: rank, display name, organization detail URL, total, capital scope flag, latest raise amount and date or the unavailable reason, status, modality, furthest stage, stage evidence link, last verified date.

Add a set-level metadata object: total number of organizations tracked in the database, the inclusion rule text, the capital scope, and the timestamp of the most recent ingestion run.

**Checkpoint. Stop here.**

---

## Phase 4: chart component

Preserve the existing visual system. Every change below is informational.

### Corrections

- Render `display_name` in full. Remove the truncation that produces "Axonics Modulation Techno...".
- Format dates as "Jun 2025", not "Jun 25". The current format reads as a day.
- Replace the bare `n/a` with the specific reason, abbreviated in the cell and expanded on hover. "Public" and "Acquired" are informative. `n/a` is not.
- Add rank numbers to the left of each label.

### New elements

- **Status badge** beside the company name for anything not `private`. Public, Acquired, and Defunct are the ones that matter. Pear Therapeutics and Axonics currently sit in a live leaderboard with no indication of what happened to them.
- **Modality color.** Assign each modality a hue within the existing blue-forward palette, or a small legend swatch next to the name if the bars must stay monochrome. Prefer the swatch if recoloring the bars weakens the existing look.
- **Stage badge** placed in the empty right-hand plot area. The chart currently wastes roughly 40 percent of its width. A stage badge there costs nothing and adds the most useful single fact about each company.
- **Row links.** The entire row links to the organization detail route. Nothing in a database should be a dead end.
- **Partial-total marker** when `capital_scope` is `private_only` and `status` is `public` or `acquired`. A superscript symbol with a footnote reading that the figure excludes public market capital.
- **Caption block** below the chart: the inclusion rule, the capital scope, the count of organizations tracked, and the last ingestion timestamp.

### Layout

Keep the linear scale. A log scale would compress Neuralink usefully but misleads a general audience about relative magnitude. Instead, reclaim the empty width for the stage badge and let Neuralink stay visually dominant, because it is.

Ranks 8 through 20 span $268M to $163M and are nearly indistinguishable. The numeric column already carries that precision, so do not try to fix it in the bars.

### Accessibility

- Every bar has an accessible name including company, total, status, and stage.
- Rows are keyboard focusable with a visible focus ring.
- Provide a table view toggle rendering the same data as a semantic `<table>`.
- Do not encode status by color alone. Badges carry text.
- Check contrast on any new modality colors against the card background.

### Tests

- A record with a null latest raise renders the reason, never `n/a`.
- A record with a null stage renders no badge, not "Unknown".
- Long company names do not overflow or truncate at any breakpoint.
- The title text matches the active sort key.

**Checkpoint. Stop here.**

---

## Phase 5: capital versus stage scatter (separate session)

Only start this after Phases 1 through 4 are merged and the stage data is populated and verified.

Build a second visualization on the same data.

- X axis: total raised, linear.
- Y axis: `furthest_stage`, ordered categorical from `preclinical` to `commercial`.
- Point color: modality.
- Point size: trailing 24-month capital.
- Hover: company name, both axis values, the stage evidence link.
- Click: organization detail route.

Include only records where `stage_evidence_type` is not `none`. A scatter built on inferred stages is worse than no scatter.

The claim this chart supports is that capital and clinical maturity are only loosely coupled in neurotech. Confirm that the actual data shows this before shipping it. If the data does not support the claim, report that instead of adjusting the chart to produce it.

---

## Do not

- Do not fill any missing figure from training data.
- Do not infer a regulatory stage from a company description.
- Do not classify modality without reading what the company actually builds.
- Do not delete records for companies that are defunct or acquired. They are part of the history. Mark them.
- Do not restyle the card, change the typeface, or alter the blue palette.
- Do not add animation.
- Do not expand scope into other NeuroBase views.
