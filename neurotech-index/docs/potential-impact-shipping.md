# Potential Impact: what shipped, and what to check before turning it on

Shipped to `main` 29 July 2026. **The sort is OFF in production.** Nothing about
the live site changes until someone sets an environment variable.

---

## Why it is off

Spec section 0: *"Ship behind a flag until Phase 5 (calibration) passes."*
Spec section 11, Phase 5: *"Blocking. Do not ship as a default sort until this
passes."*

Phase 5 has not passed. Three runs, three failures, recorded in
[potential-impact-phase5-result.md](potential-impact-phase5-result.md). The code
is complete and verified; the *ordering* is not yet demonstrated to be better
than what it would replace. Those are different claims and only the first is
supported.

## Two switches, deliberately different

| Flag | Where | Effect |
|---|---|---|
| `VITE_FLAG_POTENTIAL_IMPACT` | environment | Offers the sort as an option, and enables the inspection view |
| `POTENTIAL_IMPACT_DEFAULT` | `src/lib/flags.js`, hard-coded `false` | Makes it a tab's default |

The second is not readable from the environment on purpose. A default sort
reaches every visitor, so changing it should require a code edit and a review,
not a dashboard toggle. A test asserts it stays `false`.

Turning the default on is also the moment spec section 10's migration falls due:
remove the legacy sort with no dual display, resolve saved views and permalinks,
and rescore the corpus under the current rubric version. None of that has been
done, and none of it should be until calibration passes.

## To try it

Set `VITE_FLAG_POTENTIAL_IMPACT=1` in the Vercel environment and redeploy, or add
it to a local `.env` and run `npm run dev`. "Highest potential impact" then
appears **last** in the sort list on Research and Trials.

Inspect any scored item at `/impact/<item_type>/<item_id>`, for example
`/impact/news_feed/<uuid>`. That page is the only place the rubric is visible.

## What to look at before flipping it

1. **Open the inspection view on five or six items you know well.** Everything
   turns on whether the referents and consulted records make sense to someone who
   knows the field. That view exists precisely because the numbers are hidden
   from users, and it caught a systemic bug within minutes of first being opened.
2. **Check the marker/impact correlation** via `getImpactMonitoring`. Spec 13
   calls it "the single most important number here" and wants it near zero. It
   measured about 0.2 in the retro runs and its cause is not yet established.
3. **Look at what ranks top and ask whether you would defend it.** That is the
   judgement the calibration could not supply.

## Coverage, and what is deliberately absent

**676 items are scored.** The intended slice was ~1,600. The scoring run
exhausted the Anthropic API credit balance partway through, and a 400 for
insufficient credit is not retryable, so the remainder failed immediately.

The shortfall is NOT random. Extraction rows are read in whatever order Postgres
returns them, research came first, and credits ran out before trials were
reached:

| entity | extracted | scored |
|---|---|---|
| research | 763 | 600 |
| feed | 84 | 51 |
| trial | 761 | **20** |
| device | 9 | 9 |

So the sort is usable on Research and effectively empty on Trials. Topping the
trials up needs credit and a re-run of `score-items.js`; extraction is already
stored, so only the scoring half has to be paid for again.

- **Research is the only well-covered tab.** A recent slice, not the whole corpus.
- **Devices are excluded on purpose.** Only 6 of 525 in-scope devices from 2020 or
  later carry a description longer than 120 characters; openFDA stores one-line
  product-code sentences. Under the granularity caps that is metadata tier, which
  pins FD and METH at 0, so a device could rank only on leverage inferred from a
  single sentence. That is noise, not a ranking. Devices keep their date sort.
  Doing it properly means joining `regulatory_records` into the device's
  scoreable text, since spec 5.1.4 routes regulatory status through leverage.
- **Unscored items do not appear in the sort at all**, and the tail is not padded
  with them. An item the system has never evaluated does not belong in its
  ranking.

## Open, in the order I would take them

1. **Establish what drives the marker correlation.** Needs roughly 800 to 1000
   items to separate 0.05 from 0.20, or a paired probe that rewrites abstracts
   into neutral register and rescores. Do not tune weights against it; two of the
   three calibration tests are confounded and fitting to them would optimise for
   the confound.
