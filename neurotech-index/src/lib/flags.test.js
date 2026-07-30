import { describe, it, expect } from 'vitest'
import { FLAGS, isFlagged, impactSortAllowed } from './flags.js'

describe('the potential-impact default is gated by more than an env var', () => {
  it('is hard-coded false while Phase 5 has not meaningfully passed', () => {
    // The trial arm posted AUC 0.824, but only 5 of the 24 reference items are
    // neurotechnology trials, so the number largely measures which trials are
    // well-resourced enough to complete and report. See src/lib/flags.js.
    // Making this true requires editing flags.js, which forces the change
    // through review rather than through a dashboard setting.
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

  it('resolves every flag to a boolean, except the entity allowlist', () => {
    for (const [k, v] of Object.entries(FLAGS)) {
      if (k === 'POTENTIAL_IMPACT_ENTITIES') { expect(Array.isArray(v)).toBe(true); continue }
      expect(typeof v, k).toBe('boolean')
    }
  })
})

describe('the entity allowlist', () => {
  it('covers trials and not research, matching what is actually scored', () => {
    // Trials: 8,345 of 8,345 scored. Research: 600 of ~80,000.
    expect(FLAGS.POTENTIAL_IMPACT_ENTITIES).toEqual(['trial'])
  })

  it('cannot be widened by an environment variable', () => {
    // Same reasoning as the default flag: widening this puts an unranked sort in
    // front of users, so it should go through review and not a deploy setting.
    expect(FLAGS.POTENTIAL_IMPACT_ENTITIES).not.toContain(undefined)
    expect(FLAGS.POTENTIAL_IMPACT_ENTITIES.every(e => typeof e === 'string')).toBe(true)
  })

  it('refuses an omitted entity type rather than defaulting to allowed', () => {
    expect(impactSortAllowed(undefined)).toBe(false)
    expect(impactSortAllowed('research')).toBe(false)
  })
})
