# Phase 5: the capital-versus-stage scatter is not shippable yet

**Status: not built. The data does not support the claim the chart exists to make.**

The Phase 5 brief says:

> The claim this chart supports is that capital and clinical maturity are only
> loosely coupled in neurotech. Confirm that the actual data shows this before
> shipping it. If the data does not support the claim, report that instead of
> adjusting the chart to produce it.

This is that report.

## What was measured

Every company that would appear on the scatter: a sourced `total_raised_usd`, an
`inclusion_basis`, and a `furthest_stage` whose `stage_evidence_type` is not
`none`. Spearman rank correlation between total raised and stage rank, using the
`stage_rank()` ordering from migration 008.

Rank correlation rather than Pearson because funding totals span three orders of
magnitude and the stage axis is ordinal, so a linear fit would describe the
skew rather than the relationship.

| | n | Spearman rho | 95% CI | rho² |
|---|---|---|---|---|
| Before writing more inclusion decisions | 18 | 0.048 | wide | 0.002 |
| After (current) | 44 | **-0.283** | [-0.53, 0.02] | 0.080 |

## The finding

At n=18 the correlation was indistinguishable from zero, which looks like
support for "loosely coupled". It was not support for anything: 18 points, four
populated stage levels, and one level holding a single company cannot establish
a null result. A wide confidence interval around zero is ignorance, not a
finding, and shipping it as one would have been the exact failure the brief
warns about.

At n=44 a weak **negative** relationship appears, borderline at conventional
thresholds (t = -1.91). Companies further up the stage ladder have raised
somewhat *less*, which is neither the claim nor its opposite in any interesting
sense. It is an artifact of the axis.

## Why the axis produces it

`furthest_stage` orders two different things on one ladder:

- a **clinical trial stage** — `first_in_human`, `feasibility`, `pivotal`
- an **FDA market authorization** — `cleared_510k`, `de_novo_granted`, `approved_pma`

`stage_rank()` places `cleared_510k` (6) above `pivotal` (4), so a company with a
cleared moderate-risk device outranks one running a pivotal trial. For a
regulatory-progress axis that is defensible. For a *clinical maturity* axis it is
a category error, because the two sit on different regulatory routes and a
510(k) is not a later stage of a pivotal trial.

The distribution is what turns that into a spurious correlation:

| stage | n | median raised |
|---|---|---|
| first_in_human | 11 | $105M |
| feasibility | 3 | $43M |
| pivotal | 4 | $259M |
| cleared_510k | **26** | **$20M** |

26 of 44 companies sit in `cleared_510k` with a median of $20M. The 510(k)
pathway is the cheap route, taken by small companies with moderate-risk devices,
so the top of the ladder is populated by the least-funded companies in the set.
The negative rho is measuring that, not anything about capital and maturity.

Note also that `preclinical`, `ce_marked` and `commercial` are never derived
(see `scripts/lib/stage.js`), so the ladder is missing both ends. Nothing in the
ingested sources supports them.

## What would make this shippable

1. **Split the axis.** Plot clinical stage and regulatory authorization
   separately, or restrict the scatter to one pathway. Comparing capital across
   companies on the same route is a real question; comparing across routes is
   not.
2. **More points.** 44 is thin for a scatter with colour and size channels. The
   ceiling today is 46: only 90 companies have an evidence-backed stage and 205
   a sourced total. Stage coverage is the binding constraint, and it is limited
   by device records and trial links, not by classification work.
3. **Re-test after either.** The measurement above is a script that takes about
   a minute to re-run; do not ship on the assumption that more data will move it.

## What not to do

Do not drop `cleared_510k` to recover the null result, and do not switch to a
log X axis because it makes the cloud look less structured. Both would be
adjusting the chart to produce the claim.
