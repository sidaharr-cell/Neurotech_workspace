/**
 * trial-deterministic.js — score a trial from registry fields alone. No model.
 *
 * WHY THIS EXISTS. The spec has a model perform the rubric comparison, and for
 * research that is necessary: judging whether a result opens an axis needs
 * reading. For TRIALS most of the rubric is already recorded fact. The design-
 * quality grade in spec 5.3.2 is a checklist over registration fields, and GAP is
 * a comparison against an evidence record we already hold. 8,216 of 8,345
 * indexed trials carry everything needed.
 *
 * IT IS STRICTER ON SPEC 2, NOT LOOSER. Section 2 forbids unanchored importance
 * questions, forbids rhetorical markers raising a score, and requires a specific
 * referent for every score above 0. A function cannot be asked how important
 * something feels, cannot read a superlative, and its referent is the registry
 * field it read. The marker/impact correlation is exactly zero by construction
 * rather than by measurement.
 *
 * WHAT IT GIVES UP, DELIBERATELY.
 *   GAP  reaches 3, never 4. A 4 means "no prior interventional evidence of any
 *        kind", and an absent record in OUR layer is not evidence of absence in
 *        the world. Same informative-absence problem as FD 3.
 *   GATE reaches 2, never 3 or 4. Those require judging whether a pathway is one
 *        others can follow, which no registry field encodes.
 *   METH reaches 1, never 2 or more. Judging whether an endpoint is novel enough
 *        to be adopted needs reading the literature, not the registration.
 *   grade reaches `strong`, never `decisive`. Spec 5.3.2: decisive "requires the
 *        interpretable-null condition explicitly", and a registration does not
 *        state whether it is powered. A trial that cannot be shown to produce an
 *        interpretable null is "at most strong" by the spec's own words.
 *
 * So trials score lower here than a model would score them. That is honest
 * under-scoring: every ceiling above is a fact we do not hold, not a judgement
 * we made.
 */

/** Primary purposes that are not an efficacy question. Spec 5.3.2 `exploratory`. */
/** How many same-tier trials in an indication make the question "crowded". */
export const CROWDED_AT = 5

const NON_EFFICACY_PURPOSE = [
  'DEVICE_FEASIBILITY', 'BASIC_SCIENCE', 'DIAGNOSTIC', 'SCREENING',
  'HEALTH_SERVICES_RESEARCH', 'SUPPORTIVE_CARE', 'OTHER',
]

const phaseNum = phase => {
  const s = String(phase || '')
  if (/Phase 4/.test(s)) return 4
  if (/Phase 3/.test(s)) return 3
  if (/Phase 2/.test(s)) return 2
  if (/early Phase 1/i.test(s)) return 0.5
  if (/Phase 1/.test(s)) return 1
  return null
}

/**
 * Design-quality grade, spec 5.3.2, from registration fields only.
 * Returns { grade, referent } so the score can cite what produced it.
 */
export function designGrade(design = {}, phase = null) {
  const d = design || {}
  if (!d.registrationDate || !d.hasPrespecifiedPrimary) {
    return {
      grade: 'announced-only',
      referent: !d.registrationDate
        ? 'no registration date recorded'
        : 'registration states no primary outcome measure',
    }
  }
  if (NON_EFFICACY_PURPOSE.includes(d.primaryPurpose)) {
    return {
      grade: 'exploratory',
      referent: `primary purpose "${d.primaryPurpose}", not an efficacy question`,
    }
  }
  const endpoint = d.primaryOutcomes?.[0]?.measure || 'a pre-specified primary outcome'
  if (d.allocation === 'RANDOMIZED' && d.hasControlArm) {
    // Never `decisive`: that needs an explicit powering claim the registry does
    // not carry, and spec 5.3.2 caps an unpowered design at strong.
    return {
      grade: 'strong',
      referent: `randomized with a ${d.hasShamArm ? 'sham' : 'control'} arm and pre-specified endpoint "${String(endpoint).slice(0, 90)}"`,
    }
  }
  if (d.hasControlArm) {
    return { grade: 'indicative', referent: `non-randomized but controlled, endpoint "${String(endpoint).slice(0, 90)}"` }
  }
  return {
    grade: 'indicative',
    referent: `single-arm, endpoint "${String(endpoint).slice(0, 90)}"`,
    ...(phaseNum(phase) !== null && phaseNum(phase) <= 1 ? { grade: 'exploratory', referent: `single-arm Phase ${phaseNum(phase)}, no comparator` } : {}),
  }
}

