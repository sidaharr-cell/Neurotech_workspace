/**
 * flags.js — build-time feature flags.
 *
 * POTENTIAL IMPACT IS FLAGGED OFF BY DEFAULT, and that is a spec requirement
 * rather than caution. Spec section 0: "Ship behind a flag until Phase 5
 * (calibration) passes." Phase 5 has not passed; see
 * docs/potential-impact-phase5-result.md for the three runs and their results.
 *
 * Two separate gates, and the spec draws the line between them deliberately:
 *
 *   POTENTIAL_IMPACT          may the sort be OFFERED at all
 *   POTENTIAL_IMPACT_DEFAULT  may it be a tab's DEFAULT sort
 *
 * Phase 5 blocks the second, not the first: "Do not ship as a default sort until
 * this passes." So the sort can be shipped and inspected while the legacy sort
 * stays in place, which is exactly the state this build is in.
 *
 * Turning the default on before calibration passes would put an unvalidated
 * ordering in front of every user, and the calibration says plainly that we do
 * not yet know it orders better than what it replaces.
 *
 * Set VITE_FLAG_POTENTIAL_IMPACT=1 to offer the sort.
 * VITE_FLAG_POTENTIAL_IMPACT_DEFAULT is deliberately NOT read from the
 * environment: making it a default requires editing this file, which forces the
 * change through review rather than through a dashboard setting.
 */

const on = v => v === '1' || v === 'true'

export const FLAGS = {
  /** Offer "Highest potential impact" as a sort option. */
  POTENTIAL_IMPACT: on(import.meta.env?.VITE_FLAG_POTENTIAL_IMPACT),

  /**
   * Make it the default sort. HARD-CODED FALSE until Phase 5 passes.
   * Flipping this is the moment the spec's section 10 migration becomes due:
   * remove the legacy sort, resolve saved views, and rescore the corpus under
   * the current rubric version.
   */
  POTENTIAL_IMPACT_DEFAULT: false,

  /** The internal inspection view, spec 9.3. Available whenever the sort is. */
  IMPACT_INSPECTOR: on(import.meta.env?.VITE_FLAG_POTENTIAL_IMPACT),
}

export const isFlagged = name => !!FLAGS[name]
