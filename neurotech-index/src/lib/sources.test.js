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
  // There is one ordering: significance. The Sort control that offered a date
  // ordering beside it was taken off the front page on 29 Aug 2026, and the
  // second ordering went with it — see rankLead in sources.js.
  it('leads with the most significant item, not the freshest', () => {
    const old = item({ id: 'old', published_at: '2026-02-28T00:00:00Z', metadata: { rankScore: 99 } })
    const fresh = item({ id: 'fresh', published_at: '2026-07-31T00:00:00Z' })
    expect(pickLead([old, fresh]).id).toBe('old')
  })

  it('keeps the reputable-source floor above the score', () => {
    const aggregator = item({ id: 'wire', entry_type: 'news', source: 'ScienceDaily', metadata: { rankScore: 99 } })
    const journal = item({ id: 'journal', metadata: { rankScore: 1 } })
    expect(pickLead([aggregator, journal]).id).toBe('journal')
  })

  it('falls back to the whole list when nothing is reputable', () => {
    const a = item({ id: 'wire-a', entry_type: 'news', source: 'ScienceDaily', metadata: { rankScore: 1 } })
    const b = item({ id: 'wire-b', entry_type: 'news', source: 'ScienceDaily', metadata: { rankScore: 99 } })
    expect(pickLead([a, b]).id).toBe('wire-b')
  })

  it('returns undefined for an empty or missing list', () => {
    expect(pickLead([])).toBeUndefined()
    expect(pickLead(undefined)).toBeUndefined()
  })

  it('does not mutate the list it is given', () => {
    const list = [item({ id: 'a', published_at: '2026-02-28T00:00:00Z' }), item({ id: 'b', published_at: '2026-07-31T00:00:00Z' })]
    pickLead(list)
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
  const shot = (over = {}) =>
    ({ metadata: { image: 'a.jpg', imageSubject: 'item', imageW: 1600, imageH: 1200, ...over } })

  it('is true for a photograph of the record, big enough for the frame', () => {
    expect(hasRealImage(shot())).toBe(true)
  })

  // The kinds the pipeline writes today. 'real' was the first vocabulary and
  // reads as an item photograph; 'motif' and 'stock' were never pictures.
  it('accepts the pipeline\'s current and original vocabularies alike', () => {
    expect(hasRealImage(shot({ imageKind: 'photo' }))).toBe(true)
    expect(hasRealImage(shot({ imageKind: 'figure' }))).toBe(true)
    expect(hasRealImage(shot({ imageKind: 'real' }))).toBe(true)
    expect(hasRealImage(shot({ imageKind: 'motif' }))).toBe(false)
    expect(hasRealImage(shot({ imageKind: 'stock' }))).toBe(false)
    expect(hasRealImage(shot({ imageKind: 'logo' }))).toBe(false)
  })

  it('is false for anything the home page would not run', () => {
    expect(hasRealImage(shot({ imageSubject: 'class' }))).toBe(false)   // not of this record
    expect(hasRealImage(shot({ imageW: 600, imageH: 450 }))).toBe(false) // too small
    expect(hasRealImage({ metadata: {} })).toBe(false)
    expect(hasRealImage(undefined)).toBe(false)
  })
})