/** The rung an evidence record sits on, read back from the note the seeder wrote. */
export function recordTier(record) {
  const m = /tier (\d) of 5/.exec(record?.notes || '')
  return m ? Number(m[1]) : null
}

/** The rung THIS trial would sit on, using the same ladder as the seeder. */
export function trialTier(design = {}, phase = null) {
  const d = design || {}
  if (d.studyType && d.studyType !== 'INTERVENTIONAL') return null
  const controlled = !!d.hasControlArm
  const randomized = d.allocation === 'RANDOMIZED'
  const late = (phaseNum(phase) || 0) >= 3
  if (randomized && controlled && late) return 5
  if (randomized && controlled) return 4
  if (controlled) return 3
  return 2
}

/**
 * GAP, spec 5.2.1, by comparing this trial's rung against the strongest
 * evidence already recorded for its indication.
 *
 * No record means GAP 0, not GAP 4. Spec 7.1.3 caps the dimension when there is
 * nothing to compare against, and an absence in our record layer is a fact about
 * our curation rather than about the field.
 */
export function gapFor({ design, phase }, evidenceRecord, peersAtSameTier = null) {
  if (!evidenceRecord) {
    return { score: 0, justification: 'No evidence record exists for this indication, so there is nothing to compare against.', referent: 'no evidence record for this indication', consulted: [] }
  }
  const mine = trialTier(design, phase)
  const theirs = recordTier(evidenceRecord)
  const consulted = [evidenceRecord.id]
  if (mine === null) {
    return { score: 0, justification: 'Not an interventional study, so it does not test an intervention class.', referent: `study type ${design?.studyType || 'not stated'}`, consulted }
  }
  if (theirs === null) {
    return { score: 0, justification: 'The evidence record for this indication does not record a comparable strength.', referent: `record ${evidenceRecord.id} has no recorded rung`, consulted }
  }
  const ref = `strongest recorded evidence for this indication: ${evidenceRecord.current_value}`
  if (mine > theirs) {
    return { score: 3, justification: 'This is a stronger design than the best evidence recorded for this indication, so it tests a question that existing evidence cannot settle.', referent: ref, consulted }
  }
  if (mine === theirs) {
    // Spec 5.2.1 defines GAP 1 as CROWDED: "Several trials running or completed
    // on substantially the same intervention and indication." Matching the
    // strongest recorded design is not by itself crowding, and treating it as
    // such zeroed most of the corpus, because the evidence record is drawn from
    // this same pool and is therefore almost never beaten. Count the peers
    // instead of assuming them.
    const crowded = peersAtSameTier !== null && peersAtSameTier >= CROWDED_AT
    return crowded
      ? { score: 1, justification: `Around ${peersAtSameTier} trials of this strength exist for this indication, so this is incremental confirmation.`, referent: ref, consulted }
      : { score: 2, justification: 'Matches the strongest design on record for this indication without a crowd of equivalents, so it extends a bounded gap.', referent: ref, consulted }
  }
  // Weaker than the record is NOT "settled". Spec 5.2.1 defines GAP 0 as "a
  // prior adequately powered trial has answered it, AND this trial does not
  // address a stated limitation of that trial" — and we cannot verify the second
  // clause, so asserting 0 overclaims. It also ignores intervention class: a
  // first-in-class Phase 1 in a well-studied indication is testing a different
  // question, not a settled one. GAP 1, incremental confirmation, is the honest
  // floor. Two or more rungs below does read as settled.
  const drop = theirs - mine
  return drop >= 2
    ? { score: 0, justification: 'Substantially stronger evidence already exists for this indication than this design can produce.', referent: ref, consulted }
    : { score: 1, justification: 'Somewhat weaker than the strongest design on record for this indication, so this is incremental.', referent: ref, consulted }
}

