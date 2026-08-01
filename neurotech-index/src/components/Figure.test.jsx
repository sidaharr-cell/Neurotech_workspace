import { describe, it, expect } from 'vitest'
import { phasesOf, clearanceNumber, clearancePathway, hasUsableImage, topPct, trustedPctile } from './Figure'

const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString()

describe('phasesOf', () => {
  it('marks the one phase a trial names', () => {
    expect([...phasesOf('Phase 3')]).toEqual([3])
  })

  it('marks both phases of a straddling trial', () => {
    expect([...phasesOf('Phase 2 / Phase 3')].sort()).toEqual([2, 3])
  })

  it('reads Early Phase 1 as phase 1', () => {
    expect([...phasesOf('Early Phase 1')]).toEqual([1])
  })

  it('marks nothing when the record carries no phase', () => {
    expect(phasesOf('Not Applicable').size).toBe(0)
    expect(phasesOf(null).size).toBe(0)
  })
})

describe('clearance fields', () => {
  it('reads the submission number out of the description line', () => {
    const d = { description: 'Substantially Equivalent · 510(k) K260453 · product code GXY' }
    expect(clearanceNumber(d)).toBe('K260453')
    expect(clearancePathway(d)).toBe('510(k)')
  })

  it('prefers the source id when the record carries one', () => {
    expect(clearanceNumber({ source_id: 'P980001', description: 'K900639' })).toBe('P980001')
  })

  it('names the pathway from the status', () => {
    expect(clearancePathway({ status: 'FDA-approved (PMA)' })).toBe('PMA')
    expect(clearancePathway({ status: 'De Novo granted' })).toBe('De Novo')
  })

  it('returns null rather than guessing when nothing says', () => {
    expect(clearanceNumber({ name: 'A device' })).toBeNull()
    expect(clearancePathway({ name: 'A device' })).toBeNull()
  })
})

describe('hasUsableImage', () => {
  const withImage = kind => ({ metadata: { image: 'https://x/a.jpg', imageKind: kind } })

  it('never shows an image the vision pass called stock', () => {
    expect(hasUsableImage(withImage('stock'))).toBe(false)
  })

  it('shows an unclassified image in an ordinary slot', () => {
    expect(hasUsableImage(withImage(null))).toBe(true)
  })

  it('holds the lead to confirmed photographs', () => {
    expect(hasUsableImage(withImage(null), { requireReal: true })).toBe(false)
    expect(hasUsableImage(withImage('real'), { requireReal: true })).toBe(true)
  })

  it('is false when there is no image at all', () => {
    expect(hasUsableImage({ metadata: {} })).toBe(false)
    expect(hasUsableImage(undefined)).toBe(false)
  })
})

describe('trustedPctile', () => {
  it('shows a percentile once the paper has citations behind it', () => {
    expect(trustedPctile({ metadata: { pctile: 0.99, citationCount: 3 }, published_at: daysAgo(5) })).toBe(0.99)
  })

  it('shows a percentile once the paper is old enough to have been read', () => {
    expect(trustedPctile({ pctile: 0.95, citedBy: 0, publishedAt: daysAgo(90) })).toBe(0.95)
  })

  it('withholds a percentile from a fresh, uncited paper', () => {
    expect(trustedPctile({ metadata: { pctile: 0.99, citationCount: 0 }, published_at: daysAgo(10) })).toBeNull()
  })

  it('is null when the record carries no percentile', () => {
    expect(trustedPctile({ metadata: { citationCount: 40 }, published_at: daysAgo(400) })).toBeNull()
  })
})

describe('topPct', () => {
  it('reads a percentile as the top slice it names', () => {
    expect(topPct(0.99577193)).toBe('Top 1%')
    expect(topPct(0.9)).toBe('Top 10%')
  })
})
