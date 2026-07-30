import { describe, it, expect } from 'vitest'
import {
  parseExtraction, usableResults, valueString, proposalKey, normalizeProposalKeys,
} from './mine-frontier-proposals.js'

const body = {
  quantitative_results: [
    { metric: 'decoding rate', value: '62', units: 'words per minute', conditions: 'one participant, ALS', axis_type: 'performance' },
  ],
  methods_disclosed: true,
  rhetorical_markers: ['unprecedented'],
}

describe('parseExtraction', () => {
  it('parses a bare JSON object', () => {
    expect(parseExtraction(JSON.stringify(body))).toMatchObject({ methods_disclosed: true })
  })

  it('parses a fenced JSON object', () => {
    expect(parseExtraction('```json\n' + JSON.stringify(body) + '\n```'))
      .toMatchObject({ methods_disclosed: true })
  })

  it('parses JSON behind a prose preamble', () => {
    // Real failure mode: "return JSON only" still produced a preamble on a
    // meaningful fraction of abstracts, and a silent parse failure looks
    // identical to an abstract that reported nothing.
    expect(parseExtraction('Here is the JSON:\n```json\n' + JSON.stringify(body) + '\n```'))
      .toMatchObject({ methods_disclosed: true })
  })

  it('returns null on unparseable input rather than an empty result', () => {
    for (const v of ['', null, undefined, 'no json here']) expect(parseExtraction(v)).toBeNull()
  })

  it('normalizes missing fields to the expected shape', () => {
    expect(parseExtraction('{}')).toEqual({
      quantitative_results: [], methods_disclosed: false, rhetorical_markers: [],
    })
  })

  it('coerces a non-array results field to an empty array', () => {
    expect(parseExtraction('{"quantitative_results":"lots"}').quantitative_results).toEqual([])
  })
})

describe('usableResults is the deterministic gate on the model', () => {
  const one = over => usableResults({ quantitative_results: [{ ...body.quantitative_results[0], ...over }] })

  it('keeps a complete result', () => {
    expect(one({})).toHaveLength(1)
  })

  it.each([
    ['no digits in the value', { value: 'many' }],
    ['empty units', { units: '' }],
    ['missing units', { units: undefined }],
    ['an axis type outside the enum', { axis_type: 'importance' }],
    ['an evidence axis, which belongs to trials not papers', { axis_type: 'evidence' }],
    ['a stub metric', { metric: 'x' }],
  ])('drops a result with %s', (_label, over) => {
    expect(one(over)).toHaveLength(0)
  })

  it('survives a null or empty extraction', () => {
    expect(usableResults(null)).toEqual([])
    expect(usableResults({})).toEqual([])
  })
})

describe('valueString', () => {
  it('keeps the number and its units together, per spec 3.1', () => {
    expect(valueString({ value: '62', units: 'words per minute' })).toBe('62 words per minute')
  })

  it('collapses stray whitespace', () => {
    expect(valueString({ value: ' 128 ', units: '  channels ' })).toBe('128 channels')
  })

  it('always contains a digit, so a promoted record passes the units check', () => {
    expect(valueString({ value: '0.936', units: 'proportion' })).toMatch(/\d/)
  })
})

describe('proposal keys', () => {
  it('is stable for the same input', () => {
    expect(proposalKey('p1', 'DBS', 'scale', 'Channel count'))
      .toBe(proposalKey('p1', 'DBS', 'scale', 'Channel count'))
  })

  it('separates the same paper mined for two subfields', () => {
    // A paper can land in its derived subfield AND in a keyword pool. Those are
    // two candidates, not a duplicate, so the subfield has to be in the key.
    expect(proposalKey('p1', 'DBS', 'scale', 'Channel count'))
      .not.toBe(proposalKey('p1', 'INTERFACE_MATERIALS', 'scale', 'Channel count'))
  })

  it('separates different axes from the same paper', () => {
    expect(proposalKey('p1', 'DBS', 'scale', 'm')).not.toBe(proposalKey('p1', 'DBS', 'longevity', 'm'))
  })
})

describe('normalizeProposalKeys', () => {
  const p = { subfield: 'DBS', axis: 'Channel count, chronic', axis_type: 'scale', item_id: 'p1' }

  it('rewrites a legacy key to the current scheme', () => {
    const out = normalizeProposalKeys({ 'p1:scale:channel-count': p })
    expect(Object.keys(out)).toEqual([proposalKey('p1', 'DBS', 'scale', 'Channel count')])
  })

  it('is idempotent, so repeated runs do not double the file', () => {
    const once = normalizeProposalKeys({ 'p1:scale:channel-count': p })
    expect(normalizeProposalKeys(once)).toEqual(once)
  })

  it('collapses a legacy and a current entry for the same candidate into one', () => {
    const current = proposalKey('p1', 'DBS', 'scale', 'Channel count')
    const out = normalizeProposalKeys({ 'p1:scale:channel-count': p, [current]: p })
    expect(Object.keys(out)).toHaveLength(1)
  })

  it('leaves underscore-prefixed and incomplete entries alone', () => {
    const out = normalizeProposalKeys({ _readme: ['x'], broken: { subfield: 'DBS' } })
    expect(Object.keys(out).sort()).toEqual(['_readme', 'broken'])
  })
})
