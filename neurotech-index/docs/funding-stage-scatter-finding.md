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

Do not drop `cleared_510k` to recover the null result. That would be adjusting
the chart to produce the claim.

The original version of this section also said not to switch to a log X axis,
for the same reason. **Amended 15 Aug 2026: the axis is now log.** The rule was
aimed at a motive — reaching for a transform *because it makes the cloud look
less structured* — and it is worth separating that from the mechanics, because
the mechanics say the transform cannot do what the rule feared. The number this
page reports is a Spearman correlation, computed on ranks. A log axis is
monotonic. It therefore moves rho by exactly zero, and `src/lib/swarm.test.js`
asserts the rank order survives the scale. What it changes is only whether a
reader can see the points, which the measurements below say they could not.

The prohibition stands for anything that *does* touch the measurement: dropping
a stage, dropping outliers, fitting a line through the two bands together, or
re-running the correlation on the transformed values as if it were a new finding.

## Rebuilt 15 Aug 2026

The statistics were sound and the picture was not. Measured on the live figure
before the change:

| | before | after |
|---|---|---|
| points inside the leftmost tenth of the plot | **34 of 45** | 0 |
| median company's position across the plot width | **3.4%** | 63% |
| overlapping pairs of points | **46** | **0** |
| distinct point radii | 2 (a floor and a scale) | 1 |

Four changes, in `src/components/CapitalStageScatter.jsx` and the pure geometry
in `src/lib/swarm.js`:

1. **Log X.** The set spans $393K to $1.2B, 3.5 decades, so a linear axis spent
   three quarters of its width on one company and squashed everything under
   $60M into a 64px smear. Gridlines are decades.
2. **Beeswarm instead of index jitter.** The old `((i % 5) - 2) * 4.4` chose an
   offset from a company's position in the array rather than from where its
   neighbours landed, which is why 46 pairs overlapped. Rows now grow to fit
   their swarm.
3. **Each row carries its own n and median.** The four medians in the table
   above are the finding; the reader was being asked to estimate them from a
   cloud. Computed from the plotted set, so they cannot go stale.
4. **Size no longer encodes trailing capital.** It was a dead channel — 27 of 45
   points sat at the floor radius, having had no round in the window, so the
   legend's "point size is capital raised in the last 24 months" was false for
   most of the chart and the floor made "no round" identical to "a rounding
   error". The scale also did not do what its comment claimed: with the additive
   floor, a company at a quarter of the maximum drew at 2.3x the area rather
   than 4x. Recency is now the binary it always was in the data, filled against
   hollow.

Two things the figure now says that it could not before. A private-only total on
a company that also raised publicly is drawn as a floor, with an arrow pointing
the way the true figure lies — the bar chart above daggered these and the scatter
had shown them as ordinary points. And the figure answers the modality, status
and stage controls above it, which it had been sitting underneath and ignoring:
narrowing to implanted BCI takes it from 45 points to 7. The status default now
matches its neighbour's as well, though no acquired or defunct company currently
has an evidence-backed stage, so that one closes a gap rather than a live error.
