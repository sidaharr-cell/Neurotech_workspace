# Potential Impact Phase 4: binding design constraints

Written **before** Phase 4, so these are constraints on the implementation
rather than a description of it. Each one exists because of something already
measured in this build, cited inline.

Phase 4 covers spec sections 7.3 (score), 7.4 (validate) and 6 (compose). It
accepts when "all validation rules in Section 8 fire correctly on constructed
adversarial cases, and no dimension score above 0 survives without a referent."

---

## 1. The scorer takes its comparison set as a parameter

**Required signature shape.** Scoring MUST receive the frontier records, the
axis pairs and the coverage verdict as arguments. It MUST NOT query
`frontier_records_live`, `frontier_axis_pairs_live` or compute coverage
internally.

```
scoreItem(extraction, {
  records,        // FrontierRecord[]  the comparison set, already filtered
  axisPairs,      // AxisPair[]        for FD 4
  fdCeiling,      // 0 | 2 | 4         from frontier-coverage.js
  granularityCap, // per docs/potential-impact-input-granularity.md
})
```

**Why.** Phase 5 calibration requires "a frontier record set reflecting field
state at the **start** of the window", and the spec is emphatic that scoring
2017 items against 2026 records "inverts the entire exercise." Our record layer
cannot supply that today: of 230 live records, 21 predate 2016 and 194 are 2020
or later. A 2016 baseline has to be built separately.

If the scorer reads "current" records internally, Phase 5 can only run by
forking it, and a forked scorer validates something other than what ships. Passing
the set in costs nothing now and is expensive to retrofit once callers exist.

This also makes the scorer directly testable against the adversarial corpus
without a database.

## 2. Two ceilings apply, and the lower wins

```
effectiveFdCeiling = min(fdCeiling, granularityCap.FD)
effectiveMethCeiling = granularityCap.METH
```

`fdCeiling` comes from `src/lib/frontier-coverage.js` and answers "is this
subfield mapped well enough for an absence to mean anything". `granularityCap`
comes from `docs/potential-impact-input-granularity.md` and answers "did we
actually read enough of this item to justify the level". They are independent
and both bind.

A capped score MUST record that it was capped and which ceiling bound it. The
cap is a property of our inputs, not a judgement about the item, and conflating
the two makes a thin record layer look like a weak field.

## 3. The section 8 validators run against the corpus, not against themselves

The 43 cases in `scripts/data/section8-cases.json` were written from the spec
text before any validator existed. Implementations MUST be checked against that
file rather than against tests written alongside them.

**Why, specifically.** Every verification artifact built earlier in this project
was wrong about the thing it checked, and each error was invisible until
something external contradicted it:

- the grounding checker produced four distinct families of false positive
  (spaced minus signs, spelled-out counts, missing leading zeros, float noise)
  and reported a passing extractor as failing;
- a Supabase probe using `head: true` swallowed its error object, so migration
  011 was reported as applied when it was not;
- a duplicate-axis check reported 59 duplicates that were an artifact of columns
  the query had not selected;
- a constraint probe counted *any* insert error as a constraint rejection, so
  five constraints appeared verified while the table did not exist.

Section 8 is eight validators; the phase is almost entirely checks. A broken
validator does not produce a broken-looking score. It produces a normal-looking
score for an item that should have been reset, and nothing downstream can tell.

The corpus deliberately includes 17 over-fire guards among its 43 cases, because
a validator that resets everything passes every positive case and destroys the
sort.

## 4. Monitoring is wired from the first scored batch

Spec 13 is listed under Phase 7. The subset below MUST be emitted from the first
batch Phase 4 scores, not retrofitted:

- **Correlation between `rhetorical_markers` count and `potential_impact`.** The
  spec calls this "the single most important number here". It is only meaningful
  as a series, and a series cannot be backfilled. Phase 3 sampling already found
  27 of 48 items using promotional language with only 19 flagged, so there is a
  baseline to compare against.
- **Validation reset rates by rule number.** Spec 8: "a rising rate on rule 1 or
  3 means the model is drifting toward unanchored judgment."
- **Path split across the four paths.** Spec 6 built the leverage and gate paths
  specifically to catch items with no rhetorical markers of importance. If
  almost nothing takes them, that machinery is not working.

## 5. Composition is multiplicative, and nothing sums

Spec 2 and 6. `MUST NOT sum dimension scores` and `MUST NOT sum the paths`.
`base = max(frontierPath, leveragePath)`, then
`potential_impact = base * evidenceMultiplier * recency`.

Recency uses a gentler curve than Feed and MUST be a separate tunable constant,
not a shared one, because "the premise of the filter is that important work is
recognized slowly".

No cross-subfield normalization at write time. If one subfield dominates,
normalize at read time; baking it into the stored score makes the calibration
harness uninterpretable.

## 6. Nothing user-facing carries a number

Spec 9.1. No numeric scores, no dimension names, no rubric vocabulary, no
evidence multiplier. The internal inspection view (9.3) is the only place the
rubric is visible and MUST be built in the same phase as the scorer, not later.

---

## Open, and blocking Phase 5 rather than Phase 4

- **The 2016 baseline record set.** Not built, and not derivable from the current
  layer. Phase 5 is blocking per spec 11: do not ship as a default sort until it
  passes.
- **Open decision 3, who authors the retro-holdout reference list.** Self-authoring
  it defeats the test by construction. The spec names a domain expert building it
  blind to the scores as materially stronger evidence.
