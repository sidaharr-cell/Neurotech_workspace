/**
 * score.js — spec section 7.3. The scoring call.
 *
 * TAKES ITS COMPARISON SET AS AN ARGUMENT and never queries the database. This
 * is the binding constraint in docs/potential-impact-phase4-design.md: Phase 5
 * must run this identical scorer against a 2016 record set, and a scorer that
 * reads "current" records internally could only be calibrated by forking it,
 * which would validate something other than what ships.
 *
 * The model is asked to COMPARE, never to rate importance. Spec 2 forbids the
 * unanchored question outright: "Unanchored importance questions collapse into
 * vocabulary matching, and the model will learn that 'first', 'unprecedented',
 * and press-release register mean important."
 *
 * Everything deterministic happens outside the model: the ceilings, the section
 * 8 validators, the composition. The model's only job is the rubric comparison.
 */

export const RUBRIC_VERSION = '1.0'

/** 5.1.1, 5.1.2, 5.1.3 — Research and Devices. */
export const RESEARCH_RUBRIC = `
FD, frontier delta. How far this moves a recorded frontier.
  0  No relationship to any frontier record. Confirmatory, incremental within an
     established range, or a re-report of existing capability.
  1  Moves a record along an axis by a margin within normal variation.
  2  Moves a record by a margin outside normal variation, or sets a first record
     on an axis previously measured but unrecorded.
  3  Opens a new axis. Demonstrates a capability that had no prior record because
     nobody had achieved that category of thing. Only available when the records
     below are broad enough that an absence means something; if they are thin,
     the ceiling given to you already reflects that.
  4  Collapses a tradeoff. Improves one axis WITHOUT the loss along a paired axis
     the field treats as necessary. A 4 MUST name both paired axes in
     paired_axes and say in the justification why the tradeoff was binding.

LV, leverage. Whether this lowers the cost of future work for OTHER parties.
  0  No leverage. Closed result, no artifact, no precedent, no constraint named.
  1  Relieves a constraint local to the authors' own setup, or releases an
     artifact under restrictive or undocumented terms.
  2  Relieves a constraint shared by several groups, releases a usable artifact,
     or sets a narrow precedent.
  3  Relieves a constraint blocking an entire subfield, or materially lowers cost
     for a subfield.
  4  Relieves a constraint blocking multiple subfields, or changes what is
     economically or legally feasible for a device class.
  A score of 2 or more MUST list a beneficiary in "beneficiaries" who is NOT the
  authors. If you cannot name one, the constraint was invented and the score is 1.
  Regulatory status scores HERE, not in FD: a breakthrough designation is a
  precedent and a class-level cost reduction, not a frontier movement.

TR, transferability.
  0  Specific to one subject, device or dataset, with no stated path to generalize.
  1  Transferable within the same platform.
  2  Transferable across platforms within the subfield.
  3  Transferable across subfields.
  4  General tool, applicable outside neurotechnology or to problems the authors
     did not address.`

/** 5.2.1, 5.2.2, 5.2.3 — Trials. */
export const TRIAL_RUBRIC = `
GAP, evidence gap. How open is the question this trial is designed to answer.
  0  Settled. A prior adequately powered trial answered it and this does not
     address a stated limitation of that trial.
  1  Crowded. Several trials running or completed on substantially the same
     intervention and indication.
  2  Real but bounded gap. Extends an answered question to a new population, a
     new parameter set, longer follow-up, or an untested comparator.
  3  First adequately powered test of an intervention class in an indication
     where only open-label or single-arm evidence exists.
  4  First clinical test of an intervention class, or first trial in an indication
     with no prior interventional evidence of any kind.
  GAP above 0 MUST cite the evidence records you consulted.

GATE, translational gating. What COMPLETING this trial unlocks.
  0  Nothing beyond a publication.
  1  An incremental label expansion or a single-site practice change.
  2  An approval or label expansion for one device in one indication.
  3  A regulatory or reimbursement pathway other devices in the class can follow,
     or a predicate for a category.
  4  Market access for an entire intervention class, or first-in-class
     reimbursement where none exists.
  A score of 2 or more MUST name the specific approval, pathway, indication or
  coverage decision at stake in "unlocks". Would advance the field is not one.

METH, methodological precedent.
  0  Standard design, standard endpoints, result confined to this intervention
     and indication.
  1  Minor methodological adaptation, reusable within the same programme.
  2  Introduces an endpoint, outcome measure, blinding approach or control design
     others in the subfield could adopt, or informs a closely related indication.
  3  Establishes an endpoint or design likely to become standard for the subfield,
     or tests a mechanism whose answer generalizes across indications.
  4  Resolves a methodological question blocking trial design across MULTIPLE
     subfields, for example a validated sham control for a modality that lacked
     one, or a functional endpoint applicable across interface types.`

export const SCORING_PROMPT = `Score this neurotechnology item against the rubric
below. You are comparing it to the frontier records provided. You are not judging
importance in the abstract, and there is no field in which to record an opinion
about importance.

Rules:
- Score against what was DEMONSTRATED, never against what was CLAIMED.
- Every score above 0 requires a specific referent from the content. If you
  cannot point to something specific, the score is 0.
- Superlatives and novelty language are not evidence. Ignore them entirely.
- If the item's subfield has no relevant record, {DIM} is 0. This is expected and
  is not a failure.
- List in frontier_records_consulted every record id you actually checked,
  INCLUDING when none of them matched. Checking six records and finding no
  coverage of this axis is a real and useful result; an empty list means you
  checked nothing.
{ceiling_note}
Current frontier records for this subfield:
{records}
{pairs}
Extraction:
{extraction}

Rubric:
{rubric}

translational_distance, 0 to 4: how far from routine patient use.
  0 theory or simulation, 1 bench or animal, 2 first in humans,
  3 in trials toward approval, 4 in clinical use.

user_facing_reason: ONE sentence, plain field language. No rubric terms, no
dimension names, no numbers from this rubric, readable by someone who has never
seen this scoring system. State what the item does and what it changes. If it
ranks on a claim rather than on data, say so.`

