import { describe, it, expect } from 'vitest'
import {
  checkableNumbers, numberInSource, assertedNumbers, normalizeSource,
} from './verify-extraction.js'

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

describe('the false positives the first acceptance run produced', () => {
  // Each of these was reported as an invented value. The extractor had read all
  // three correctly; the checker was wrong. Real strings from real abstracts.
  it('matches a sign separated from its digits by a space', () => {
    const src = 'lesion volume (t(68) = - 3.54, p = 0.0008), and age'
    expect(numberInSource('-3.54', src)).toBe(true)
  })

  it('matches a sign separated by a space after an equals', () => {
    expect(numberInSource('-3.17', 'age (t = - 3.17, p = 0.002) were identified')).toBe(true)
  })

  it('matches a count the abstract spells out in words', () => {
    expect(numberInSource('4', 'seen in the four subjects receiving the device')).toBe(true)
  })

  it('matches a unicode minus', () => {
    expect(numberInSource('-3.54', 'effect was − 3.54 overall')).toBe(true)
  })

  it('matches a p-value written without its leading zero', () => {
    // Journals routinely write "P = .06"; the extractor writes back "0.06".
    expect(numberInSource('0.06', 'the profound hearing loss group (P = .06). The')).toBe(true)
    expect(numberInSource('0.04', 'reached statistical significance (P = .04).')).toBe(true)
  })

  it('still rejects a genuinely invented value', () => {
    // The fixes must not turn the check into a rubber stamp.
    expect(numberInSource('512', 'the array had 128 channels')).toBe(false)
    expect(numberInSource('-9.9', 'age (t = - 3.17, p = 0.002)')).toBe(false)
    expect(numberInSource('7', 'seen in the four subjects')).toBe(false)
    expect(numberInSource('0.07', 'significance (P = .04).')).toBe(false)
  })
})

describe('normalizeSource', () => {
  it('keeps the spelled word alongside the digit it adds', () => {
    expect(normalizeSource('four subjects')).toContain('four')
    expect(normalizeSource('four subjects')).toContain('4')
  })

  it('does not corrupt ordinary prose', () => {
    expect(normalizeSource('the array had 128 channels')).toContain('128 channels')
  })
})