/**
 * GATE, spec 5.2.2, conservatively. Phase is a real signal about what completion
 * unlocks; whether a pathway is one OTHERS can follow is not in the registry, so
 * 3 and 4 are unreachable here by design.
 */
export function gateFor({ phase, design }) {
  const p = phaseNum(phase)
  if (p === null) {
    return { score: 0, justification: 'No trial phase is registered, so what completion would unlock is not established.', referent: 'no phase recorded', unlocks: [] }
  }
  if (p >= 3) {
    return {
      score: 2,
      justification: 'A late-phase trial of this design supports an approval or label expansion for this intervention in this indication.',
      referent: `Phase ${p} with ${design?.hasControlArm ? 'a comparator' : 'no comparator'}`,
      unlocks: [`approval or label expansion in this indication, on a Phase ${p} readout`],
    }
  }
  if (p === 2) {
    return { score: 1, justification: 'A mid-phase result supports an incremental step rather than an approval.', referent: `Phase ${p}`, unlocks: [] }
  }
  return { score: 0, justification: 'An early-phase study establishes safety or feasibility rather than unlocking a decision.', referent: `Phase ${p}`, unlocks: [] }
}

/**
 * METH, spec 5.2.3, conservatively. A sham control with real masking is a
 * methodological choice worth recording; whether it is NOVEL enough to become
 * standard is a literature judgement, so 2 and above are unreachable here.
 */
export function methFor({ design }) {
  const d = design || {}
  const masked = d.masking && !['NONE'].includes(d.masking)
  if (d.hasShamArm && masked) {
    return {
      score: 1,
      justification: 'Uses a sham comparator with masking, a design choice reusable within this programme.',
      referent: `sham arm with ${String(d.masking).toLowerCase()} masking${(d.whoMasked || []).length ? `, masking ${d.whoMasked.join(' and ').toLowerCase()}` : ''}`,
    }
  }
  return { score: 0, justification: 'Standard design and endpoints, with no reusable methodological element recorded.', referent: `${d.hasShamArm ? 'sham arm but no masking' : 'no sham comparator'}` }
}

/** Translational distance, spec 9.2, from phase. */
export function translationalDistance(phase) {
  const p = phaseNum(phase)
  if (p === null) return 2
  // Phase 4 runs after approval, so the intervention is already in clinical use.
  // That is spec 9.2's TD 4 and the only route to the "In clinical use" tag;
  // collapsing it into 3 silently stripped the tag from every Phase 4 trial.
  if (p >= 4) return 4
  if (p >= 2) return 3
  return 2
}

/**
 * One plain-language sentence. Spec 9.1 and 9.2: no rubric terms, no dimension
 * names, no numbers from the rubric. Built from the registry facts, which is the
 * templated route spec 8 rule 7 already sanctions as the fallback.
 */
export function reasonFor({ design, phase, indicationLabel, gap, grade }) {
  const d = design || {}
  const parts = []
  const shape = d.allocation === 'RANDOMIZED' && d.hasControlArm
    ? `a randomized trial with a ${d.hasShamArm ? 'sham' : 'control'} group`
    : d.hasControlArm ? 'a controlled trial' : 'a single-group study'
  parts.push(`This is ${shape}${phase ? ` at ${String(phase).toLowerCase()}` : ''}`)
  if (indicationLabel) parts.push(`in ${indicationLabel.toLowerCase()}`)
  let s = parts.join(' ') + '.'
  if (gap?.score === 3) s += ' It tests a question that the strongest evidence on record cannot yet settle.'
  else if (gap?.score === 1) s += ' Evidence of similar strength already exists for this condition.'
  if (grade === 'announced-only') s += ' The registration does not state what it will measure.'
  else if (grade === 'exploratory') s += ' It is designed to establish safety or feasibility rather than benefit.'
  return s
}
