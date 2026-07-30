import { describe, it, expect } from 'vitest'
import { trialDesign, CONTROL_ARM_TYPES, TRIAL_DESIGN_FIELDS } from './trial-design.js'

const study = ({
  studyType = 'INTERVENTIONAL', allocation = 'RANDOMIZED', interventionModel = 'PARALLEL',
  masking = 'DOUBLE', whoMasked = ['PARTICIPANT', 'INVESTIGATOR'], armGroups = [{ type: 'SHAM_COMPARATOR' }, { type: 'EXPERIMENTAL' }],
  primaryOutcomes = [{ measure: 'Change in seizure frequency', description: 'Monthly count', timeFrame: '12 months' }],
  secondaryOutcomes = [], hasResults = false,
} = {}) => ({
  hasResults,
  protocolSection: {
    identificationModule: { nctId: 'NCT1' },
    statusModule: { studyFirstSubmitDate: '2019-04-01' },
    designModule: { studyType, phases: ['PHASE3'], designInfo: { allocation, interventionModel, maskingInfo: { masking, whoMasked } } },
    outcomesModule: { primaryOutcomes, secondaryOutcomes },
    armsInterventionsModule: { armGroups },
  },
})

describe('reads what the registration states', () => {
  it('captures design, masking and registration date', () => {
    expect(trialDesign(study())).toMatchObject({
      studyType: 'INTERVENTIONAL', allocation: 'RANDOMIZED', interventionModel: 'PARALLEL',
      masking: 'DOUBLE', whoMasked: ['PARTICIPANT', 'INVESTIGATOR'],
      registrationDate: '2019-04-01', armCount: 2,
    })
  })

  it('captures the primary endpoint, which is what METH 3 turns on', () => {
    const d = trialDesign(study())
    expect(d.primaryOutcomes).toEqual([
      { measure: 'Change in seizure frequency', description: 'Monthly count', timeFrame: '12 months' },
    ])
    expect(d.hasPrespecifiedPrimary).toBe(true)
  })

  it('normalizes whitespace and caps runaway text', () => {
    const d = trialDesign(study({ primaryOutcomes: [{ measure: '  a\n\n  b  ', description: 'x'.repeat(2000) }] }))
    expect(d.primaryOutcomes[0].measure).toBe('a b')
    expect(d.primaryOutcomes[0].description.length).toBe(800)
    expect(d.primaryOutcomes[0].timeFrame).toBeNull()
  })
})

describe('control arms, which is what METH 4 turns on', () => {
  it('detects a sham arm', () => {
    const d = trialDesign(study())
    expect(d.hasShamArm).toBe(true)
    expect(d.hasControlArm).toBe(true)
    expect(d.hasPlaceboArm).toBe(false)
  })

  it('counts an active comparator as a control but not as a sham', () => {
    const d = trialDesign(study({ armGroups: [{ type: 'ACTIVE_COMPARATOR' }, { type: 'EXPERIMENTAL' }] }))
    expect(d.hasShamArm).toBe(false)
    expect(d.hasControlArm).toBe(true)
  })

  it('reports a single-arm trial as uncontrolled', () => {
    const d = trialDesign(study({ armGroups: [{ type: 'EXPERIMENTAL' }] }))
    expect(d.hasControlArm).toBe(false)
    expect(d.armCount).toBe(1)
  })

  it('keeps the control vocabulary to the registry values', () => {
    expect(CONTROL_ARM_TYPES).toContain('SHAM_COMPARATOR')
    expect(CONTROL_ARM_TYPES).not.toContain('EXPERIMENTAL')
  })
})

describe('absent fields stay absent', () => {
  it('does not invent a pre-specified endpoint when none is registered', () => {
    // The flattering default would be to assume one exists. It must not.
    const d = trialDesign(study({ primaryOutcomes: [] }))
    expect(d.hasPrespecifiedPrimary).toBe(false)
    expect(d.primaryOutcomes).toEqual([])
  })

  it('survives an empty or malformed study record', () => {
    for (const s of [{}, null, { protocolSection: {} }]) {
      const d = trialDesign(s)
      expect(d.primaryOutcomes).toEqual([])
      expect(d.hasControlArm).toBe(false)
      expect(d.allocation).toBeNull()
    }
  })

  it('drops outcome entries with no measure', () => {
    expect(trialDesign(study({ primaryOutcomes: [{ description: 'orphan' }] })).primaryOutcomes).toEqual([])
  })
})

describe('the field list matches what the extractor reads', () => {
  it('requests outcomes, arms, design and status', () => {
    for (const f of ['outcomesModule', 'armsInterventionsModule.armGroups', 'designModule', 'statusModule']) {
      expect(TRIAL_DESIGN_FIELDS).toContain(f)
    }
  })
})
