import { describe, it, expect } from 'vitest'
import { normTitle, surnameKey, authorSurnames, jaccard, sameWork, chooseCanonical, versionOf } from './dedup'

describe('normTitle', () => {
  it('lowercases, folds accents, and collapses punctuation', () => {
    expect(normTitle('A Closed-Loop, Brain–Computer Interface!')).toBe('a closed loop brain computer interface')
    expect(normTitle('Décoding  Motor   Intent')).toBe('decoding motor intent')
  })
})

describe('surnameKey', () => {
  it('handles "Smith J", "John Smith", and "Smith, John"', () => {
    expect(surnameKey('Smith J')).toBe('smith')
    expect(surnameKey('Smith JA')).toBe('smith')
    expect(surnameKey('John Smith')).toBe('smith')
    expect(surnameKey('Smith, John')).toBe('smith')
    expect(surnameKey('')).toBe('')
  })
})

describe('sameWork', () => {
  const arxiv = { title: 'Decoding motor intent from cortex', authors: ['Smith J', 'Doe A'], source: 'arxiv', arxiv_id: '2401.00001' }
  const pubmed = { title: 'Decoding Motor Intent from Cortex', authors: ['John Smith', 'Alice Doe', 'Bob Roe'], source: 'pubmed', doi: '10.1/x', journal: 'Neuron' }
  const different = { title: 'A totally different paper', authors: ['Smith J'], source: 'pubmed' }
  const sameTitleNoAuthors = { title: 'Decoding motor intent from cortex', authors: [], source: 'pubmed' }

  it('merges the preprint and the published version (same title, overlapping authors)', () => {
    expect(sameWork(arxiv, pubmed)).toBe(true)
  })
  it('merges on a shared DOI regardless of title', () => {
    expect(sameWork({ doi: '10.1/x', title: 'x' }, { doi: '10.1/X', title: 'y' })).toBe(true)
  })
  it('does not merge different papers', () => {
    expect(sameWork(arxiv, different)).toBe(false)
  })
  it('is conservative: same title but no authors on one side => not merged', () => {
    expect(sameWork(arxiv, sameTitleNoAuthors)).toBe(false)
  })
})

describe('jaccard', () => {
  it('is 0 for an empty set and 1 for identical sets', () => {
    expect(jaccard(new Set(), new Set(['a']))).toBe(0)
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1)
  })
})

describe('chooseCanonical', () => {
  it('prefers a peer-reviewed PubMed record with a journal', () => {
    const preprint = { source: 'arxiv', year: '2024' }
    const published = { source: 'pubmed', journal: 'Nature', year: '2023' }
    expect(chooseCanonical([preprint, published])).toBe(published)
  })
  it('falls back to the most recent when no peer-reviewed version exists', () => {
    const older = { source: 'arxiv', year: '2022' }
    const newer = { source: 'biorxiv', year: '2024' }
    expect(chooseCanonical([older, newer])).toBe(newer)
  })
})

describe('versionOf', () => {
  it('captures source, native id, and peer-review status', () => {
    expect(versionOf({ source: 'pubmed', pubmed_id: '123', url: 'u', year: '2023' }))
      .toEqual({ source: 'pubmed', source_id: '123', url: 'u', year: '2023', peer_reviewed: true })
  })
})

describe('authorSurnames', () => {
  it('returns a set of distinct surnames', () => {
    expect(authorSurnames(['Smith J', 'Doe A', 'Smith, Jane'])).toEqual(new Set(['smith', 'doe']))
  })
})
