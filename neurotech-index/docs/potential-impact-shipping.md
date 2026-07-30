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

- **Research and trials only.** A recent slice was scored, not the whole corpus.
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
