import { describe, it, expect } from 'vitest'
import {
  parseValue, comparable, pickRecord, coerceArray, looksLikeRecordValue, rejectAxis,
} from './promote-proposals.js'

describe('parseValue', () => {
  it.each([
    ['128 channels', 128, 'channels'],
    ['550 d', 550, 'd'],
    ['41 months', 41, 'months'],
    ['9 µm', 9, 'µm'],
    ['2,512 S cm', 2512, 's cm'],
    ['0.936 accuracy', 0.936, 'accuracy'],
  ])('parses %s', (raw, number, unit) => {
    expect(parseValue(raw)).toEqual({ number, high: null, unit })
  })

  it('strips a leading comparator', () => {
    // "<3 min" and "≥ 75 V/m" are real shapes in the mined data.
    expect(parseValue('<3 min')).toEqual({ number: 3, high: null, unit: 'min' })
    expect(parseValue('≥ 75 V/m')).toEqual({ number: 75, high: null, unit: 'v/m' })
  })

  it('drops a tolerance clause from the unit', () => {
    expect(parseValue('2.20 ± 0.67 kΩ')).toEqual({ number: 2.2, high: null, unit: 'kω' })
  })

  it('keeps both ends of a range, and the unit after it', () => {
    expect(parseValue('8-30 Hz')).toEqual({ number: 8, high: 30, unit: 'hz' })
    expect(parseValue('64 to 128 electrodes')).toEqual({ number: 64, high: 128, unit: 'electrodes' })
  })

  it('returns null when there is no number', () => {
    for (const v of ['many', '', null, undefined]) expect(parseValue(v)).toBeNull()
  })
})

describe('comparable normalizes time so a cluster can be compared', () => {
  it.each([
    ['550 d', 550],
    ['41 months', 41 * 30.44],
    ['15 years', 15 * 365.25],
    ['14 days', 14],
    ['2 weeks', 14],
  ])('%s becomes days', (raw, days) => {
    const c = comparable(raw)
    expect(c.unit).toBe('days')
    expect(c.number).toBeCloseTo(days, 2)
  })

  it('keeps the original unit for reporting', () => {
    expect(comparable('41 months').original).toBe('months')
  })

  it('leaves non-time units alone', () => {
    expect(comparable('128 channels')).toMatchObject({ number: 128, unit: 'channels' })
  })
})

describe('pickRecord is arithmetic, not judgement', () => {
  const m = (v, id) => ({ proposed_value: v, id })

  it('takes the maximum when higher is better', () => {
    expect(pickRecord([m('128 channels', 'a'), m('1024 channels', 'b'), m('96 channels', 'c')], 'higher').winner.id)
      .toBe('b')
  })

  it('takes the minimum when lower is better', () => {
    // Impedance and thickness are lower-is-better axes.
    expect(pickRecord([m('9 µm', 'a'), m('2 µm', 'b'), m('50 µm', 'c')], 'lower').winner.id).toBe('b')
  })

  it('compares across time units after normalization', () => {
    // 41 months beats 550 days; a naive numeric compare would pick 550.
    expect(pickRecord([m('550 d', 'a'), m('41 months', 'b')], 'higher').winner.id).toBe('b')
  })

  it('does not compare values whose units cannot be reconciled', () => {
    const out = pickRecord([m('128 channels', 'a'), m('96 channels', 'b'), m('5 kΩ', 'c')], 'higher')
    expect(out.winner.id).toBe('a')
    expect(out.unreconciled.map(x => x.id)).toEqual(['c'])
    expect(out.unitGroups).toBe(2)
  })

  it('reports how many members were actually considered', () => {
    expect(pickRecord([m('1 s', 'a'), m('2 s', 'b'), m('3 s', 'c')], 'higher').considered).toBe(3)
  })

  it('returns no winner when nothing parses, rather than inventing one', () => {
    const out = pickRecord([m('many', 'a'), m('n/a', 'b')], 'higher')
    expect(out.winner).toBeNull()
    expect(out.unreconciled).toHaveLength(2)
  })
})

