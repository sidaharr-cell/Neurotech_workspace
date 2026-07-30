import { describe, it, expect } from 'vitest'
import { withPotentialImpact, SORT_POTENTIAL_IMPACT, SORT_SIGNIF, HORIZON } from './Filters.jsx'
import { FLAGS } from '../lib/flags.js'

describe('the potential-impact sort is never the default by position', () => {
  it('appends rather than prepends when the flag is on', () => {
    // Spec 11 blocks it as a DEFAULT sort until Phase 5 passes. A sort list is
    // rendered in order and the first entry is what a tab lands on, so putting
    // it first would make it the default even with the default flag off.
    const out = withPotentialImpact(SORT_SIGNIF)
    if (FLAGS.POTENTIAL_IMPACT) {
      expect(out[0]).not.toEqual(SORT_POTENTIAL_IMPACT)
      expect(out[out.length - 1]).toEqual(SORT_POTENTIAL_IMPACT)
    } else {
      expect(out).toEqual(SORT_SIGNIF)
    }
  })

  it('leaves the original list untouched', () => {
    const before = [...SORT_SIGNIF]
    withPotentialImpact(SORT_SIGNIF)
    expect(SORT_SIGNIF).toEqual(before)
  })

  it('carries no rubric vocabulary in its label', () => {
    // Spec 9.1: no dimension names, no rubric terms in the interface.
    expect(SORT_POTENTIAL_IMPACT.label).not.toMatch(/\b(FD|LV|TR|GAP|GATE|METH|score|rubric|frontier delta)\b/i)
  })
})

describe('the horizon toggle', () => {
  it('offers exactly the three bands spec 9.2 defines', () => {
    expect(HORIZON.map(h => h.id)).toEqual(['near', 'medium', 'long'])
  })

  it('uses no numbers, since translational distance is internal', () => {
    for (const h of HORIZON) expect(h.label).not.toMatch(/\d/)
  })
})
