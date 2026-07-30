import { describe, it, expect } from 'vitest'
import {
  compose, researchPaths, trialPaths, recencyFactor, tagsFor, horizonFor,
  EVIDENCE_MULTIPLIER, DESIGN_MULTIPLIER, RECENCY_HALF_LIFE_YEARS,
} from './compose.js'

const research = over => ({ entity_type: 'research', evidence_grade: 'demonstrated', ...over })
const trial = over => ({ entity_type: 'trial', evidence_grade: 'decisive', ...over })

describe('composition never sums, per spec 2 and 6', () => {
  it('takes the MAX of the two paths, not their total', () => {
    const s = research({ FD: 2, LV: 4, TR: 0 })
    const p = researchPaths(s)
    expect(p.frontier).toBeCloseTo(2 * (1 + 0.25 * 4), 6)   // 4.0
    expect(p.leverage).toBeCloseTo(4 * 1, 6)                // 4.0
    const out = compose(s)
    expect(out.base).toBeCloseTo(4.0, 6)
    expect(out.base).not.toBeCloseTo(p.frontier + p.leverage, 6)
  })

  it('lets a pure leverage item rank with FD 0', () => {
    // Spec 6's whole reason for the second path: an encapsulation result or a
    // reimbursement decision has no frontier delta and must still rank.
    const out = compose(research({ FD: 0, LV: 4, TR: 3 }))
    expect(out.base).toBeCloseTo(4 * (1 + 0.20 * 3), 6)
    expect(out.path_taken).toBe('leverage')
    expect(out.potential_impact).toBeGreaterThan(0)
  })

  it('lets a gate-path trial rank with GAP 0', () => {
    const out = compose(trial({ GAP: 0, GATE: 4, METH: 1 }))
    expect(out.path_taken).toBe('gate')
    expect(out.base).toBeCloseTo(4 * (1 + 0.20 * 1), 6)
  })

  it('records which path produced the base', () => {
    expect(compose(research({ FD: 4, LV: 0, TR: 0 })).path_taken).toBe('frontier')
    expect(compose(research({ FD: 0, LV: 2, TR: 0 })).path_taken).toBe('leverage')
    expect(compose(trial({ GAP: 4, GATE: 0, METH: 0 })).path_taken).toBe('gap')
  })

  it('breaks a tie deterministically so the path split stays readable', () => {
    const a = compose(research({ FD: 2, LV: 4, TR: 0 })).path_taken
    const b = compose(research({ FD: 2, LV: 4, TR: 0 })).path_taken
    expect(a).toBe(b)
  })

  it('accepts dimensions as objects or bare numbers', () => {
    expect(compose(research({ FD: { score: 3 }, LV: 0, TR: 0 })).base)
      .toBeCloseTo(compose(research({ FD: 3, LV: 0, TR: 0 })).base, 6)
  })
})

describe('the evidence multiplier suppresses, per spec 5.3', () => {
  it('applies the standard table to research', () => {
    const claim = compose(research({ FD: 4, LV: 0, TR: 0, evidence_grade: 'claimed-only' }))
    const demo = compose(research({ FD: 4, LV: 0, TR: 0, evidence_grade: 'demonstrated' }))
    expect(claim.multiplier).toBe(EVIDENCE_MULTIPLIER['claimed-only'])
    expect(claim.potential_impact).toBeCloseTo(demo.potential_impact * 0.40, 6)
  })

  it('applies the design-quality table to trials', () => {
    const out = compose(trial({ GAP: 4, GATE: 0, METH: 0, evidence_grade: 'indicative' }))
    expect(out.multiplier).toBe(DESIGN_MULTIPLIER.indicative)
  })

  it('gates a contradicted item out entirely rather than scaling it', () => {
    const out = compose(research({ FD: 4, LV: 4, TR: 4, evidence_grade: 'contradicted' }))
    expect(out.potential_impact).toBe(0)
    expect(out.gated).toBe('CONTRADICTED')
  })

  it('does not silently treat an unknown grade as full credit', () => {
    // A grade we could not determine must not score like a demonstrated one.
    const out = compose(research({ FD: 4, LV: 0, TR: 0, evidence_grade: 'who knows' }))
    expect(out.multiplier).toBe(0.40)
  })

  it('keeps a claimed-only item below a demonstrated one at every dimension level', () => {
    for (const fd of [1, 2, 3, 4]) {
      const claimed = compose(research({ FD: fd, LV: 0, TR: 0, evidence_grade: 'claimed-only' }))
      const shown = compose(research({ FD: fd, LV: 0, TR: 0, evidence_grade: 'demonstrated' }))
      expect(claimed.potential_impact).toBeLessThan(shown.potential_impact)
    }
  })
})

