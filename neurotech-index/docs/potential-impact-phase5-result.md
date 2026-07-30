# Phase 5 calibration: FAILED (four runs)

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

---

# Second run: research-only hype correlation. ALSO FAILED.

Run 29 July 2026, 175 of 180 window research papers scored against the 2016
baseline. Run label `retro-research`.

This run exists because the first was confounded: 129 of 193 items were trials,
and the property being discriminated was close to "did the sponsor post results",
which no dimension claims to predict. Research papers are where rhetorical
markers live, so hype correlation is testable there and not there.

It also needs NO reference list and NO domain expert, which is why it could run
while open decision 3 stays unresolved.

```
marker/impact correlation      0.257     target: near zero
mean markers, top decile       2.78
mean markers, rest             1.70      top decile uses 63% more
mean impact WITH markers       0.325     n=117
mean impact WITHOUT markers    0.195     n=58     66% higher
paths: frontier 122, leverage 53   |   zero-scoring 51 of 175
```

Spec 13 calls this correlation "the single most important number here" and says
it should sit near zero: "Rising correlation is drift toward vocabulary matching
and is the single most important number here."

## The mechanism matters, and it is not what it looks like

Rhetorical markers are WITHHELD from the scoring prompt. The model never saw
them, so it cannot have scored on them directly. Two explanations remain:

**(a) A real correlation in the world.** Papers reporting stronger results may
also write more promotionally. Under this reading the rubric is fine and the
correlation is a property of scientific writing.

**(b) Leakage through `claimed`.** The extraction prompt says to record what the
item asserts "using the item's own framing, including its overstatement if it
overstates", and `claimed` IS passed to the scorer. So promotional register
reaches the scoring call after all, just one step removed. The scorer is told to
score against `demonstrated` and never `claimed`, but the text is in the payload.

These are cheaply distinguishable and the experiment has not been run: score the
same 175 papers with `claimed` withheld from the scoring payload and compare the
correlation. If it drops toward zero, the cause is (b) and the fix is to stop
passing `claimed` to the scorer, keeping it for the gap_flagged check only. If it
holds near 0.257, the cause is (a) and the rubric is not the problem.

**Until that experiment runs, this is a warning, not a verdict on the rubric.**
It is still a failure against the spec's stated target, and Phase 5 remains
blocking either way.

## A second harness defect, found by this run

Storage failed with `invalid input syntax for type integer: "2, "comment":
"n/a""`. `parseToolScores` validated the dimension blocks but not the scalars, so
a `translational_distance` carrying the folded remainder of the object reached
the database. Fixed: scalars are now coerced when recoverable and nulled when
not, and a bad scalar no longer aborts a run while a bad dimension still does.

Consequence for this run: the correlation above was computed in memory and is
valid, but nothing was persisted, so the underlying scores are gone and the
`claimed`-withheld comparison will need a fresh run.

---

# Third run: `claimed` withheld. The mechanism test is INCONCLUSIVE.

Same 175 papers, same seed, one variable changed: `claimed` removed from the
scoring payload. Run label `retro-research-noclaim`, 170 scored and stored.

| | claimed passed | claimed withheld |
|---|---|---|
| marker/impact correlation | 0.257 | **0.205** |
| mean markers, top decile | 2.78 | 2.18 |
| mean markers, rest | 1.70 | 1.90 |
| top-decile excess | **+63%** | **+15%** |
| mean impact with markers | 0.325 | 0.296 |
| mean impact without | 0.195 | 0.188 |

## The drop is in the predicted direction and is NOT statistically significant

Fisher z difference 0.055, SE 0.109, z = 0.50. At n = 170 a change from 0.257 to
0.205 is indistinguishable from noise. The top-decile marker excess falling from
+63% to +15% is the more striking movement and is subject to the same limitation.

**So the experiment did not settle the mechanism.** It is consistent with partial
leakage through `claimed` and equally consistent with chance.

What IS solid: the 95% CI on the residual correlation is 0.061 to 0.349, which
excludes zero. Promotional language tracks score whether or not `claimed` reaches
the scorer, and the target is near zero. That fails either way.

## Decision taken anyway: withhold `claimed` from the scorer

Adopted despite the inconclusive test, on grounds that do not depend on it.
`claimed` is recorded in the item's own framing "including its overstatement",
and the scorer is told to score against `demonstrated` and never against
`claimed`. Passing it hands the model rhetoric it is instructed not to use, which
is a channel that should not exist regardless of whether this sample can prove it
is being used. The only consumer that genuinely needs `claimed` is the
`gap_flagged` check, which runs in code and can read it directly.

Cost of being wrong: none identified. Benefit if the leakage is real: closes it.

## Where that leaves the residual

A correlation near 0.2 survives with every rhetorical channel this design knows
about closed. Two candidates remain, and distinguishing them needs a larger
sample than 170:

