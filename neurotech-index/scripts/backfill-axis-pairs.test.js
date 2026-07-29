import { describe, it, expect } from 'vitest'
import { validatePair, pairId } from './backfill-axis-pairs.js'

const valid = (over = {}) => ({
  subfield: 'INVASIVE_BCI_INTRACORTICAL',
  axis_a: 'channel count, intracortical microelectrode array',
  axis_a_type: 'scale',
  axis_b: 'chronic implantation duration, intracortical Utah array',
  axis_b_type: 'longevity',
  why_binding: 'More penetrating shanks means more tissue disruption, which the field has treated as necessarily shortening chronic viability.',
  strength: 'asserted',
  ...over,
})

const errs = (p, key = 'channels-vs-life') => validatePair(key, p)

describe('a well-formed pair passes', () => {
  it('reports no problems', () => {
    expect(errs(valid())).toEqual([])
  })

  it('defaults strength when omitted', () => {
    expect(errs(valid({ strength: undefined }))).toEqual([])
  })
})

describe('the pair must be a real tradeoff', () => {
  it('rejects an axis paired with itself', () => {
    const a = 'channel count, intracortical microelectrode array'
    expect(errs(valid({ axis_a: a, axis_b: a })).join()).toMatch(/paired with itself/)
  })

  it('rejects a missing axis', () => {
    expect(errs(valid({ axis_b: '' })).join()).toMatch(/axis_b/)
  })

  it('rejects an axis type outside the enum', () => {
    expect(errs(valid({ axis_a_type: 'importance' })).join()).toMatch(/axis_a_type/)
  })

  it('rejects a subfield outside the partition', () => {
    expect(errs(valid({ subfield: 'INVASIVE_BCI' })).join()).toMatch(/SUBFIELD_IDS/)
  })

  it('rejects an unknown strength', () => {
    expect(errs(valid({ strength: 'very' })).join()).toMatch(/strength/)
  })
})

describe('why_binding is what a score of 4 has to cite', () => {
  it('rejects an empty explanation', () => {
    // A 4 MUST state why the tradeoff was binding (spec 5.1.1). An empty
    // why_binding makes the score unciteable, so it cannot be optional.
    expect(errs(valid({ why_binding: undefined })).join()).toMatch(/why_binding/)
  })

  it('rejects a token explanation', () => {
    expect(errs(valid({ why_binding: 'they trade off' })).join()).toMatch(/why_binding/)
  })
})

describe('ids', () => {
  it('is stable for a key', () => {
    expect(pairId('a-vs-b')).toBe(pairId('a-vs-b'))
    expect(pairId('a-vs-b')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('differs between keys', () => {
    expect(pairId('a-vs-b')).not.toBe(pairId('a-vs-c'))
  })
})

describe('keys', () => {
  it('rejects a key that is not a slug', () => {
    expect(errs(valid(), 'Channels VS Life').join()).toMatch(/lowercase slug/)
  })
})
