import { describe, it, expect } from 'vitest'
import { bibtex, ris, escapeBibtex, citeKey } from './citation'

const sample = {
  title: 'Closed-loop DBS & 50% response in depression',
  authors: ['Smith J', 'Doe A'],
  journal: 'Nature Neuroscience',
  year: '2023',
  doi: '10.1038/s41593-023-01234-5',
  url: 'https://doi.org/10.1038/s41593-023-01234-5',
}

describe('escapeBibtex', () => {
  it('escapes the BibTeX special characters', () => {
    expect(escapeBibtex('a & b 50% {x} _y $z #w')).toBe('a \\& b 50\\% \\{x\\} \\_y \\$z \\#w')
  })
})

describe('citeKey', () => {
  it('is surname + year + first title word, alphanumeric only', () => {
    expect(citeKey(sample)).toBe('Smith2023closedloop')
  })
})

describe('bibtex', () => {
  const out = bibtex(sample)
  it('produces a parseable @article entry with all fields', () => {
    expect(out).toContain('@article{Smith2023closedloop,')
    expect(out).toContain('author = {Smith J and Doe A}')
    expect(out).toContain('journal = {Nature Neuroscience}')
    expect(out).toContain('year = {2023}')
    expect(out).toContain('doi = {10.1038/s41593-023-01234-5}')
    expect(out.trim().endsWith('}')).toBe(true)
  })
  it('escapes special characters in the title so it imports cleanly', () => {
    expect(out).toContain('title = {Closed-loop DBS \\& 50\\% response in depression}')
    expect(out).not.toMatch(/[^\\]&/)   // no unescaped ampersand
    expect(out).not.toMatch(/[^\\]%/)   // no unescaped percent
  })
})

describe('ris', () => {
  const out = ris(sample)
  it('has the RIS structure with one AU line per author and a terminator', () => {
    const lines = out.split('\n')
    expect(lines[0]).toBe('TY  - JOUR')
    expect(out).toContain('TI  - Closed-loop DBS & 50% response in depression')
    expect((out.match(/^AU  - /gm) || []).length).toBe(2)
    expect(out).toContain('DO  - 10.1038/s41593-023-01234-5')
    expect(out).toContain('ER  - ')
  })
})

describe('round-trip: a minimal record with no DOI still emits valid output', () => {
  const p = { title: 'Preprint on neural decoding', authors: ['Roe B'], year: '2024', source: 'arxiv', url: 'https://arxiv.org/abs/2401.1' }
  it('bibtex uses the url and omits doi', () => {
    const b = bibtex(p)
    expect(b).toContain('url = {https://arxiv.org/abs/2401.1}')
    expect(b).not.toContain('doi = {}')
  })
  it('ris uses the url', () => {
    expect(ris(p)).toContain('UR  - https://arxiv.org/abs/2401.1')
  })
})
