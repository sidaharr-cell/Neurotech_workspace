/**
 * stage.js — deriving how far a company's technology has actually got.
 *
 * `furthest_stage` must be traceable to a record, never inferred from a company
 * description. A company that says it is "advancing toward pivotal trials" has
 * not run one. So every value this module produces comes with the identifier of
 * the document it came from: an NCT number or an FDA submission number.
 *
 * What is deliberately NOT derived here:
 *
 *   commercial   No public dataset says a device is being sold. FDA clearance is
 *                permission to market, not evidence of marketing. Needs a
 *                company release, so it stays null.
 *   ce_marked    The EU database is not ingested. A US clearance says nothing
 *                about CE marking.
 *   withdrawn    Requires a recall or withdrawal record, which is a different
 *                openFDA endpoint and a different claim from "has not advanced".
 *   preclinical  Unfalsifiable from these sources. The absence of a trial is not
 *                evidence of preclinical work; it is absence of evidence.
 */

/**
 * Mirrors stage_rank() in supabase/migrations/008-funding.sql. If you change one,
 * change both. `withdrawn` sits at 99 there so it sorts last in a range filter;
 * it is excluded from the furthest-stage maximum below rather than treated as
 * the most advanced state.
 */
export const STAGE_RANK = {
  preclinical: 1,
  first_in_human: 2,
  feasibility: 3,
  pivotal: 4,
  de_novo_granted: 5,
  cleared_510k: 6,
  approved_pma: 7,
  ce_marked: 8,
  commercial: 9,
  withdrawn: 99,
}

/**
 * A stage from a ClinicalTrials.gov study record.
 *
 * Drug-style phases map straight across. Device studies register with a phase of
 * "NA", because the phase vocabulary is a drug concept, so the signal there is
 * `primaryPurpose`: CT.gov has an explicit DEVICE_FEASIBILITY value.
 *
 * An interventional study with no phase and no feasibility marker still proves
 * one thing, that the technology has been in humans, so it floors at
 * first_in_human. It is not read as pivotal, because nothing in the record says
 * so, and guessing upward is how a chart ends up claiming a company is further
 * along than it is.
 *
 * An observational study proves nothing about the sponsor's own technology and
 * yields no stage at all.
 */
export function stageFromTrial({ studyType, phases = [], primaryPurpose } = {}) {
  if (String(studyType).toUpperCase() !== 'INTERVENTIONAL') return null
  const p = phases.map(x => String(x).toUpperCase())
  if (p.includes('PHASE3') || p.includes('PHASE4')) return 'pivotal'
  if (p.includes('PHASE2')) return 'feasibility'
  if (p.includes('PHASE1') || p.includes('EARLY_PHASE1')) return 'first_in_human'
  if (String(primaryPurpose).toUpperCase() === 'DEVICE_FEASIBILITY') return 'feasibility'
  return 'first_in_human'
}

/**
 * A stage from an FDA regulatory decision. The pathway IS the stage: a 510(k)
 * number means the device was cleared, and nothing softer needs inferring.
 * An unrecognised pathway returns null rather than a guess.
 */
export function stageFromPathway(pathway) {
  const p = String(pathway || '').toLowerCase()
  if (p.includes('de novo')) return 'de_novo_granted'
  if (p.includes('510')) return 'cleared_510k'
  if (p.includes('pma')) return 'approved_pma'
  return null   // HDE, Breakthrough designation, and anything unrecognised
}

/**
 * The furthest stage across every piece of evidence, with the evidence that
 * supports it. Returns null when there is nothing to support any stage, which is
 * a legitimate answer and renders as no badge.
 *
 * `withdrawn` is never selected by this function. It ranks last in SQL for
 * sorting, and treating it as the maximum here would make a withdrawn product
 * look like the most advanced one on the chart.
 *
 * @param {Array<{stage:string, evidenceType:string, evidenceId:string, sourceUrl?:string, date?:string}>} evidence
 */
export function furthestStage(evidence = []) {
  const usable = evidence.filter(e => e?.stage && e.stage !== 'withdrawn' && e.evidenceId)
  if (!usable.length) return null
  return usable.reduce((best, e) =>
    (STAGE_RANK[e.stage] || 0) > (STAGE_RANK[best.stage] || 0) ? e : best)
}
