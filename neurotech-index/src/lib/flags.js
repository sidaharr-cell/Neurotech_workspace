/**
 * flags.js — build-time feature flags.
 *
 * Three separate gates, and the spec draws the lines between them deliberately:
 *
 *   POTENTIAL_IMPACT           may the sort be OFFERED at all
 *   POTENTIAL_IMPACT_ENTITIES  on WHICH tabs
 *   POTENTIAL_IMPACT_DEFAULT   may it be a tab's DEFAULT sort
 *
 * STILL OFF. Spec section 0: "ship behind a flag until Phase 5 (calibration)
 * passes." The trial arm posted passing numbers and they do not mean what they
 * appear to mean. See docs/potential-impact-phase5-result.md.
 *
 * scripts/run-calibration-trials.js scored the frozen holdout deterministically
 * and returned rank-order AUC 0.824, recall lift 4.15x at p = 2.1e-5, and
 * negatives under chance at 0.077. Then two checks against the live corpus
 * showed what was actually being measured:
 *
 *   - 12 of the top 20 live trials are not neurotechnology. The head of the
 *     sort was sedation drugs, endometrial cancer surgery and intravitreal
 *     eye injections, because the scorer ranks design quality and the
 *     best-designed trials in this corpus are well-funded pharma trials the
 *     ingest swept in.
 *   - Only 5 of the 24 reference items are neurotechnology either. The answer
 *     key was built from "trials that posted results", which selected the same
 *     well-resourced drug trials: a prostate cancer radioligand, oxytocin for
 *     autism, risankizumab, Coenzyme Q10 for Gulf War Illness.
 *
 * So the AUC is real and largely measures which trials are well-resourced
 * enough to complete and report. Gating the corpus to trials whose intervention
 * names a neurotech modality fixes the head of the sort (verified: taVNS, tDCS,
 * rTMS, VNS, SCS) but leaves 5 reference items, which cannot calibrate anything.
 * Turning this on needs a reference list built for neurotechnology, which is
 * open decision 3 and needs a domain expert rather than more code.
 *
 * Research is separately excluded for coverage: 600 of ~80,000 papers are
 * scored and 183 of those score zero. Devices, because only 6 of 525 carry a
 * description long enough to extract from.
 *
 * Set VITE_FLAG_POTENTIAL_IMPACT=1 to offer the sort for inspection. The
 * ENTITIES list and DEFAULT are deliberately NOT read from the environment:
 * widening either is a decision that should go through review rather than
 * through a deploy config.
 */

const on = v => v === '1' || v === 'true'

export const FLAGS = {
  /** Offer "Highest potential impact" as a sort option. */
  POTENTIAL_IMPACT: on(import.meta.env?.VITE_FLAG_POTENTIAL_IMPACT),

  /**
   * Entity types whose tab may offer the sort. An entity belongs here once its
   * corpus is scored densely enough that the ordering is real, and not before.
   * Adding 'research' is the deliverable of scoring the paper corpus.
   */
  POTENTIAL_IMPACT_ENTITIES: ['trial'],

  /**
   * Make it the default sort. HARD-CODED FALSE.
   * Flipping this is the moment the spec's section 10 migration becomes due:
   * remove the legacy sort, resolve saved views, and rescore the corpus under
   * the current rubric version. Passing Phase 5 permits the sort to be offered;
   * it does not on its own justify replacing what every existing user sees.
   */
  POTENTIAL_IMPACT_DEFAULT: false,

  /** The internal inspection view, spec 9.3. Available whenever the sort is. */
  IMPACT_INSPECTOR: on(import.meta.env?.VITE_FLAG_POTENTIAL_IMPACT),
}

/** May this tab offer the potential-impact sort? */
export const impactSortAllowed = entityType =>
  FLAGS.POTENTIAL_IMPACT && FLAGS.POTENTIAL_IMPACT_ENTITIES.includes(entityType)

export const isFlagged = name => !!FLAGS[name]
