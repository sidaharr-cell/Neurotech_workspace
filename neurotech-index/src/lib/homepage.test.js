import { describe, it, expect } from 'vitest'
import { SLOTS, MAX_ITEMS, STORY_SLOTS, composeStories, shownKeys, pickNotable } from './homepage'
import notable from '../data/notable.json'

const story = (over = {}) => ({
  id: over.id,
  entry_type: 'paper',
  title: over.title || `Story ${over.id}`,
  summary: 'Cortical electrode array, neural decoding.',
  published_at: '2026-07-01T00:00:00Z',
  ...over,
  metadata: { rankScore: 0, ...over.metadata },
})

const photo = (id, w = 1200, h = 800, over = {}) =>
  story({ id, ...over, metadata: { imageKind: 'real', image: `https://x/${id}.jpg`, imageW: w, imageH: h, ...over.metadata } })

describe('the page budget', () => {
  it('holds thirty-two items', () => {
    expect(MAX_ITEMS).toBe(32)
  })

  it('spends the budget on stories and on the other entity types', () => {
    expect(STORY_SLOTS).toBe(16)
    expect(SLOTS.trials + SLOTS.clearances + SLOTS.funding + SLOTS.notable).toBe(16)
  })
})

describe('composeStories', () => {
  const many = Array.from({ length: 40 }, (_, i) => story({ id: `s${i}`, metadata: { rankScore: 100 - i } }))

  it('never fills more slots than the budget allows', () => {
    const { lead, sidebar, featured, latest } = composeStories(many, 'relevant')
    expect(lead).toBeTruthy()
    expect(sidebar).toHaveLength(SLOTS.sidebar)
    expect(featured).toHaveLength(SLOTS.featured)
    expect(latest).toHaveLength(SLOTS.latest)
    expect(1 + sidebar.length + featured.length + latest.length).toBe(STORY_SLOTS)
  })

  it('shows no story twice', () => {
    const { lead, sidebar, featured, latest } = composeStories(many, 'relevant')
    const ids = [lead, ...sidebar, ...featured, ...latest].map(i => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives the featured slots to photographs, largest first', () => {
    const items = [
      // The lead takes a picture-bearing story, so the fixture gives it one
      // outright; what is under test here is the order of what follows.
      photo('lead', 1600, 1000, { metadata: { rankScore: 100 } }),
      story({ id: 'plain-a', metadata: { rankScore: 90 } }),
      photo('small', 700, 400, { metadata: { rankScore: 10 } }),
      photo('large', 2000, 1200, { metadata: { rankScore: 5 } }),
    ]
    const { lead, featured } = composeStories(items, 'relevant')
    expect(lead.id).toBe('lead')
    expect(featured.map(i => i.id).slice(0, 2)).toEqual(['large', 'small'])
  })

  it('keeps date order under newest rather than reordering by image size', () => {
    const items = [
      photo('newer', 700, 400, { published_at: '2026-07-31T00:00:00Z' }),
      photo('older', 2000, 1200, { published_at: '2026-01-01T00:00:00Z' }),
      photo('lead', 1600, 1000, { published_at: '2026-08-01T00:00:00Z' }),
    ]
    const { lead, featured } = composeStories(items, 'newest')
    expect(lead.id).toBe('lead')
    expect(featured.map(i => i.id)).toEqual(['newer', 'older'])
  })

  it('returns empty slots rather than throwing on an empty feed', () => {
    const { lead, sidebar, featured, latest } = composeStories([], 'relevant')
    expect(lead).toBeUndefined()
    expect([...sidebar, ...featured, ...latest]).toHaveLength(0)
  })
})

describe('pickNotable', () => {
  const papers = [
    { doi: '10.1/AAA', title: 'Deep brain stimulation in Parkinson disease', pctile: 0.99 },
    { doi: '10.1/bbb', title: 'Speech decoding from cortex', pctile: 0.98 },
    { doi: null, title: 'A third paper', pctile: 0.97 },
  ]

  it('drops a paper the feed above already ran, matching the DOI case-insensitively', () => {
    const exclude = shownKeys([{ metadata: { doi: '10.1/aaa' } }])
    expect(pickNotable(papers, exclude).map(p => p.title)).toEqual(['Speech decoding from cortex', 'A third paper'])
  })

  it('drops a paper matched by title when no DOI is carried', () => {
    const exclude = shownKeys([{ title: 'Speech decoding from cortex!' }])
    expect(pickNotable(papers, exclude).map(p => p.doi)).toEqual(['10.1/AAA', null])
  })

  it('caps the section at its slots', () => {
    const long = Array.from({ length: 10 }, (_, i) => ({ doi: `10.1/${i}`, title: `P${i}`, pctile: 0.9 }))
    expect(pickNotable(long, new Set())).toHaveLength(SLOTS.notable)
  })
})

describe('the lead always carries a picture', () => {
  const withImage = (id, url, over = {}) => story({
    id,
    ...over,
    metadata: { rankScore: over.rank ?? 50, image: url, imageSubject: 'item', imageW: 1280, imageH: 960 },
  })
  const noImage = (id, rank) => story({ id, metadata: { rankScore: rank } })

  it('passes over a higher-ranked story that cannot fill the slot', () => {
    const { lead } = composeStories([noImage('top', 99), withImage('second', 'https://x/a.jpg', { rank: 80 })], 'relevant')
    expect(lead.id).toBe('second')
  })

  it('still leads with the best story when none has a picture', () => {
    const { lead } = composeStories([noImage('top', 99), noImage('next', 80)], 'relevant')
    expect(lead.id).toBe('top')
  })

  it('will not lead on an illustration too small for the slot', () => {
    const small = story({ id: 'small', metadata: { rankScore: 99, image: 'https://x/s.jpg', imageSubject: 'class', imageW: 700, imageH: 500 } })
    const big = withImage('big', 'https://x/b.jpg', { rank: 10 })
    expect(composeStories([small, big], 'relevant').lead.id).toBe('big')
  })
})

// The rail is a neurotech rail before it is an impact rail. A field percentile
// ranks a paper among its own kind and says nothing about which kind that is,
// so citation impact alone once put a zebrafish morphogenesis paper on the
// front page under "Top 1%". scripts/refresh.js now scores every rail entry for
// neurotech centrality and admits nothing below the floor; this is the check
// that the committed file still obeys it, since the file is what the page reads.
describe('the notable rail carries only neurotech', () => {
  const FLOOR = 5   // RELEVANCE_FLOOR in scripts/refresh.js

  it('records the topic judgement that admitted each paper', () => {
    for (const p of notable) {
      expect(typeof p.relevance, `${p.title} has no relevance score`).toBe('number')
    }
  })

  it('holds nothing the classifier called off-topic', () => {
    const offTopic = notable.filter(p => p.relevance < FLOOR).map(p => `${p.relevance}: ${p.title}`)
    expect(offTopic).toEqual([])
  })
})
