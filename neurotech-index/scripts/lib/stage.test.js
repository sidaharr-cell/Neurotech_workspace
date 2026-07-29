import { describe, it, expect } from 'vitest'
import { stageFromTrial, stageFromPathway, furthestStage, STAGE_RANK } from './stage.js'

describe('stage from a trial record', () => {
  it('maps drug-style phases', () => {
    expect(stageFromTrial({ studyType: 'INTERVENTIONAL', phases: ['PHASE3'] })).toBe('pivotal')
    expect(stageFromTrial({ studyType: 'INTERVENTIONAL', phases: ['PHASE2'] })).toBe('feasibility')
    expect(stageFromTrial({ studyType: 'INTERVENTIONAL', phases: ['PHASE1'] })).toBe('first_in_human')
    expect(stageFromTrial({ studyType: 'INTERVENTIONAL', phases: ['EARLY_PHASE1'] })).toBe('first_in_human')
  })

  it('reads a device study through its primary purpose, since phase is NA', () => {
    // The real shape of a device trial record: phases ["NA"], and the actual
    // signal in designInfo.primaryPurpose.
    expect(stageFromTrial({
      studyType: 'INTERVENTIONAL', phases: ['NA'], primaryPurpose: 'DEVICE_FEASIBILITY',
    })).toBe('feasibility')
  })

  it('floors an unlabelled interventional study at first_in_human', () => {
    // It proves the technology has been in humans and nothing more. Reading it
    // as pivotal would be a guess upward.
    expect(stageFromTrial({
      studyType: 'INTERVENTIONAL', phases: ['NA'], primaryPurpose: 'TREATMENT',
    })).toBe('first_in_human')
  })

  it('takes no stage from an observational study', () => {
    expect(stageFromTrial({ studyType: 'OBSERVATIONAL', phases: ['NA'] })).toBe(null)
  })

  it('takes no stage from an empty record', () => {
    expect(stageFromTrial({})).toBe(null)
    expect(stageFromTrial()).toBe(null)
  })
})

describe('stage from a regulatory decision', () => {
  it('maps the pathway directly', () => {
    expect(stageFromPathway('510(k)')).toBe('cleared_510k')
    expect(stageFromPathway('PMA')).toBe('approved_pma')
    expect(stageFromPathway('De Novo')).toBe('de_novo_granted')
  })

  it('refuses to guess at an unrecognised pathway', () => {
    expect(stageFromPathway('HDE')).toBe(null)
    expect(stageFromPathway('Breakthrough Device')).toBe(null)
    expect(stageFromPathway(null)).toBe(null)
  })
})

describe('picking the furthest stage', () => {
  const trial = { stage: 'feasibility', evidenceType: 'clinicaltrials_gov', evidenceId: 'NCT04947462' }
  const cleared = { stage: 'cleared_510k', evidenceType: 'openfda', evidenceId: 'K223086' }

  it('takes the most advanced evidence and keeps what proves it', () => {
    const best = furthestStage([trial, cleared])
    expect(best.stage).toBe('cleared_510k')
    expect(best.evidenceId).toBe('K223086')
    expect(best.evidenceType).toBe('openfda')
  })

  it('returns null when nothing supports a stage', () => {
    expect(furthestStage([])).toBe(null)
    expect(furthestStage([{ stage: null, evidenceId: 'NCT1' }])).toBe(null)
  })

  it('drops a stage with no evidence id, whatever it claims', () => {
    // The database CHECK refuses this row anyway. Better not to build it.
    expect(furthestStage([{ stage: 'approved_pma', evidenceType: 'openfda' }])).toBe(null)
  })

  it('never selects withdrawn as the furthest stage', () => {
    const best = furthestStage([
      { stage: 'withdrawn', evidenceType: 'openfda', evidenceId: 'K1' },
      { stage: 'feasibility', evidenceType: 'clinicaltrials_gov', evidenceId: 'NCT2' },
    ])
    expect(best.stage).toBe('feasibility')
  })

  it('orders the ladder the way the SQL function does', () => {
    expect(STAGE_RANK.first_in_human).toBeLessThan(STAGE_RANK.feasibility)
    expect(STAGE_RANK.feasibility).toBeLessThan(STAGE_RANK.pivotal)
    expect(STAGE_RANK.pivotal).toBeLessThan(STAGE_RANK.cleared_510k)
    expect(STAGE_RANK.cleared_510k).toBeLessThan(STAGE_RANK.approved_pma)
    expect(STAGE_RANK.approved_pma).toBeLessThan(STAGE_RANK.commercial)
  })
})
