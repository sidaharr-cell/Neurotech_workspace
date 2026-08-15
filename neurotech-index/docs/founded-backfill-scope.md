# Scope: a sourced incorporation year for funded companies

**Status: scoped 15 Aug 2026, not built. Coverage measured against live EDGAR.**

## What this unblocks

The capital-versus-stage scatter reports a Spearman rho within its clinical band
and cannot say whether company age explains it. Older companies have had more
time both to raise capital and to advance a trial, so age is the obvious
confounder, and today it cannot be tested: of the 45 companies on that figure,
**9 have a `founded` value and 36 are null**, and the 9 span only 2014-2021.

The request that prompted this was to size the dots by age. That is the wrong
first move and the reason is in the numbers below, but the data question is the
same either way.

## The source

**SEC Form D, `<yearOfInc>`.** Every Form D issuer declares its year of
incorporation or organisation on the filing itself:

```xml
<yearOfInc>
  <withinFiveYears>true</withinFiveYears>
  <value>2014</value>
</yearOfInc>
```

An issuer incorporated more than five years before the filing declares only
that, with no year:

```xml
<yearOfInc><overFiveYears>true</overFiveYears></yearOfInc>
```

**This document is already downloaded on every funding run.**
`backfill-funding.js:106` fetches `filingDocUrl(cik, adsh)` and hands it to
`parseFilingXml`, which today picks two amount fields out of it and drops the
rest. Adding `yearOfInc` to that parse costs no additional request, so every
company ingested from here on carries the year for free. Only the historical
sweep needs its own pass.

## Measured coverage

Probed against live EDGAR on 15 Aug 2026: for each company, its earliest Form D
filings in date order, stopping at the first that declares a year.

| set | n | exact year | bound only | nothing |
|---|---|---|---|---|
| companies with a sourced total and a CIK | 204 | **149 (73%)** | 54 (26%) | 1 |
| companies on the scatter | 45 | **29 (64%)** | 16 (36%) | 0 |

Zero fetch failures on 204 companies. Exact years run 2005-2023, median 2014,
so ages 3 to 21 — against 2014-2021 for the nine values stored today.

Two things the probe found that matter more than the headline number.

**The missingness is biased, not random.** A company declares "over five years
ago" precisely *because* it is old. The 26% with no exact year are systematically
the oldest companies in the set, which is exactly the tail that a test for
age-as-confounder depends on. Any encoding that drops them understates the effect
it is looking for.

**The existing `founded` values disagree with the filings.** Four of the nine
overlapping values conflict: Motif Neurotech 2021→2022, Cala Health 2014→2013,
Neurable 2015→2016, and Saluda Medical **2013→2023**. That column has no
`source_url`, no `retrieved_at`, and nothing recording where it came from, so
there is no way to adjudicate a conflict against it. Saluda is the instructive
one: a ten-year gap is not an error, it is a redomiciliation, which is the whole
reason the next section exists.

## Incorporation is not founding

Form D reports **year of incorporation or organisation**. That is not the same
fact as when a company was founded, and the difference is not noise:

- a company can operate for years before it incorporates;
- reincorporating, or redomiciling into the US, resets the declared year while
  the company is unchanged (Saluda);
- a US holding company formed over an existing foreign business declares the
  holding company's year.

So this must be stored and labelled as **incorporation year**, with the filing
behind it, and must not be written into a field a reader will see as "Founded".
Calling it founding would be fabricating a fact the source does not assert,
which the never-fabricate rule forbids whether or not the number is close.

Form D is also US-only. Foreign issuers have no filing and get nothing here,
consistent with the funding board's existing `foreign_issuer_not_covered`.

## Proposed shape

**New columns, not `founded`.** The existing column is `text`, unsourced, and
wrong in four of the nine cases we can check. Overwriting it would destroy the
only record of the disagreement and would still leave a field whose provenance
nobody can state.

```sql
-- migration 0NN
alter table organizations
  add column incorporated_year          int,          -- exact, from the filing
  add column incorporated_before_year   int,          -- bound: "no later than"
  add column incorporated_source_url    text,
  add column incorporated_retrieved_at  timestamptz;
```

Exactly one of the two year columns is ever set. A bound is a real finding and
is stored as one rather than being rounded into a false exact value or thrown
away. `founded` is left alone until someone decides what it was.

**`scripts/backfill-incorporation.js`**, following the house pattern: dry-run by
default, `--commit` to write, upserting only the four columns it owns and never
deleting a row (the write invariant, and the reason
`docs/funding-data-loss-2026-07-29.md` exists). Per company: one submissions
request plus at most two document requests, ~450 requests for the full set at
the existing 120ms spacing, about two minutes end to end, inside SEC's limits
with the pipeline's existing User-Agent.

