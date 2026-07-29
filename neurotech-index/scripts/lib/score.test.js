import { describe, it, expect } from 'vitest'
import { buildPrompt, applyCeilings, SCORING_TOOL, RESEARCH_RUBRIC, TRIAL_RUBRIC } from './score.js'

const extraction = {
  claimed: 'Restores speech', demonstrated: 'Decoded 62 wpm',
  quantitative_results: [{ metric: 'rate', value: '62', units: 'wpm' }],
  methods_disclosed: true, artifacts_released: [], constraints_addressed: [],
  rhetorical_markers: ['unprecedented', 'first-ever', 'paradigm-shifting'],
}
const records = [{ id: 'r1', axis: 'decoding rate', axis_type: 'performance', current_value: '58 wpm', confidence: 'single-group' }]
const pairs = [{ axis_a: 'channel count', axis_b: 'chronic viability', why_binding: 'More shanks means more tissue disruption.' }]

describe('the prompt never invites an importance judgement', () => {
  const p = buildPrompt({ extraction, entityType: 'research', records, axisPairs: pairs })

  it('withholds rhetorical markers from the scorer', () => {
    // Spec 2: superlatives are not evidence. Showing them to the model invites
    // the vocabulary matching the whole rebuild exists to remove.
    // NB "breakthrough" is deliberately not asserted on: it appears legitimately
    // in the rubric text ("a breakthrough designation is a precedent"), so
    // asserting its absence would test the rubric rather than the withholding.
    expect(p).not.toContain('rhetorical_markers')
    expect(p).not.toContain('unprecedented')
    expect(p).not.toContain('first-ever')
    expect(p).not.toContain('paradigm-shifting')
  })

  it('includes the records to compare against', () => {
    expect(p).toContain('58 wpm')
    expect(p).toContain('r1')
  })

  it('includes the axis pairs, which is what makes FD 4 reachable', () => {
    expect(p).toContain('chronic viability')
    expect(p).toContain('why binding')
  })

  it('tells the scorer to log records it checked even when none matched', () => {
    expect(p).toMatch(/INCLUDING when none of them matched/)
  })

  it('says an empty record set is expected rather than a failure', () => {
    expect(p).toMatch(/expected and\s*\n?\s*is not a failure/)
  })
})

describe('the ceiling note reflects real coverage', () => {
  it('forbids "opens a new axis" when coverage is thin', () => {
    const p = buildPrompt({ extraction, entityType: 'research', records, fdCeiling: 2 })
    expect(p).toMatch(/capped at 2/)
    expect(p).toMatch(/Do not award "opens a new axis"/)
  })

  it('says nothing extra when coverage is sufficient', () => {
    const p = buildPrompt({ extraction, entityType: 'research', records, fdCeiling: 4 })
    expect(p).not.toMatch(/capped at 2/)
  })

  it('handles an empty record set', () => {
    const p = buildPrompt({ extraction, entityType: 'research', records: [], fdCeiling: 0 })
    expect(p).toContain('(none for this subfield)')
  })
})

describe('trials get the trial rubric and no axis pairs', () => {
  const p = buildPrompt({ extraction, entityType: 'trial', records, axisPairs: pairs })
  it('uses the trial rubric', () => {
    expect(p).toContain('GAP, evidence gap')
    expect(p).not.toContain('FD, frontier delta')
  })
  it('omits axis pairs, which are an FD 4 concept', () => {
    expect(p).not.toContain('chronic viability')
  })
})

describe('the tool gives the model nowhere to put an opinion', () => {
  const props = SCORING_TOOL('research').input_schema.properties
  it('exposes only the rubric dimensions and their evidence', () => {
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['FD', 'LV', 'TR']))
    expect(Object.keys(props)).not.toEqual(expect.arrayContaining(['importance', 'significance', 'rating']))
  })
  it('requires a referent on every dimension', () => {
    for (const d of ['FD', 'LV', 'TR']) expect(props[d].required).toContain('referent')
  })
  it('offers beneficiaries on LV and paired_axes on FD', () => {
    expect(props.LV.properties.beneficiaries).toBeTruthy()
    expect(props.FD.properties.paired_axes).toBeTruthy()
  })
  it('offers unlocks on GATE for trials', () => {
    expect(SCORING_TOOL('trial').input_schema.properties.GATE.properties.unlocks).toBeTruthy()
  })
})

describe('ceilings are applied in code, not negotiated with the model', () => {
  const s = () => ({ FD: { score: 4 }, LV: { score: 3 }, TR: { score: 2 } })

  it('caps FD to the record-coverage ceiling', () => {
    const { scores, capped } = applyCeilings(s(), { fdCeiling: 2 })
    expect(scores.FD.score).toBe(2)
    expect(capped[0]).toMatchObject({ dimension: 'FD', from: 4, to: 2, reason: 'record coverage' })
  })

  it('caps FD to the granularity ceiling when that is lower', () => {
    const { scores, capped } = applyCeilings(s(), { fdCeiling: 4, granularityCap: { FD: 3 } })
    expect(scores.FD.score).toBe(3)
    expect(capped[0].reason).toBe('input granularity')
  })

  it('applies the LOWER of the two ceilings', () => {
    expect(applyCeilings(s(), { fdCeiling: 2, granularityCap: { FD: 3 } }).scores.FD.score).toBe(2)
    expect(applyCeilings(s(), { fdCeiling: 4, granularityCap: { FD: 1 } }).scores.FD.score).toBe(1)
  })

  it('caps METH by granularity for trials', () => {
    const { scores } = applyCeilings({ METH: { score: 4 } }, { granularityCap: { METH: 2 } })
    expect(scores.METH.score).toBe(2)
  })

  it('leaves a score already under the ceiling alone', () => {
    const { scores, capped } = applyCeilings({ FD: { score: 1 } }, { fdCeiling: 4 })
    expect(scores.FD.score).toBe(1)
    expect(capped).toHaveLength(0)
  })

  it('never touches LV or TR, which have no ceiling', () => {
    const { scores } = applyCeilings(s(), { fdCeiling: 0, granularityCap: { FD: 0 } })
    expect(scores.LV.score).toBe(3)
    expect(scores.TR.score).toBe(2)
  })

  it('does not mutate its input', () => {
    const input = s()
    applyCeilings(input, { fdCeiling: 0 })
    expect(input.FD.score).toBe(4)
  })
})

describe('the rubrics carry the MUST conditions from the spec', () => {
  it('FD 4 demands both paired axes', () => {
    expect(RESEARCH_RUBRIC).toMatch(/MUST name both paired axes/)
  })
  it('LV 2 demands a beneficiary other than the authors', () => {
    expect(RESEARCH_RUBRIC).toMatch(/NOT the\s+authors/)
  })
  it('regulatory status routes to LV, not FD', () => {
    expect(RESEARCH_RUBRIC).toMatch(/Regulatory status scores HERE, not in FD/)
  })
  it('GATE 2 demands a specific unlock', () => {
    expect(TRIAL_RUBRIC).toMatch(/MUST name the specific approval/)
  })
})