describe('recency is gentle and its own constant', () => {
  it('is far gentler than the Feed curves it must not share', () => {
    // Feed: 3-day half-life for news, 180-day for research (scripts/refresh.js).
    expect(RECENCY_HALF_LIFE_YEARS).toBeGreaterThanOrEqual(4)
  })

  it('halves at exactly the half-life', () => {
    const asOf = '2026-01-01'
    const sixYearsBack = '2020-01-01'
    expect(recencyFactor(sixYearsBack, asOf)).toBeCloseTo(0.5, 2)
  })

  it('is 1 for an item with no date rather than 0', () => {
    // A missing date must not silently zero an item's score.
    expect(recencyFactor(null)).toBe(1)
    expect(recencyFactor('not a date')).toBe(1)
  })

  it('does not exceed 1 for a future date', () => {
    expect(recencyFactor('2030-01-01', '2026-01-01')).toBe(1)
  })

  it('evaluates as of a given date, which is what a retro-holdout needs', () => {
    // Phase 5 scores a 2017 item as of 2019, not as of today.
    const asOf2019 = recencyFactor('2017-01-01', '2019-01-01')
    const asOfNow = recencyFactor('2017-01-01', '2026-01-01')
    expect(asOf2019).toBeGreaterThan(asOfNow)
  })

  it('still leaves an old record ranking, since the premise is slow recognition', () => {
    const out = compose(research({ FD: 4, LV: 0, TR: 0, recency_date: '2014-01-01' }), { asOf: '2026-01-01' })
    expect(out.potential_impact).toBeGreaterThan(0.5)
  })
})

describe('tags are a closed set derived deterministically, spec 9.2', () => {
  it.each([
    [{ FD: 2 }, 'Extends a field record'],
    [{ FD: 3 }, 'Opens a new direction'],
    [{ LV: 3 }, 'Removes a known bottleneck'],
    [{ TR: 3 }, 'Broadly applicable method'],
    [{ GAP: 3 }, 'Answers an open question'],
    [{ GATE: 3 }, 'Gates approval for a device class'],
    [{ METH: 3 }, 'Sets trial methodology'],
    [{ translational_distance: 2 }, 'First in humans'],
    [{ translational_distance: 4 }, 'In clinical use'],
    [{ evidence_grade: 'claimed-only' }, 'No data released'],
    [{ evidence_grade: 'announced-only' }, 'No data released'],
    [{ evidence_grade: 'partial' }, 'Limited detail disclosed'],
    [{ flags: ['industry_sponsored'] }, 'Industry sponsored'],
  ])('%o yields %s', (score, tag) => {
    expect(tagsFor(score)).toContain(tag)
  })

  it('never emits a number or a dimension name', () => {
    const tags = tagsFor({ FD: 4, LV: 4, TR: 4, translational_distance: 4, evidence_grade: 'partial' })
    for (const t of tags) {
      expect(t).not.toMatch(/\d/)
      expect(t).not.toMatch(/\b(FD|LV|TR|GAP|GATE|METH|score|rubric)\b/i)
    }
  })

  it('emits nothing for an item that earned nothing', () => {
    expect(tagsFor({ FD: 0, LV: 0, TR: 0, evidence_grade: 'demonstrated' })).toEqual([])
  })

  it('shows the disclosure tag on a high-scoring claim', () => {
    // The point of the disclosure tags: a user must be able to see when a
    // highly ranked item ranks on a claim rather than on data.
    expect(tagsFor({ FD: 4, evidence_grade: 'claimed-only' }))
      .toEqual(expect.arrayContaining(['Opens a new direction', 'No data released']))
  })
})

describe('horizon, spec 9.2', () => {
  it.each([[4, 'near'], [3, 'near'], [2, 'medium'], [1, 'long'], [0, 'long']])(
    'TD %i is %s', (td, want) => { expect(horizonFor(td)).toBe(want) })

  it('is null when translational distance is unknown', () => {
    expect(horizonFor(undefined)).toBeNull()
  })
})

describe('trial paths', () => {
  it('weights GATE and METH into the gap path as spec 6 states', () => {
    const p = trialPaths({ GAP: 2, GATE: 3, METH: 4 })
    expect(p.gap).toBeCloseTo(2 * (1 + 0.25 * 3 + 0.20 * 4), 6)
    expect(p.gate).toBeCloseTo(3 * (1 + 0.20 * 4), 6)
  })
})
