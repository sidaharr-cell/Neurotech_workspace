import { describe, it, expect } from 'vitest'
import { feedRowToCandidate, NOTABLE_MAX, NOTABLE_PCTILE_MIN, NOTABLE_WINDOW_DAYS } from './notable.js'

// A research row as refresh.js writes it: the impact numbers and the topic
// judgement are already on the row, which is the whole reason the rail can
// sweep the feed without scoring anything again.
const row = (over = {}) => ({
  title: 'Long-term independent use of an intracortical BCI',
  url: 'https://example.org/paper',
  source: 'PubMed',
  published_at: '2026-06-15T00:00:00Z',
  relevance_score: 9,
  ...over,
  metadata: {
    doi: '10.1000/abc',
    pmid: '42631788',
    pctile: 0.994,
    fwci: 7.2,
    citationCount: 6,
    authors: ['A Researcher'],
    journal: 'Nature Medicine',
    significance: 'Why it matters.',
    ...over.metadata,
  },
})

describe('the rail\'s rules', () => {
  it('holds more than the page shows, so the dedup against the feed cannot empty it', () => {
    // src/lib/homepage.js asks for six.
    expect(NOTABLE_MAX).toBeGreaterThan(6)
  })

  it('keeps the top decile and a window wider than the 60 days impact needs to be trusted', () => {
    expect(NOTABLE_PCTILE_MIN).toBe(0.90)
    // A paper cannot clear impactTrusted before day 60. A window at or near
    // that number leaves nothing time to enter the rail AND live on it, which
    // is how the rail drained from nine papers to five in a week.
    expect(NOTABLE_WINDOW_DAYS).toBeGreaterThan(120)
  })
})

describe('feedRowToCandidate', () => {
  it('lifts the impact numbers out of metadata', () => {
    const c = feedRowToCandidate(row())
    expect(c.pctile).toBe(0.994)
    expect(c.fwci).toBe(7.2)
    expect(c.citedBy).toBe(6)
    expect(c.doi).toBe('10.1000/abc')
    expect(c.pmid).toBe('42631788')
  })

  it('carries the stored topic score under the name the rail reads', () => {
    // `relevance`, not `relevance_score`: isOnTopic looks for this one, and a
    // candidate arriving with it null would be given the benefit of the doubt
    // and admitted unjudged.
    expect(feedRowToCandidate(row()).relevance).toBe(9)
    expect(feedRowToCandidate(row({ relevance_score: null })).relevance).toBe(null)
  })

  it('keeps the significance line the run already wrote', () => {
    expect(feedRowToCandidate(row()).significance).toBe('Why it matters.')
    expect(feedRowToCandidate(row({ metadata: { significance: undefined } })).significance).toBe('')
  })

  it('falls back to a DOI link and to the feed source for the venue', () => {
    const c = feedRowToCandidate(row({ url: null, metadata: { journal: null } }))
    expect(c.url).toBe('https://doi.org/10.1000/abc')
    expect(c.journal).toBe('PubMed')
  })

  it('refuses a row with nothing to key on', () => {
    // The rail keys on doi/pmid/url; a row with no identifier would collide
    // with every other such row in the merge map.
    expect(feedRowToCandidate(row({ metadata: { doi: null, pmid: null } }))).toBe(null)
    expect(feedRowToCandidate(row({ title: '' }))).toBe(null)
    expect(feedRowToCandidate(null)).toBe(null)
  })

  it('defaults a missing citation count to zero rather than undefined', () => {
    // impactTrusted does arithmetic on this; undefined would make the
    // comparison false in a way that reads as "not cited" by luck.
    expect(feedRowToCandidate(row({ metadata: { citationCount: undefined } })).citedBy).toBe(0)
  })
})
