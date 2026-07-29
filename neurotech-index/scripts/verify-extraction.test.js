import { describe, it, expect } from 'vitest'
import { checkableNumbers, numberInSource, assertedNumbers } from './verify-extraction.js'

describe('checkableNumbers ignores what proves nothing', () => {
  it('keeps real measurements', () => {
    expect(checkableNumbers('62 words per minute in 128 channels')).toEqual(['62', '128'])
  })

  it('drops years, which appear everywhere', () => {
    expect(checkableNumbers('completed in 2019 with 42 patients')).toEqual(['42'])
  })

  it('drops bare 0 and 1 but keeps decimals', () => {
    expect(checkableNumbers('1 of 0 cases, accuracy 0.936')).toEqual(['0.936'])
  })

  it('deduplicates', () => {
    expect(checkableNumbers('62 then 62 again')).toEqual(['62'])
  })

  it('survives empty input', () => {
    for (const v of ['', null, undefined]) expect(checkableNumbers(v)).toEqual([])
  })
})

describe('numberInSource allows the ways a source really writes a number', () => {
  it('matches a literal occurrence', () => {
    expect(numberInSource('62', 'decoded 62 words per minute')).toBe(true)
  })

  it('matches across thousands separators, both directions', () => {
    expect(numberInSource('2512', 'conductivity of 2,512 S/cm')).toBe(true)
    expect(numberInSource('2,512', 'conductivity of 2512 S/cm')).toBe(true)
  })

  it('matches a proportion restated as a percentage', () => {
    // 0.936 accuracy and "93.6%" are the same reported result.
    expect(numberInSource('0.936', 'accuracy was 93.6%')).toBe(true)
  })

  it('reports an invented number as ungrounded', () => {
    // This is the failure the criterion exists to catch.
    expect(numberInSource('512', 'the array had 128 channels')).toBe(false)
  })

  it('is false against an empty source rather than throwing', () => {
    expect(numberInSource('62', '')).toBe(false)
    expect(numberInSource('62', null)).toBe(false)
  })
})

describe('assertedNumbers collects everything the extraction commits to', () => {
  it('pulls from both demonstrated and quantitative_results', () => {
    const out = assertedNumbers({
      demonstrated: 'decoded 62 words per minute',
      quantitative_results: [{ metric: 'channels', value: '128', units: 'ch' }],
    })
    expect(out.map(o => o.n).sort()).toEqual(['128', '62'])
    expect(out.find(o => o.n === '128').field).toContain('channels')
  })

  it('returns nothing for an extraction that asserts no number', () => {
    expect(assertedNumbers({ demonstrated: 'a case report, no outcome data', quantitative_results: [] }))
      .toEqual([])
  })

  it('survives a null demonstrated', () => {
    expect(assertedNumbers({ demonstrated: null, quantitative_results: [] })).toEqual([])
  })
})