const CEILING_NOTE = {
  0: '- The record layer holds nothing for this subfield, so FD/GAP is 0. Score the other dimensions normally.',
  2: '- The record layer for this subfield is too thin for an absence to mean anything, so FD/GAP is capped at 2. Do not award "opens a new axis".',
  4: '',
}

export const SCORING_TOOL = entityType => {
  const dims = entityType === 'trial' ? ['GAP', 'GATE', 'METH'] : ['FD', 'LV', 'TR']
  const dim = extra => ({
    type: 'object',
    properties: {
      score: { type: 'integer', minimum: 0, maximum: 4 },
      justification: { type: 'string', description: 'One sentence.' },
      referent: { type: 'string', description: 'Quoted or pointed-to content from the item. Required above 0.' },
      ...extra,
    },
    required: ['score', 'justification', 'referent'],
  })
  const properties = {
    [dims[0]]: dim(entityType === 'trial' ? {} : {
      paired_axes: { type: 'array', items: { type: 'string' }, description: 'Required for FD 4: the two coupled axes.' },
    }),
    [dims[1]]: dim(entityType === 'trial'
      ? { unlocks: { type: 'array', items: { type: 'string' }, description: 'Required at 2 or above.' } }
      : { beneficiaries: { type: 'array', items: { type: 'string' }, description: 'Required at 2 or above. Not the authors.' } }),
    [dims[2]]: dim({}),
    frontier_records_consulted: { type: 'array', items: { type: 'string' } },
    translational_distance: { type: 'integer', minimum: 0, maximum: 4 },
    evidence_grade: { type: 'string' },
    uncertainty: { type: 'string', enum: ['low', 'medium', 'high'] },
    user_facing_reason: { type: 'string' },
    record_update_proposed: {
      type: ['object', 'null'],
      properties: { axis: { type: 'string' }, proposed_value: { type: 'string' } },
    },
  }
  return {
    name: 'record_scores',
    description: 'Record the rubric comparison for this item.',
    input_schema: {
      type: 'object',
      properties,
      required: [...dims, 'frontier_records_consulted', 'translational_distance',
        'evidence_grade', 'uncertainty', 'user_facing_reason'],
    },
  }
}

const fmtRecords = recs => (recs.length
  ? recs.map(r => `  [${r.id}] (${r.axis_type}) ${r.axis} = ${r.current_value}` +
      `${r.confidence ? `  [${r.confidence}]` : ''}`).join('\n')
  : '  (none for this subfield)')

const fmtPairs = pairs => (pairs.length
  ? `\nAxis pairs this subfield treats as a binding tradeoff. Improving one WITHOUT\nlosing the other is what FD 4 means:\n` +
    pairs.map(p => `  ${p.axis_a}  <->  ${p.axis_b}\n      why binding: ${p.why_binding}`).join('\n') + '\n'
  : '')

/** Build the exact prompt for an item. Exported so it is testable without a model. */
export function buildPrompt({ extraction, entityType, records = [], axisPairs = [], fdCeiling = 4 }) {
  const isTrial = entityType === 'trial'
  return SCORING_PROMPT
    .replace('{DIM}', isTrial ? 'GAP' : 'FD')
    .replace('{ceiling_note}', CEILING_NOTE[fdCeiling] ?? '')
    .replace('{records}', fmtRecords(records))
    .replace('{pairs}', isTrial ? '' : fmtPairs(axisPairs))
    .replace('{extraction}', JSON.stringify({
      claimed: extraction.claimed,
      demonstrated: extraction.demonstrated,
      quantitative_results: extraction.quantitative_results,
      methods_disclosed: extraction.methods_disclosed,
      artifacts_released: extraction.artifacts_released,
      constraints_addressed: extraction.constraints_addressed,
      trial_design: extraction.trial_design,
      // rhetorical_markers deliberately WITHHELD from the scorer. They are
      // recorded for monitoring and are not evidence; showing them to the model
      // invites exactly the vocabulary matching spec 2 forbids.
    }, null, 1).slice(0, 8000))
    .replace('{rubric}', isTrial ? TRIAL_RUBRIC : RESEARCH_RUBRIC)
}

/**
 * Apply the deterministic ceilings. Runs in code, after the model, because a
 * ceiling is a fact about OUR inputs and must not be negotiable by the scorer.
 * Returns the capped score plus what bound it, so a capped item can say so.
 */
export function applyCeilings(scores, { fdCeiling = 4, granularityCap = {} } = {}) {
  const out = JSON.parse(JSON.stringify(scores))
  const capped = []
  const clamp = (dim, ceiling, reason) => {
    if (!out[dim] || ceiling === undefined || ceiling === null) return
    if (out[dim].score > ceiling) {
      capped.push({ dimension: dim, from: out[dim].score, to: ceiling, reason })
      out[dim].score = ceiling
    }
  }
  // Both ceilings bind and the lower wins.
  const fdLimit = Math.min(fdCeiling, granularityCap.FD ?? 4)
  clamp('FD', fdLimit, fdCeiling <= (granularityCap.FD ?? 4) ? 'record coverage' : 'input granularity')
  clamp('GAP', fdCeiling, 'record coverage')
  clamp('METH', granularityCap.METH ?? 4, 'input granularity')
  return { scores: out, capped }
}
