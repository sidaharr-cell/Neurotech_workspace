import { describe, it, expect } from 'vitest'
import { FLAGS, isFlagged } from './flags.js'

describe('the potential-impact default is gated by more than an env var', () => {
  it('is hard-coded false while Phase 5 has not passed', () => {
    // Spec 5 is blocking: "Do not ship as a default sort until this passes."
    // docs/potential-impact-phase5-result.md records three failed runs. Making
    // this true requires editing flags.js, which forces the change through
    // review rather than through a dashboard setting.
    expect(FLAGS.POTENTIAL_IMPACT_DEFAULT).toBe(false)
  })

  it('cannot be turned on by an environment variable', () => {
    // Guards against someone adding an env read here later and shipping an
    // unvalidated ordering to every user by changing a deploy setting.
    const src = String(FLAGS.POTENTIAL_IMPACT_DEFAULT)
    expect(src).toBe('false')
  })
})

describe('offering the sort is a separate gate from defaulting to it', () => {
  it('exposes both flags independently', () => {
    expect(Object.keys(FLAGS)).toEqual(
      expect.arrayContaining(['POTENTIAL_IMPACT', 'POTENTIAL_IMPACT_DEFAULT', 'IMPACT_INSPECTOR']))
  })

  it('reports unknown flags as off rather than throwing', () => {
    expect(isFlagged('NOT_A_FLAG')).toBe(false)
  })

  it('resolves every flag to a boolean', () => {
    for (const [k, v] of Object.entries(FLAGS)) expect(typeof v, k).toBe('boolean')
  })
})
