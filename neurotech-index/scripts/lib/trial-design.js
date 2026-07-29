/**
 * trial-design.js — the design and endpoint facts a trial registration states.
 *
 * WHY THIS EXISTS. Potential-impact scoring needs two things from a trial that
 * NeuroBase was not storing:
 *
 *   METH 3 and 4 (spec 5.2.3) turn on the trial's ENDPOINTS. METH 3 is
 *   "establishes an endpoint or trial design likely to become standard"; METH 4
 *   is a methodological question resolved across subfields, whose worked example
 *   is "a validated sham control for a modality that lacked one". Neither is
 *   assessable without the outcome measures and the arm types.
 *
 *   The design-quality grade (spec 5.3.2) separates `decisive` from `strong` on
 *   whether a primary endpoint was PRE-SPECIFIED and powered, and requires the
 *   interpretable-null condition explicitly. Registration date and endpoint
 *   detail are what evidence that.
 *
 * Both live in the ClinicalTrials.gov record already. This reads them; nothing
 * here infers or scores. Fields absent from a registration stay absent rather
 * than defaulting to something flattering.
 *
 * Shared by scripts/trials.js (nightly ingest) and
 * scripts/backfill-trial-endpoints.js (the one-off over already-indexed trials)
 * so the two cannot drift apart.
 */

/** Arm types that constitute a real control, per the registry's own vocabulary. */
export const CONTROL_ARM_TYPES = ['SHAM_COMPARATOR', 'PLACEBO_COMPARATOR', 'ACTIVE_COMPARATOR', 'NO_INTERVENTION']

const clean = s => String(s || '').replace(/\s+/g, ' ').trim()

/** One outcome measure, trimmed to what scoring reads. */
const outcome = o => ({
  measure: clean(o?.measure).slice(0, 400),
  description: clean(o?.description).slice(0, 800) || null,
  timeFrame: clean(o?.timeFrame).slice(0, 200) || null,
})

/**
 * The design block for a ClinicalTrials.gov study record, ready to merge into
 * news_feed.metadata. Returns only what the registration states.
 */
export function trialDesign(study) {
  const p = study?.protocolSection || {}
  const dm = p.designModule || {}
  const info = dm.designInfo || {}
  const om = p.outcomesModule || {}
  const arms = p.armsInterventionsModule?.armGroups || []

  const primaryOutcomes = (om.primaryOutcomes || []).map(outcome).filter(o => o.measure)
  const secondaryOutcomes = (om.secondaryOutcomes || []).map(outcome).filter(o => o.measure)
  const armTypes = arms.map(a => a.type).filter(Boolean)

  return {
    studyType: dm.studyType || null,
    allocation: info.allocation || null,
    interventionModel: info.interventionModel || null,
    primaryPurpose: info.primaryPurpose || null,
    masking: info.maskingInfo?.masking || null,
    // Who was masked separates a nominally double-blind trial from one where
    // only the outcomes assessor was blinded, which is the distinction that
    // matters for a sham-controlled neuromodulation trial.
    whoMasked: info.maskingInfo?.whoMasked || [],
    armTypes,
    armCount: arms.length,
    hasShamArm: armTypes.includes('SHAM_COMPARATOR'),
    hasPlaceboArm: armTypes.includes('PLACEBO_COMPARATOR'),
    hasControlArm: armTypes.some(t => CONTROL_ARM_TYPES.includes(t)),
    primaryOutcomes,
    secondaryOutcomes,
    // A registration with a stated primary outcome measure is the registry's own
    // evidence of pre-specification. It is NOT a judgement that the endpoint is
    // good, only that one was declared before the fact.
    hasPrespecifiedPrimary: primaryOutcomes.length > 0,
    registrationDate: p.statusModule?.studyFirstSubmitDate
      || p.statusModule?.studyFirstPostDateStruct?.date || null,
    resultsPosted: !!study?.hasResults,
  }
}

/** The API field list needed to build the block above. */
export const TRIAL_DESIGN_FIELDS = [
  'protocolSection.identificationModule.nctId',
  'protocolSection.designModule',
  'protocolSection.outcomesModule',
  'protocolSection.armsInterventionsModule.armGroups',
  'protocolSection.statusModule',
  'hasResults',
].join(',')
