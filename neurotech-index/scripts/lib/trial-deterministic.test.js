import { describe, it, expect } from 'vitest'
import {
  designGrade, trialTier, recordTier, gapFor, gateFor, methFor,
  translationalDistance, reasonFor,
} from './trial-deterministic.js'

const design = (over = {}) => ({
  registrationDate: '2019-04-01', hasPrespecifiedPrimary: true,
  primaryOutcomes: [{ measure: 'Change in seizure frequency' }],
  allocation: 'RANDOMIZED', hasControlArm: true, hasShamArm: true,
  masking: 'DOUBLE', whoMasked: ['PARTICIPANT'], primaryPurpose: 'TREATMENT',
  studyType: 'INTERVENTIONAL',
  ...over,
})

describe('the design-quality grade never claims more than the registry states', () => {
  it('never awards decisive, because powering is not registered', () => {
    // Spec 5.3.2: decisive "requires the interpretable-null condition
    // explicitly", and a registration does not say whether it is powered.
    expect(designGrade(design(), 'Phase 3').grade).toBe('strong')
  })

  it('grades an unregistered or endpoint-less trial announced-only', () => {
    expect(designGrade(design({ registrationDate: null })).grade).toBe('announced-only')
    expect(designGrade(design({ hasPrespecifiedPrimary: false })).grade).toBe('announced-only')
  })

  it('grades a non-efficacy purpose exploratory', () => {
    expect(designGrade(design({ primaryPurpose: 'DEVICE_FEASIBILITY' })).grade).toBe('exploratory')
    expect(designGrade(design({ primaryPurpose: 'BASIC_SCIENCE' })).grade).toBe('exploratory')
  })

  it('grades non-randomized but controlled as indicative', () => {
    expect(designGrade(design({ allocation: 'NON_RANDOMIZED' }), 'Phase 3').grade).toBe('indicative')
  })

  it('grades an early-phase single-arm trial exploratory, not indicative', () => {
    expect(designGrade(design({ hasControlArm: false, hasShamArm: false }), 'Phase 1').grade).toBe('exploratory')
  })

  it('cites the registry field that produced the grade', () => {
    expect(designGrade(design(), 'Phase 3').referent).toMatch(/randomized with a sham arm/)
    expect(designGrade(design({ registrationDate: null })).referent).toMatch(/no registration date/)
  })
})

describe('GAP compares this trial against what is already recorded', () => {
  const record = { id: 'rec-1', current_value: 'randomized, Phase 2, n = 40', notes: 'Rung "randomized_controlled" (tier 4 of 5) of the ladder' }

  it('reads the rung back out of the seeded record', () => {
    expect(recordTier(record)).toBe(4)
    expect(recordTier({ notes: 'no rung here' })).toBeNull()
  })

  it('scores 3 when this design beats the best on record', () => {
    // Phase 3 randomized controlled is tier 5 against the record's tier 4.
    const g = gapFor({ design: design(), phase: 'Phase 3' }, record)
    expect(g.score).toBe(3)
    expect(g.consulted).toEqual(['rec-1'])
    expect(g.referent).toContain('randomized, Phase 2, n = 40')
  })

  it('scores 2 when it matches the record and the question is not crowded', () => {
    // Matching the strongest recorded design is not by itself crowding. The
    // evidence record is drawn from this same pool, so treating "equal" as
    // incremental zeroed most of the corpus.
    expect(gapFor({ design: design(), phase: 'Phase 2' }, record, 1).score).toBe(2)
  })

  it('scores 1 when it matches AND many peers share that tier', () => {
    expect(gapFor({ design: design(), phase: 'Phase 2' }, record, 40).score).toBe(1)
  })

  it('scores 1, not 0, when one rung weaker', () => {
    // GAP 0 requires that a prior trial ANSWERED the question and this one does
    // not address a stated limitation. The second clause is unverifiable here,
    // and the tier comparison ignores intervention class entirely, so asserting
    // "settled" would overclaim.
    const r3 = { ...record, notes: 'tier 3 of 5' }
    expect(gapFor({ design: design({ hasControlArm: false }), phase: 'Phase 1' }, r3).score).toBe(1)
  })

  it('scores 0 only when two or more rungs weaker', () => {
    const strong = { ...record, notes: 'tier 5 of 5' }
    expect(gapFor({ design: design({ hasControlArm: false }), phase: 'Phase 1' }, strong).score).toBe(0)
  })

  it('scores 0 with NO record, rather than treating absence as novelty', () => {
    // The informative-absence trap: an absent record is a fact about our
    // curation, not about the field. Spec 7.1.3 caps the dimension.
    const g = gapFor({ design: design(), phase: 'Phase 3' }, null)
    expect(g.score).toBe(0)
    expect(g.consulted).toEqual([])
  })

  it('never reaches 4, since that asserts no prior evidence of any kind', () => {
    for (const p of ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4']) {
      expect(gapFor({ design: design(), phase: p }, record).score).toBeLessThanOrEqual(3)
    }
  })

  it('scores 0 for an observational study', () => {
    expect(gapFor({ design: design({ studyType: 'OBSERVATIONAL' }), phase: 'Phase 3' }, record).score).toBe(0)
  })
})