**`yearOfInc` parsing moves into `parseFilingXml`** in `scripts/lib/funding.js`,
so the nightly run picks it up at no cost. That function is pure and already has
`funding.test.js` beside it; the parser needs fixture tests for all four shapes
(exact, over-five, yet-to-be-formed, absent). The probe that produced the table
above initially read **27 of 45 as "no year"** because it matched the first
`<value>` in the document rather than the one inside the `<yearOfInc>` block —
a bug in the scoping script, not a fact about the data, and the reason the parse
belongs in a tested pure function rather than inline.

Effort: one migration, ~150 lines of script, parser plus tests. Half a day.

## Whether it is enough to size the dots by age

**Not yet, and possibly never in that form.**

At 64% exact on the plotted set, a size channel would leave a third of the points
with no size — the same dead channel that was just removed from this figure,
where 27 of 45 points sat at a floor radius and the legend's claim was false for
most of the chart. That it would now be 16 rather than 27 does not change the
kind of mistake, and the biased missingness makes it worse: the points without a
size would be the oldest companies.

Two better moves, in order.

1. **Answer the question with a number, not a channel.** With 29 exact years on
   the scatter, compute the partial Spearman between capital and stage
   controlling for incorporation year, and report it in the caption beside the
   rho that is already there. That is what the rest of this figure's caption
   does, and it answers "is age driving this" directly rather than asking a
   reader to infer it from circle areas.
2. **If a visual encoding is still wanted, bin it.** A bound resolves cleanly
   into a coarse band: "incorporated no later than 2014" is unambiguously in an
   "over 12 years" bucket. Binning into three age bands may lift effective
   coverage well above 73%. **Measure that before building it** — the fraction
   of bounds that fall unambiguously inside a band was not probed here, and it
   is the number that decides whether the encoding is honest.

## What not to do

Do not write Form D's year into `founded`. Do not fill the 26% by inference from
first-filing date, incorporation state, or anything else that is not the
company's own declaration. Do not size the dots by age on 64% coverage: an
encoding that is false for a third of the marks is the defect this figure was
just rebuilt to remove.

---

# Measured 15 Aug 2026: does age confound the capital/stage relationship?

Run before building anything, on the 29 plotted companies whose incorporation
year Form D states exactly. Incorporation year stands in for age, with the
caveat above that the two are not the same fact.

Spearman throughout, on average ranks so the heavy ties at `first_in_human` are
handled. Intervals are Fisher z; the partial spends one extra degree of freedom.

## The clinical band, which is the only band where the question can be asked

Every company in the authorisation band sits at `510(k) cleared`, so stage has no
variance there and a capital-versus-stage correlation does not exist to be
adjusted. 12 of that band's 19 companies have an exact year.

| | n | rho | 95% CI |
|---|---|---|---|
| capital vs stage, whole band | 19 | 0.328 | [-0.15, 0.68] |
| capital vs stage, the 12 with a year | 12 | 0.301 | [-0.33, 0.75] |
| capital vs age | 12 | **0.078** | [-0.52, 0.62] |
| stage vs age | 12 | 0.317 | [-0.31, 0.75] |
| **capital vs stage, controlling for age** | 12 | **0.292** | [-0.37, 0.76] |

**Controlling for age moves the correlation by -0.009.** The mechanism is
visible in the rows above it: a confounder has to correlate with both variables,
and age correlates with stage (0.317, older companies are further along, as one
would expect) but not with capital (0.078). So it cannot be carrying the
capital-stage relationship.

The 12 are not a biased draw on the thing being adjusted: the band's rho is 0.328
across all 19 and 0.301 across the 12, so the subset is representative of the
relationship itself.

## Why this does not go in the caption

**n = 12, and every interval above crosses zero by a wide margin.**
`funding-stage-scatter-finding.md` already settled what to do with a result like
this, when the same figure sat at n=18: *a wide confidence interval around zero
is ignorance, not a finding, and shipping it as one would have been the exact
failure the brief warns about.* A partial rho of 0.292 with an interval of
[-0.37, 0.76] is that same non-finding. Printing it beside the existing rho would
dress ignorance up as a control.

There is a second reason, and it is the one from the scope above. The companies
missing an exact year are systematically the oldest, so the 12 span a truncated
age range, and a restricted range attenuates exactly the capital-versus-age
correlation this rests on. The weakest link in the argument is weakest precisely
where the missing data is.

So: **no evidence that age confounds it, on evidence too thin to clear it.** The
honest state is that the question is open, which is where it stays until the
backfill lifts the clinical band's coverage.

## Two other things the run turned up

The caption's `rho 0.35 across 19 companies` now measures **0.328** on the same
band. The caption is dated "Measured 29 July 2026" so it is not wrong, but the
underlying set has moved and the number should be re-measured whenever that
sentence is next touched.

Among the 17 authorisation-band companies with a year, capital versus age is
**-0.276** [-0.67, 0.24]: older 510(k) companies have raised slightly less, on an
interval that crosses zero. Consistent with the pathway being cheap and crowded
with small firms, and not evidence of anything on its own.