1. **A real property of scientific writing.** Papers with stronger results also
   write more promotionally, so any rubric that tracks result strength will
   correlate with markers. Under this reading the number is not drift and spec
   13's "near zero" target may be unattainable rather than unmet.
2. **Register carried in `demonstrated`.** It is extracted from the same
   promotional text and may inherit its emphasis even though it is meant to
   record only what the evidence supports.

Telling these apart needs roughly 800 to 1000 items for the confidence interval
to separate 0.05 from 0.20, or a paired probe that rewrites abstracts into
neutral register and rescores.

## Status

Phase 5 remains FAILED and blocking. Three runs, three failures, and the
diagnosis is now precise about what is known and what is not:

- recall at the top decile is poor (22%) on a confounded trial-heavy test
- rank discrimination sits at chance (45.7%) on that same confounded test
- promotional language tracks score at r ~= 0.2, robust to the one channel that
  could be closed cheaply, and not attributable to it with this sample size

The scores are now persisted, so the next diagnostic costs a query rather than a
full re-run.

---

# Run 4, 30 July 2026: the trial arm, deterministic. Passed, then did not.

`scripts/run-calibration-trials.js`. No model calls, no API cost. Rubric
`1.0-det`, stored under run label `retro-trials-det`.

The frozen holdout turned out to be trials end to end: all 24 reference items
and all 325 negatives sit in `news_feed` with a registry design block. So the
whole of spec 12 could be re-run for free against the deterministic scorer that
actually powers the Trials tab, using `scoreTrial()` itself rather than a copy.

Runs 1 to 3 are void regardless. They ran with the evidence multiplier pinned at
0.40 (the "primary anti-hype control" of spec 5.3, inert) and with unordered
pagination in `run-calibration.js`. Both were fixed afterwards, and neither fix
came from looking at a calibration result.

## The numbers, which look like a pass

```
holdout verified   reference 05f555607f1c284f (24), negative 90cefddd1ad255e3 (325)
2016 baseline      21 evidence records, 21 indications
peer pool          3,002 of 8,345 trials registered on or before 2019-12-31
scored             349 of 349
```

| Metric | Value | Reading |
|---|---|---|
| Rank-order AUC, P(reference > negative) | **0.824** over 7,800 pairs | well above chance |
| Recall at top decile | 10 of 24 — 41.7% | 4.15x lift, p = 2.1e-5 |
| Negative case: negatives in top decile | 25 of 325 — 7.7% | below the 10% chance gives |
| Median reference rank | 40 of 349 | 11th percentile |
| Scoring zero | 3 of 24 reference vs 207 of 325 negative | strong separation |
| Marker/impact correlation | 0 by construction | nothing on this path reads prose |

Recall reads low against spec 12's example ("all five that mattered plus fifteen
that did not") because the decile holds 35 slots for 24 reference items, so it is
structurally capped far below 1.0. The lift and the AUC are the readable numbers.

## Why it is not a pass

Two checks against the live corpus, run before flipping the flag:

**1. The head of the live sort is not neurotechnology.** 12 of the top 20 were
sedation drug comparisons, endometrial cancer surgery, intravitreal eye
injections, postpartum hemorrhage, semaglutide. The scorer ranks trial design
quality, and the best-designed trials in this corpus are well-funded pharma
trials the ingest swept in. Nothing is wrong with the ranking; it is ranking the
wrong population.

**2. The reference list is not neurotechnology either.** Only 5 of the 24
reference items name a neurotech modality in their intervention. The rest are a
prostate cancer radioligand, oxytocin for autism, risankizumab, Coenzyme Q10 for
Gulf War Illness, several intravitreal injections. The list was built
automatically from "trials that posted results", and that selected the same
well-resourced drug trials.

So the AUC is real and largely measures **which trials are well-resourced enough
to complete and report**. The confound named in spec 12 and in this document's
earlier runs is not a caveat on the result; it is most of the result.

## What would fix it

Gating the corpus to trials whose *intervention* names a neurotech modality
fixes the head of the sort immediately. Verified on the live set: the top twelve
become taVNS, tDCS, rTMS, VNS, spinal cord stimulation, a neurostimulation
device for insomnia. 3,834 of 8,345 trials survive that gate.

But the same gate leaves **5 reference items**, which cannot calibrate anything.
A five-item answer key supports no recall statistic worth reporting.

The blocker is therefore open decision 3: a reference list of trials that
mattered *to neurotechnology*, built by someone with domain knowledge. That is
not more code, and no amount of rescoring substitutes for it.

## State

`FLAGS.POTENTIAL_IMPACT` stays off. `FLAGS.POTENTIAL_IMPACT_ENTITIES` is
`['trial']`, so if the flag is enabled for inspection the sort appears only where
the corpus is fully scored. Research stays excluded on coverage: 600 of ~80,000
papers scored, 183 of those at zero.