describe('trialTier uses the same ladder as the evidence seeder', () => {
  it.each([
    ['Phase 3', {}, 5],
    ['Phase 2', {}, 4],
    ['Phase 3', { allocation: 'NON_RANDOMIZED' }, 3],
    ['Phase 3', { hasControlArm: false }, 2],
  ])('%s %o -> tier %i', (phase, over, want) => {
    expect(trialTier(design(over), phase)).toBe(want)
  })

  it('returns null for a non-interventional study', () => {
    expect(trialTier(design({ studyType: 'OBSERVATIONAL' }), 'Phase 3')).toBeNull()
  })
})

describe('GATE and METH stop where the registry stops', () => {
  it('caps GATE at 2, since a class-wide pathway is not a registry fact', () => {
    for (const p of ['Phase 3', 'Phase 4']) {
      const g = gateFor({ phase: p, design: design() })
      expect(g.score).toBe(2)
      expect(g.unlocks.length).toBeGreaterThan(0)
    }
  })

  it('gives GATE 2 a specific unlock, so validator rule 3 cannot reset it', () => {
    const g = gateFor({ phase: 'Phase 3', design: design() })
    expect(g.unlocks[0]).not.toMatch(/advance the field|help patients|improve outcomes/i)
  })

  it('scores GATE lower for earlier phases and 0 with no phase', () => {
    expect(gateFor({ phase: 'Phase 2', design: design() }).score).toBe(1)
    expect(gateFor({ phase: 'Phase 1', design: design() }).score).toBe(0)
    expect(gateFor({ phase: null, design: design() }).score).toBe(0)
  })

  it('caps METH at 1, since endpoint novelty needs the literature', () => {
    expect(methFor({ design: design() }).score).toBe(1)
  })

  it('gives METH 0 without a masked sham arm', () => {
    expect(methFor({ design: design({ hasShamArm: false }) }).score).toBe(0)
    expect(methFor({ design: design({ masking: 'NONE' }) }).score).toBe(0)
  })
})

describe('every score above 0 carries a referent, per spec 8 rule 1', () => {
  it('holds across the dimensions this scorer produces', () => {
    const record = { id: 'r', current_value: 'x', notes: 'tier 3 of 5' }
    const scores = [
      gapFor({ design: design(), phase: 'Phase 3' }, record),
      gateFor({ phase: 'Phase 3', design: design() }),
      methFor({ design: design() }),
    ]
    for (const s of scores) {
      if (s.score > 0) expect(String(s.referent || '').trim().length, JSON.stringify(s)).toBeGreaterThan(3)
    }
  })
})

describe('translational distance and the user-facing sentence', () => {
  it.each([['Phase 1', 2], ['Phase 2', 3], ['Phase 3', 3], [null, 2]])('%s -> %i', (p, want) => {
    expect(translationalDistance(p)).toBe(want)
  })

  it('writes plain language with no rubric vocabulary and no rubric numbers', () => {
    const s = reasonFor({
      design: design(), phase: 'Phase 3', indicationLabel: 'Epilepsy',
      gap: { score: 3 }, grade: 'strong',
    })
    expect(s).not.toMatch(/\b(GAP|GATE|METH|FD|LV|TR|rubric|score)\b/i)
    // A trial phase is field language, not a rubric number: "at phase 3" is
    // exactly the register spec 9.2 asks for. What must not appear is a digit
    // standing on its own as a score, so strip phase labels before checking.
    expect(s.replace(/phase \d/gi, 'phase')).not.toMatch(/\b[0-4]\b/)
    expect(s).toMatch(/randomized trial with a sham group/)
    expect(s).toMatch(/epilepsy/)
  })

  it('says plainly when a registration states no endpoint', () => {
    const s = reasonFor({ design: design({ hasPrespecifiedPrimary: false }), phase: null, grade: 'announced-only' })
    expect(s).toMatch(/does not state what it will measure/)
  })
})
