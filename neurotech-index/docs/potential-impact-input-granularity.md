# Potential Impact: input granularity and the reachable rubric

**Resolves open decision 1** of
[`neurobase-potential-impact-build-spec-v1.0.md`](neurobase-potential-impact-build-spec-v1.0.md).
Measured 29 July 2026 against the live corpus.

The spec says the decision is between full text, abstract only, and metadata
only, and that "on abstracts alone those levels are unreachable in practice, and
the rubric should be capped and documented rather than specifying levels the
pipeline cannot support."

That framing turned out to be only partly right. Four levels were unreachable,
and only one of the four was unreachable because of input granularity.

---

## 1. What was actually blocking each level

### FD 3, "opens a new axis" — blocked by record density, not by text

FD 3 means no prior record existed on the axis. That is a claim about **our
record layer**, not about the item. With 3 to 5 records per subfield, an absent
axis means "nobody has curated it", not "nobody has achieved it", so absence
carries no signal and the level cannot be awarded honestly.

Two further problems, both in the spec rather than the pipeline:

- Section 7.1.3 caps FD at 0 when a subfield has **no records at all**. That is
  correct. But the spec never says how to treat the case that actually matters:
  subfield well covered, this one axis absent. That rule has to be written before
  FD 3 means anything.
- The threshold is unstated. "Well covered" needs a number, and it should be
  per-subfield, since coverage is uneven.

**Status: still blocked.** Needs record-layer depth (the spec's own Phase 2
estimate was 65 to 130 records; there are 61) and an informative-absence rule.
No amount of full text changes this.

### FD 4, "collapses a tradeoff" — was blocked by a missing data structure

A 4 requires naming both paired axes and why the tradeoff was binding. Nothing
in the schema said two axes were coupled, so the MUST could not be satisfied and
the check ("improved A without regressing B") could not be run. **A full paper
could not have been scored 4 either.**

**Status: unblocked.** Migration 012 adds `frontier_axis_pairs`, seeded from the
pairs section 5.1.1 names. FD 4 is now largely arithmetic over existing records
plus a curated `why_binding` statement.

Two of the four families the spec names are **not** yet instantiable, because no
record measures either side: selectivity against coverage, and efficacy against
titration burden. They are recorded as a work queue in
`scripts/data/frontier-axis-pairs.json` rather than invented.

### METH 3 and 4 — were blocked by under-ingestion, not by full text

METH 3 is "establishes an endpoint or trial design likely to become standard".
METH 4's worked example is "a validated sham control for a modality that lacked
one". Both are properties of the trial's **endpoints and arms**, and both live in
the ClinicalTrials.gov registration, which is free and already fetched nightly.

NeuroBase was storing phase, status, sponsor, enrollment, conditions and
interventions, and discarding `outcomesModule`, `armGroups[].type` and
`maskingInfo.whoMasked`. The ingest was not even requesting a narrower field set;
the data was in the response and being dropped.

**Status: unblocked.** `scripts/lib/trial-design.js` captures it and
`scripts/backfill-trial-endpoints.js` filled in the existing corpus:

| | |
|---|---|
| Trials with a pre-specified primary endpoint | 8,216 / 8,345 |
| With a sham arm | 1,812 |
| With any control arm | 4,090 |
| With masking beyond none | 3,923 |
| Outcome measures captured | 56,301 |

This also sharpens the design-quality grade (5.3.2), which separates `decisive`
from `strong` on whether a primary endpoint was pre-specified.

### Methods-level detail for Research and Devices — the real input problem

This is the one case where the spec's framing was right, and it has a hard
ceiling.

| | |
|---|---|
| Papers with a PubMed id | 83,812 / 83,958 (99.8%) |
| Papers with an arXiv id | 134 |
| Recent in-scope PMIDs present in PMC | 43.8% |
| Of those, open-access full text available | 65% |
| **End-to-end full-text reach** | **~28%** |

The corpus is almost entirely PubMed, so full text depends on PMC Open Access.
Roughly 28% of recent in-scope papers can be read at methods level. The rest are
abstract-only and will stay that way; the remainder is paywalled and not
redistributable.

---

## 2. The decision

**Tiered input, with the tier recorded per item and the rubric capped per tier.**

Not a single global cap. A global cap set for abstracts would throw away the 28%
that can support a methods-level judgement, and a global cap set for full text
would license scores the evidence does not carry.

### `input_granularity`

Phase 4 MUST record on every `ImpactScore`:

```
input_granularity: "full_text" | "abstract" | "registry" | "metadata"
```

`registry` is the trial case: not full text, but structurally richer than an
abstract, because endpoints and arms are declared fields rather than prose.

### Caps

| Granularity | FD cap | METH cap | Reasoning |
|---|---|---|---|
| `full_text` | 4 | 4 | Methods available; no cap beyond the rubric itself. |
| `registry` | n/a | 4 | Endpoints and arms are declared fields. METH is fully assessable. |
| `abstract` | 3 | 2 | A tradeoff collapse can be claimed from an abstract when both paired values are reported, so FD 4 stays reachable via a pair. METH 3 needs endpoint detail an abstract rarely gives. |
| `metadata` | 0 | 0 | Nothing to score against. Leverage and gate paths only. |

FD stays capped at 3 by *record density* independently of granularity until the
informative-absence rule exists. The two caps are separate and both apply; the
lower wins.

### Consequences that must hold

- A capped score MUST record that it was capped, not silently score lower. The
  cap is a property of the input, not a judgement about the item.
- Re-scoring when better input arrives MUST be possible. `rubric_version` plus
  `input_granularity` make that traceable, so an abstract-only score can be
  upgraded later without ambiguity about why it changed.
- Monitoring (section 13) SHOULD add the distribution of `input_granularity` in
  the top 50. If the top of the ranking is disproportionately full text, the
  sort is partly ranking access to text rather than potential impact, which is a
  bias of exactly the kind this rebuild exists to remove.

---

## 3. What is still open

- **The informative-absence rule for FD 3.** Needs a per-subfield coverage
  threshold and a written rule. Product decision.
- **Record-layer depth.** 61 capability records against the spec's 65 to 130
  estimate, and the promotion queue still holds 706 unreviewed proposals.
- **Selectivity/coverage and efficacy/titration axes.** Needed before two of the
  four spec-named tradeoff families can be evaluated.
- **PMC Open Access ingestion.** Not built. Would lift roughly 28% of recent
  papers to `full_text`. Deferred as infrastructure, not as a blocker.