2. **Open decision 3 is still open.** A domain expert building the reference list
   blind to the scores is the single largest lever on whether calibration means
   anything. The current list is an institutional-trace proxy and says so.
3. **FD 4 reaches only 4 of 13 subfields**, because the other nine have no
   curated axis pair. Uncurated, not broken.
4. **Score more of the corpus** once the rubric is settled. Rescoring after a
   rubric change is cheap on extraction, which is stored separately, and
   expensive on scoring.

## Evidence that the evidence multiplier now works

The run before this one had `evidence_grade` as free text, so nearly every value
fell through to the harshest 0.40 default and spec 5.3's "primary anti-hype
control" was a near-constant. After constraining it to an enum:

```
distinct multipliers   0, 0.4, 0.5, 0.65, 0.75, 1.0   (was effectively 0.4 only)
grades                 124 demonstrated, 200 partial, 282 claimed-only,
                       13 announced-only, 3 indicative, 2 exploratory,
                       2 contradicted (gated to zero)
impact range           0.000 to 5.669                 (was 0.000 to 0.960)
marker correlation     0.007                          (was about 0.2)
```

The marker/impact correlation is the number spec 13 calls "the single most
important here" and wants near zero. At 0.007 on 676 live items it is far closer
to the target than any retro run managed. That is a genuine improvement and NOT a
substitute for calibration: it says promotional language does not predict score,
not that the ordering is right.

50 items carry a null grade, meaning the model returned something unreadable and
`normalizeGrade` refused to guess. Those take the conservative 0.40 rather than
being scored as though they were well evidenced.

## What is verified

- All 43 section 8 adversarial cases pass, written from the spec before the
  validators existed.
- No dimension score above 0 survives without a referent, checked on stored data.
- Browser-verified at 1440x900: the option renders last, the default is unchanged,
  and a DOM scan for dimension codes, rubric vocabulary and numeric scores finds
  nothing. `potential_impact` is stripped at the data layer so a component cannot
  render it by accident.
- Tests, lint and build pass.

## What is not verified

That the ordering is good. That is what Phase 5 was for, and it failed.

---

# Status as of 30 July 2026: an internal tool, deliberately

The decision is to leave the sort off and use it as an inspection tool rather
than pursue the reference list right now. This is a real status, not a holding
pattern, so here is how to use it and what it is good for.

## Turning it on locally

```
VITE_FLAG_POTENTIAL_IMPACT=1   # in neurotech-index/.env
npm run dev
```

That enables three things: the "Highest potential impact" sort option on the
Trials tab, the horizon toggle, and the inspection view. `FLAGS.POTENTIAL_IMPACT`
reads the environment; `POTENTIAL_IMPACT_ENTITIES` and `POTENTIAL_IMPACT_DEFAULT`
do not, so no environment variable can widen the sort to Research or make it a
tab's default. Production has no such variable set.

## The inspection view

`/impact/:itemType/:itemId`, where itemType is `news_feed` or `papers`. It shows
the full record for one score: composition, every dimension with its
justification and referent, what was capped and why, the frontier records
consulted, the claim-against-demonstration pair, and every section 8 validator
reset. It is the only place rubric vocabulary is allowed to appear.

Both scoring paths render: model rows show the model and its written reason,
deterministic rows (`rubric_version` `1.0-det`, all trials) say so and show the
registry-built sentence instead.

## What it is actually good for right now

Reading *why* one trial outranks another, on real records, without spending
anything. Every trial in the corpus is scored, so any two can be compared.

## What it is not good for

Deciding whether the ordering is correct. The head of the ungated live sort is
mostly not neurotechnology, and the frozen reference list is mostly not
neurotechnology either. See `potential-impact-phase5-result.md`, run 4.

## Free to re-run at any time

```
node --env-file=.env scripts/score-trials-deterministic.js --commit   # rescore all 8,345
node --env-file=.env scripts/run-calibration-trials.js                # re-measure the holdout
```

Neither makes a model call. If the rubric changes, both should be re-run.

## The one thing that would change the status

A reference list of 20 to 30 trials from 2016-2019 that mattered *to
neurotechnology*, built by someone with domain knowledge. Drop the NCT ids or
titles into a file and `scripts/build-retro-holdout.js` plus
`run-calibration-trials.js` will do the rest for free. Nothing else on the
critical path costs money either; this is the only step that costs judgement.
