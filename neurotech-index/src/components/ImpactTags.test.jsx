import { describe, it, expect } from 'vitest'
import { withPotentialImpact, SORT_POTENTIAL_IMPACT, SORT_SIGNIF, HORIZON } from './Filters.jsx'
import { FLAGS } from '../lib/flags.js'

describe('the potential-impact sort is never the default by position', () => {
  it('appends rather than prepends when the flag is on', () => {
    // A sort list renders in order and the first entry is what a tab lands on,
    // so putting it first would make it the default even with the default flag
    // off. Spec 11 keeps those two decisions separate.
    const out = withPotentialImpact(SORT_SIGNIF, 'trial')
    if (FLAGS.POTENTIAL_IMPACT) {
      expect(out[0]).not.toEqual(SORT_POTENTIAL_IMPACT)
      expect(out[out.length - 1]).toEqual(SORT_POTENTIAL_IMPACT)
    } else {
      expect(out).toEqual(SORT_SIGNIF)
    }
  })

  it('leaves the original list untouched', () => {
    const before = [...SORT_SIGNIF]
    withPotentialImpact(SORT_SIGNIF, 'trial')
    expect(SORT_SIGNIF).toEqual(before)
  })
})

describe('the sort is offered only where the corpus is actually scored', () => {
  it('offers it on trials, whose whole corpus is scored', () => {
    const out = withPotentialImpact(SORT_SIGNIF, 'trial')
    if (FLAGS.POTENTIAL_IMPACT) expect(out).toContain(SORT_POTENTIAL_IMPACT)
  })

  it('withholds it from research, where 600 of ~80,000 papers are scored', () => {
    // Not a rubric judgement. Offering a sort over 417 ranked items and 79,000
    // ties would imply an ordering that has never been computed. This unblocks
    // by scoring the corpus, not by editing this test.
    expect(withPotentialImpact(SORT_SIGNIF, 'research')).toEqual(SORT_SIGNIF)
  })

  it('withholds it from devices and from an unknown or missing type', () => {
    for (const t of ['device', 'feed', 'organization', undefined, null, '']) {
      expect(withPotentialImpact(SORT_SIGNIF, t)).toEqual(SORT_SIGNIF)
    }
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
