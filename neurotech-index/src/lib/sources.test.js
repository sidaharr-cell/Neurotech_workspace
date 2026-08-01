import { describe, it, expect } from 'vitest'
import { pickLead, isReputableSource, hasRealImage } from './sources'

const item = (over = {}) => ({
  id: over.id,
  entry_type: 'paper',
  title: 'A brain-computer interface for speech decoding',
  summary: 'Cortical electrode array, neural decoding.',
  published_at: '2026-02-28T00:00:00Z',
  ...over,
  metadata: { rankScore: 0, ...over.metadata },
})

describe('pickLead', () => {
  it('leads with the newest item when sorted by newest', () => {
    const old = item({ id: 'old', published_at: '2026-02-28T00:00:00Z', metadata: { rankScore: 99 } })
    const fresh = item({ id: 'fresh', published_at: '2026-07-31T00:00:00Z' })
    expect(pickLead([old, fresh], 'newest').id).toBe('fresh')
  })

  it('leads with the most significant item when sorted by relevance', () => {
    const old = item({ id: 'old', published_at: '2026-02-28T00:00:00Z', metadata: { rankScore: 99 } })
    const fresh = item({ id: 'fresh', published_at: '2026-07-31T00:00:00Z' })
    expect(pickLead([old, fresh], 'relevant').id).toBe('old')
  })

  it('defaults to significance when no sort is given', () => {
    const old = item({ id: 'old', metadata: { rankScore: 99 } })
    const fresh = item({ id: 'fresh', published_at: '2026-07-31T00:00:00Z' })
    expect(pickLead([old, fresh]).id).toBe('old')
  })

  it('keeps the reputable-source floor under newest', () => {
    const aggregator = item({ id: 'wire', entry_type: 'news', source: 'ScienceDaily', published_at: '2026-07-31T00:00:00Z' })
    const journal = item({ id: 'journal', published_at: '2026-07-30T00:00:00Z' })
    expect(pickLead([aggregator, journal], 'newest').id).toBe('journal')
  })

  it('falls back to the whole list when nothing is reputable', () => {
    const a = item({ id: 'wire-a', entry_type: 'news', source: 'ScienceDaily', published_at: '2026-07-20T00:00:00Z' })
    const b = item({ id: 'wire-b', entry_type: 'news', source: 'ScienceDaily', published_at: '2026-07-31T00:00:00Z' })
    expect(pickLead([a, b], 'newest').id).toBe('wire-b')
  })

  it('sorts undated items last rather than leading with them', () => {
    const undated = item({ id: 'undated', published_at: null })
    const dated = item({ id: 'dated', published_at: '2026-07-31T00:00:00Z' })
    expect(pickLead([undated, dated], 'newest').id).toBe('dated')
  })

  it('returns undefined for an empty or missing list', () => {
    expect(pickLead([], 'newest')).toBeUndefined()
    expect(pickLead(undefined, 'newest')).toBeUndefined()
  })

  it('does not mutate the list it is given', () => {
    const list = [item({ id: 'a', published_at: '2026-02-28T00:00:00Z' }), item({ id: 'b', published_at: '2026-07-31T00:00:00Z' })]
    pickLead(list, 'newest')
    expect(list.map(i => i.id)).toEqual(['a', 'b'])
  })
})

describe('isReputableSource', () => {
  it('accepts papers and preprints on entry type alone', () => {
    expect(isReputableSource({ entry_type: 'paper' })).toBe(true)
    expect(isReputableSource({ entry_type: 'preprint' })).toBe(true)
  })

  it('accepts allow-listed news outlets and rejects the rest', () => {
    expect(isReputableSource({ entry_type: 'news', source: 'IEEE Spectrum' })).toBe(true)
    expect(isReputableSource({ entry_type: 'news', source: 'ScienceDaily' })).toBe(false)
    expect(isReputableSource(null)).toBe(false)
  })
})

describe('hasRealImage', () => {
  it('is true only for a real photograph', () => {
    expect(hasRealImage({ metadata: { image: 'a.jpg', imageKind: 'real' } })).toBe(true)
    expect(hasRealImage({ metadata: { image: 'a.jpg', imageKind: 'motif' } })).toBe(false)
    expect(hasRealImage({ metadata: {} })).toBe(false)
    expect(hasRealImage(undefined)).toBe(false)
  })
})