describe('coerceArray survives the tool-output shapes actually observed', () => {
  it('passes a real array straight through', () => {
    expect(coerceArray([1, 2])).toEqual([1, 2])
  })

  it('parses a plainly JSON-encoded array', () => {
    expect(coerceArray('[{"axis":"a"}]')).toEqual([{ axis: 'a' }])
  })

  it('salvages the leading array when the rest of the object was serialized in too', () => {
    // Observed shape: the model wrote the remainder of the whole object into the
    // axes field, so the string is not parseable but the array still is.
    const s = '[\n{"axis": "impedance", "direction": "lower", "member_ids": [1,2]}\n],\n"discarded_ids": [0,3]\n}'
    expect(coerceArray(s)).toEqual([{ axis: 'impedance', direction: 'lower', member_ids: [1, 2] }])
  })

  it('is not fooled by brackets inside strings', () => {
    const s = '[{"axis":"accuracy [offline]","member_ids":[4]}], "discarded_ids": []}'
    expect(coerceArray(s)).toEqual([{ axis: 'accuracy [offline]', member_ids: [4] }])
  })

  it('handles escaped quotes inside strings', () => {
    const s = '[{"axis":"a \\"b\\" c","member_ids":[1]}], "x": 1}'
    expect(coerceArray(s)[0].axis).toBe('a "b" c')
  })

  it('returns null for a string with no array', () => {
    expect(coerceArray('nope')).toBeNull()
    expect(coerceArray(null)).toBeNull()
    expect(coerceArray(42)).toBeNull()
  })
})

describe('ranges are scored at the end the axis direction cares about', () => {
  const m = (v, id) => ({ proposed_value: v, id })

  it('uses the TOP of a range when higher is better', () => {
    // "64 to 128 electrodes" is a 128-electrode record, not a 64-electrode one.
    // Taking the first number understated every ranged value.
    expect(pickRecord([m('64 to 128 electrodes', 'range'), m('96 electrodes', 'flat')], 'higher').winner.id)
      .toBe('range')
  })

  it('uses the BOTTOM of a range when lower is better', () => {
    expect(pickRecord([m('8-30 µm', 'range'), m('20 µm', 'flat')], 'lower').winner.id).toBe('range')
  })

  it('still handles a flat value as its own range', () => {
    expect(comparable('128 channels')).toMatchObject({ number: 128, high: 128 })
  })

  it('converts both ends of a time range', () => {
    const c = comparable('1-2 years')
    expect(c.number).toBeCloseTo(365.25, 1)
    expect(c.high).toBeCloseTo(730.5, 1)
  })
})

describe('deterministic rejection of things that are not records', () => {
  it.each([
    ['a comparison string', '20.94 [9.09] vs 24.72 [10.28] UPDRS part 3'],
    ['an anatomical label', 'S1-S3 root levels'],
    ['a self-declared unitless value', 'up to 1.0 unitless (proportion)'],
    ['a hedged value', 'exceeding 0.95 AUC'],
    ['a bare number', '62'],
    ['no number at all', 'several'],
    ['empty', ''],
  ])('rejects %s', (_label, v) => {
    expect(looksLikeRecordValue(v)).toBe(false)
  })

  it.each([
    '128 channels', '9 µm', '2.20 ± 0.67 kΩ', '41 months', '<3 min',
    '64 to 128 electrodes', '81 %', '0.006 mm2', '51 nW', '254.45 USD',
  ])('accepts the real value %s', (v) => {
    expect(looksLikeRecordValue(v)).toBe(true)
  })

  it.each([
    'Device-related adverse event rate, implanted peripheral nerve',
    'serious adverse events / wound complications, spinal',
    'Number of studies reviewed per neurostimulation modality',
    'Long-term treatment benefit / satisfaction / willingness to repeat',
    'Chronic follow-up duration post-implantation',
  ])('rejects the study-outcome axis %s', (a) => {
    expect(rejectAxis(a)).toBe(true)
  })

  it.each([
    'channel count, intracortical microelectrode array',
    'chronic implantation duration, intracortical Utah array',
    'electrode impedance, neural interface',
    'coating/fabrication process time, CI electrodes',
  ])('keeps the real frontier axis %s', (a) => {
    expect(rejectAxis(a)).toBe(false)
  })

  it('stops a comparison string from winning an axis on its first number', () => {
    const members = [
      { proposed_value: '900.5 [1.0] vs 2.0 UPDRS', id: 'junk' },
      { proposed_value: '12 UPDRS', id: 'real' },
    ]
    const usable = members.filter(m => looksLikeRecordValue(m.proposed_value))
    expect(usable.map(m => m.id)).toEqual(['real'])
    expect(pickRecord(usable, 'higher').winner.id).toBe('real')
  })
})
