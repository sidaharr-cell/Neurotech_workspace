# Phase 5: the capital-versus-stage scatter

**Status: shipped 29 Jul 2026, with a banded axis. The data does not support the
claim the chart was commissioned to make, and the chart says so.**

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

## What shipped

`src/components/CapitalStageScatter.jsx`, with the axis **banded** rather than
ordered end to end. Clinical evidence (`first_in_human` → `feasibility` →
`pivotal`) and FDA authorisation (`de_novo_granted` → `cleared_510k` →
`approved_pma`) are drawn as two separate groups with a rule between them.
Position is comparable within a band and meaningless across it, and the caption
says exactly that.

Everything else follows the original brief: linear X on total raised, colour by
modality, point area by trailing 24-month capital, hover naming both axis values,
click through to the organization, and only records whose `stage_evidence_type`
is not `none`.

After the 131 outstanding inclusion decisions were written on 29 Jul, the set
reached 45 companies and the split measurement became clear:

| slice | n | Spearman rho | 95% CI |
|---|---|---|---|
| both bands on one axis | 45 | -0.210 | [-0.47, 0.09] |
| clinical band only | 19 | **+0.354** | [-0.12, 0.70] |
| authorisation band only | 26 | undefined | all 26 sit at `cleared_510k` |

The sign flips once the pathways are separated, which is the clearest possible
demonstration that the -0.21 was the axis and not the field. The authorisation
band has no variance at all to correlate against.

So the honest reading, and the one the chart's caption carries: within the
clinical path capital and maturity are weakly and positively related, on a sample
too small to call; in the authorisation band the question cannot be asked yet.

## What would still improve it

**More points, specifically more stages.** Stage coverage is the binding
constraint, not classification: 205 companies have a sourced total and 113 an
inclusion decision, but only 90 have an evidence-backed stage, and the
intersection is 45. That is limited by device records and trial links.

Re-run the measurement rather than assuming more data moved it. It takes about a
minute.

## What not to do

Do not drop `cleared_510k` to recover the null result, and do not switch to a
log X axis because it makes the cloud look less structured. Both would be
adjusting the chart to produce the claim.
