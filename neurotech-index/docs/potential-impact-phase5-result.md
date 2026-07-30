# Phase 5 calibration: FAILED

Run 29 July 2026. Rubric 1.0, extractor extract-1.0, model claude-sonnet-5.

**Phase 5 is blocking (spec section 11). On this evidence the potential-impact
sort must not ship as a default sort.**

---

## Result

```
2016 baseline      187 records established on or before 2016-01-01
sample             200  (24 reference, 100 negative, 76 background)
scored             193 of 200; 7 refused for malformed tool output
holdout            reference 05f555607f1c284f (24), negative 90cefddd1ad255e3 (325)
```

| Metric | Value | Reading |
|---|---|---|
| Recall at top decile (spec 12 primary) | **5 of 23 — 22%** | fail |
| Negative case: hyped items in top decile | **14 of 95 — 14.7%** | above the 10% a neutral ranker gives |
| P(reference outranks a hyped item) | **45.7%** | below the 50% of chance |

Context: paths `gap 124, frontier 48, leverage 16, gate 5`; entities
`trial 129, research 64`; 33 of 193 items scored zero.

## What each number means

**Recall 22%** misses 18 of 23 reference items. Spec 12 is explicit that recall
is the primary metric and that missing items is the failure mode: "A top decile
containing all five items that mattered plus fifteen that did not is a success.
A high-precision top decile that misses two is a failure."

**The negative case is above chance.** The top decile is 10% of the sample by
construction, so a ranker with no signal places about 10% of hyped items there.
This placed 14.7%. Hyped items are slightly over-represented at the top, which
is the direction spec 12 built this test to detect.

**45.7% is the number that carries the most weight.** It is base-rate invariant,
so the sample enrichment does not flatter it. A reference item is marginally
less likely than a coin flip to outrank a hyped one.

## The confound, which is real and does not rescue the result

The comparison is almost entirely trial against trial (129 of 193 scored items).
The reference set is largely Phase 3/4 trials that POSTED RESULTS; the negative
set is trials the old sort ranked highly that did NOT. So the property actually
being discriminated is close to "did the sponsor follow through and report",
and nothing in GAP, GATE or METH claims to predict sponsor behaviour. GAP scores
how open a question is, not how likely a registration is to read out.

This makes the run a weaker test of the rubric than the headline numbers imply.
It does not convert a failure into a pass. The honest status is
inconclusive-to-negative, and inconclusive does not clear a blocking gate.

## Limits that were known before the run and still apply

- **No 2016-2019 media coverage exists in this corpus.** Every window feed row is
  a trial registration, so "received heavy attention" is proxied by the old
  sort's own structural ranking rather than by press. That is a weaker hype
  probe than spec 12 intends.
- **The reference list is an institutional-trace proxy**, built from FDA
  decisions after 2019, surviving 2026 frontier records, and Phase 3/4 readouts.
  It cannot see a method that quietly became standard. Open decision 3 remains
  open and a domain expert's list built blind to the scores would be strictly
  better evidence.
- **Leakage is only partly mitigated.** Entity stripping removed a named
  organisation from 9 of 200 items; a distinctive method stays identifiable from
  its description.

## Defect in the harness, found by this run

`scripts/run-calibration.js` computes the retro scores and discards them. That
makes it impossible to ask WHY reference items ranked low without paying for the
whole run again. Storing them under the existing `run_label` column in
`impact_scores` is the first fix.

## Next steps, in order

1. **Store the retro scores.** Cheapest fix, and everything diagnostic depends
   on it.
2. **Re-run the negative case on RESEARCH items rather than trials.** That tests
   hype correlation where rhetorical markers actually live, which is what spec 12
   is aiming at, and removes the sponsor-follow-through confound.
3. **Obtain a domain expert reference list.** Open decision 3 is the single
   largest lever on whether this test means anything.

**Not** recommended: tuning the rubric against this result. The test is known to
be confounded, and fitting to it would optimise for sponsor reporting behaviour
rather than for potential impact.
