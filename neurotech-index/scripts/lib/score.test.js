import { describe, it, expect } from 'vitest'
import {
  buildPrompt, applyCeilings, SCORING_TOOL, RESEARCH_RUBRIC, TRIAL_RUBRIC,
  parseToolScores, firstJsonObject,
} from './score.js'

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

describe('tool-output salvage, from the shape a live run actually produced', () => {
  // Verbatim shape observed in the first Phase 4 run: FD arrived as a string
  // holding the rest of the object, with literal <parameter> markers.
  const folded = '{"score": 2, "justification": "Moves a record.", "referent": "62 wpm"}\n'
    + '<parameter name="LV">{"score": 1, "justification": "Local only.", "referent": "own rig"}\n'
    + '<parameter name="TR">{"score": 0, "justification": "Specific.", "referent": "one dataset"}\n'
    + '<parameter name="translational_distance">2'

  it('recovers the leading dimension object', () => {
    const { scores } = parseToolScores({ FD: folded }, ['FD', 'LV', 'TR'])
    expect(scores.FD).toMatchObject({ score: 2, referent: '62 wpm' })
  })

  it('recovers the siblings folded into the same string', () => {
    const { scores, recovered } = parseToolScores({ FD: folded }, ['FD', 'LV', 'TR'])
    expect(recovered).toBe(true)
    expect(scores.LV.score).toBe(1)
    expect(scores.TR.score).toBe(0)
    expect(scores.translational_distance).toBe(2)
  })

  it('reports nothing malformed once recovery succeeds', () => {
    expect(parseToolScores({ FD: folded }, ['FD', 'LV', 'TR']).malformed).toEqual([])
  })

  it('passes a well-formed payload through untouched', () => {
    const good = { FD: { score: 3, referent: 'x' }, LV: { score: 0, referent: '' }, TR: { score: 1, referent: 'y' } }
    const { scores, recovered, malformed } = parseToolScores(good, ['FD', 'LV', 'TR'])
    expect(recovered).toBe(false)
    expect(malformed).toEqual([])
    expect(scores.FD.score).toBe(3)
  })

  it('REFUSES what it cannot recover rather than letting it score zero', () => {
    // The bug this exists for: a string that yields no object read as .score
    // undefined, composed to 0, and 8 of 48 items silently scored zero.
    const { malformed } = parseToolScores({ FD: 'not json at all', LV: { score: 1, referent: 'a' }, TR: { score: 1, referent: 'b' } }, ['FD', 'LV', 'TR'])
    expect(malformed).toEqual(['FD'])
  })

  it('refuses a dimension with a non-integer or out-of-range score', () => {
    expect(parseToolScores({ FD: { score: '2' } }, ['FD']).malformed).toEqual(['FD'])
    expect(parseToolScores({ FD: { score: 7 } }, ['FD']).malformed).toEqual(['FD'])
    expect(parseToolScores({ FD: { score: -1 } }, ['FD']).malformed).toEqual(['FD'])
    expect(parseToolScores({ FD: {} }, ['FD']).malformed).toEqual(['FD'])
  })

  it('accepts a legitimate zero, which is a real verdict', () => {
    expect(parseToolScores({ FD: { score: 0, referent: '' } }, ['FD']).malformed).toEqual([])
  })

  it('is not fooled by braces inside strings', () => {
    const s = '{"score": 1, "referent": "the set {a, b} was used"}'
    expect(firstJsonObject(s).referent).toBe('the set {a, b} was used')
  })

  it('handles escaped quotes', () => {
    expect(firstJsonObject('{"referent": "he said \\"hi\\"", "score": 1}').score).toBe(1)
  })
})

describe('scalar fields get the same salvage as the dimension blocks', () => {
  // A retro run died storing `invalid input syntax for type integer:
  // "2, "comment": "n/a""` because only the dimensions were validated.
  const dims = ['FD', 'LV', 'TR']
  const ok = { FD: { score: 1, referent: 'a' }, LV: { score: 1, referent: 'b' }, TR: { score: 1, referent: 'c' } }

  it('parses a translational_distance with folded junk appended', () => {
    const { scores } = parseToolScores({ ...ok, translational_distance: '2, "comment": "n/a"' }, dims)
    expect(scores.translational_distance).toBe(2)
  })

  it('nulls an unrecoverable translational_distance instead of storing it', () => {
    for (const v of ['n/a', null, undefined, {}, 9, -1]) {
      expect(parseToolScores({ ...ok, translational_distance: v }, dims).scores.translational_distance).toBeNull()
    }
  })

  it('keeps a clean integer untouched', () => {
    expect(parseToolScores({ ...ok, translational_distance: 3 }, dims).scores.translational_distance).toBe(3)
  })

  it('nulls a non-string reason and an out-of-enum uncertainty', () => {
    const { scores } = parseToolScores({ ...ok, user_facing_reason: { a: 1 }, uncertainty: 'quite' }, dims)
    expect(scores.user_facing_reason).toBeNull()
    expect(scores.uncertainty).toBeNull()
  })

  it('does not report a scalar problem as a malformed DIMENSION', () => {
    // A bad scalar must not abort the run; a bad dimension must.
    expect(parseToolScores({ ...ok, translational_distance: 'junk' }, dims).malformed).toEqual([])
  })
})
