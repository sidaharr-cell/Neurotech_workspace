import { describe, it, expect } from 'vitest'
import { EVIDENCE_TIERS, designOf, tierOf, valueFor, dateOf } from './seed-evidence-records.js'

/** A registry study in the shape the API returns. */
const study = ({
  allocation = 'RANDOMIZED', interventionModel = 'PARALLEL', masking = 'DOUBLE',
  phases = ['PHASE3'], studyType = 'INTERVENTIONAL', count = 200,
  status = 'COMPLETED', completion = '2023-05-01', start = '2019-01-01', hasResults = false,
} = {}) => ({
  hasResults,
  protocolSection: {
    identificationModule: { nctId: 'NCT00000001' },
    statusModule: {
      overallStatus: status,
      completionDateStruct: completion ? { date: completion } : undefined,
      startDateStruct: start ? { date: start } : undefined,
    },
    designModule: {
      studyType, phases,
      designInfo: { allocation, interventionModel, maskingInfo: { masking } },
      enrollmentInfo: { count, type: 'ACTUAL' },
    },
    sponsorCollaboratorsModule: { leadSponsor: { name: 'A University' } },
  },
})

const tierIdOf = opts => tierOf(designOf(study(opts)))?.id

describe('the ladder', () => {
  it('is ordered strongest first with no duplicate rungs', () => {
    const tiers = EVIDENCE_TIERS.map(t => t.tier)
    expect(tiers).toEqual([...tiers].sort((a, b) => b - a))
    expect(new Set(EVIDENCE_TIERS.map(t => t.id)).size).toBe(EVIDENCE_TIERS.length)
  })

  it.each([
    ['randomized parallel Phase 3', {}, 'randomized_controlled_late_phase'],
    ['randomized parallel Phase 4', { phases: ['PHASE4'] }, 'randomized_controlled_late_phase'],
    ['randomized crossover Phase 2', { interventionModel: 'CROSSOVER', phases: ['PHASE2'] }, 'randomized_controlled'],
    ['randomized parallel, no phase', { phases: ['NA'] }, 'randomized_controlled'],
    ['non-randomized parallel', { allocation: 'NON_RANDOMIZED' }, 'nonrandomized_controlled'],
    ['single group', { interventionModel: 'SINGLE_GROUP', allocation: 'NA' }, 'single_arm'],
  ])('%s → %s', (_label, opts, expected) => {
    expect(tierIdOf(opts)).toBe(expected)
  })

  it('does not treat a randomized single-group study as controlled', () => {
    // Randomization without a comparator arm is still single-arm evidence, and
    // GAP 3 is defined against exactly that rung.
    expect(tierIdOf({ interventionModel: 'SINGLE_GROUP' })).toBe('single_arm')
  })

  it('excludes observational studies entirely', () => {
    // An observational study is not interventional evidence, whatever its size.
    expect(tierOf(designOf(study({ studyType: 'OBSERVATIONAL' })))).toBeNull()
  })
})

describe('extraction reads only what the registry states', () => {
  it('pulls the design fields through unchanged', () => {
    const d = designOf(study({ count: 360, masking: 'SINGLE', phases: ['PHASE4'] }))
    expect(d).toMatchObject({
      nctId: 'NCT00000001', interventional: true, randomized: true, controlled: true,
      latePhase: true, masking: 'SINGLE', enrollment: 360, status: 'COMPLETED',
      sponsor: 'A University',
    })
  })

  it('survives a study with no design info at all', () => {
    const d = designOf({ protocolSection: { designModule: { studyType: 'INTERVENTIONAL' } } })
    expect(d.randomized).toBe(false)
    expect(d.controlled).toBe(false)
    expect(tierOf(d).id).toBe('single_arm')
  })
})

describe('dates are never quoted as achievements before they happen', () => {
  it('uses the completion date for a completed trial', () => {
    expect(dateOf(designOf(study()))).toEqual({ when: '2023-05-01', verb: 'completed' })
  })

  it('uses the START date when the trial has not completed', () => {
    // A non-completed trial's completionDate is the sponsor's ESTIMATE. Quoting
    // it would put a future event in the record as though it had occurred.
    const d = designOf(study({ status: 'RECRUITING', completion: '2027-12', start: '2024-03' }))
    expect(dateOf(d)).toEqual({ when: '2024-03', verb: 'recruiting, started' })
  })

  it('uses the start date for an unknown-status trial', () => {
    const d = designOf(study({ status: 'UNKNOWN', completion: '2015-12', start: '2013-02' }))
    expect(dateOf(d).when).toBe('2013-02')
  })
})

describe('the value string', () => {
  it('states the design, size, and date with units', () => {
    expect(valueFor(EVIDENCE_TIERS[0], designOf(study({ phases: ['PHASE4'], masking: 'SINGLE', count: 360 }))))
      .toBe('randomized, parallel assignment, Phase 4, single masking, n = 360, completed 2023-05-01')
  })

  it('does not print the phase twice', () => {
    // The tier label says "Phase 3 or 4" and the phase field says "Phase 4";
    // building from the design facts avoids repeating it.
    const v = valueFor(EVIDENCE_TIERS[0], designOf(study({ phases: ['PHASE4'] })))
    expect(v.match(/Phase/g)).toHaveLength(1)
  })

  it('marks a non-randomized study as such', () => {
    expect(valueFor(EVIDENCE_TIERS[2], designOf(study({ allocation: 'NON_RANDOMIZED' }))))
      .toMatch(/^non-randomized, parallel assignment/)
  })

  it('always carries a number, so the record passes the units check', () => {
    for (const opts of [{}, { phases: ['NA'] }, { masking: 'NONE' }, { interventionModel: 'SINGLE_GROUP' }]) {
      expect(valueFor(EVIDENCE_TIERS[0], designOf(study(opts)))).toMatch(/\d/)
    }
  })
})
