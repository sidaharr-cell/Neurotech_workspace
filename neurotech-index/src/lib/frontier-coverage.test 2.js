import { describe, it, expect } from 'vitest'
import {
  coverageOf, fdCeilingFor, coverageReport, newAxisAllowed,
  MIN_RECORDS_FOR_ABSENCE, MIN_AXIS_TYPES_FOR_ABSENCE,
} from './frontier-coverage.js'

/** n records in one subfield, cycling through the given axis types. */
const recs = (subfield, n, types) => Array.from({ length: n }, (_, i) => ({
  subfield, axis: `axis ${i}`, axis_type: types[i % types.length],
}))

const wellMapped = recs('DBS', 6, ['performance', 'longevity', 'scale'])

describe('coverageOf', () => {
  it('counts records and distinct axis types', () => {
    const c = coverageOf(wellMapped, 'DBS')
    expect(c.records).toBe(6)
    expect(c.axisTypeCount).toBe(3)
    expect(c.axisTypes).toEqual(['longevity', 'performance', 'scale'])
    expect(c.sufficient).toBe(true)
  })

  it('ignores records from other subfields', () => {
    const mixed = [...wellMapped, ...recs('DECODING_ALGORITHMS', 9, ['performance'])]
    expect(coverageOf(mixed, 'DBS').records).toBe(6)
  })

  it('reports an empty subfield rather than throwing', () => {
    expect(coverageOf([], 'DBS')).toMatchObject({ records: 0, axisTypeCount: 0, sufficient: false })
  })
})

describe('depth alone is not coverage', () => {
  it('rejects many records that are all one axis type', () => {
    // The real BCI_NONINVASIVE shape when this rule was written: five records,
    // every one performance. That says nothing about whether longevity in that
    // subfield is unmeasured or merely uncurated.
    const deepNarrow = recs('BCI_NONINVASIVE', 12, ['performance'])
    expect(coverageOf(deepNarrow, 'BCI_NONINVASIVE').sufficient).toBe(false)
    expect(fdCeilingFor(deepNarrow, 'BCI_NONINVASIVE')).toBe(2)
  })

  it('rejects broad types with too few records', () => {
    const broadThin = recs('DBS', 3, ['performance', 'longevity', 'scale'])
    expect(coverageOf(broadThin, 'DBS').sufficient).toBe(false)
  })

  it('accepts only when both thresholds are met', () => {
    const c = coverageOf(wellMapped, 'DBS')
    expect(c.records).toBeGreaterThanOrEqual(MIN_RECORDS_FOR_ABSENCE)
    expect(c.axisTypeCount).toBeGreaterThanOrEqual(MIN_AXIS_TYPES_FOR_ABSENCE)
    expect(c.sufficient).toBe(true)
  })
})

describe('fdCeilingFor', () => {
  it('is 0 for a subfield with no records, per spec 7.1.3', () => {
    expect(fdCeilingFor([], 'DBS')).toBe(0)
  })

  it('is 2 when records exist but coverage is thin', () => {
    // The item can still move a record we hold; it just cannot claim that
    // nobody has ever measured something.
    expect(fdCeilingFor(recs('DBS', 3, ['performance']), 'DBS')).toBe(2)
  })

  it('is 4 when coverage is sufficient', () => {
    expect(fdCeilingFor(wellMapped, 'DBS')).toBe(4)
  })
})

describe('newAxisAllowed', () => {
  it('allows a genuinely absent axis in a well-mapped subfield', () => {
    expect(newAxisAllowed(wellMapped, 'DBS', 'charge density per phase')).toBe(true)
  })

  it('refuses an axis that already has a record', () => {
    expect(newAxisAllowed(wellMapped, 'DBS', 'axis 0')).toBe(false)
  })

  it('refuses in a thinly covered subfield however novel the axis', () => {
    // This is the whole point: absence in a thin subfield is our backlog, not
    // the frontier, and awarding FD 3 on it fabricates a superlative.
    const thin = recs('DBS', 3, ['performance'])
    expect(newAxisAllowed(thin, 'DBS', 'charge density per phase')).toBe(false)
  })

  it('refuses when no axis is given', () => {
    expect(newAxisAllowed(wellMapped, 'DBS', null)).toBe(false)
  })
})

describe('coverageReport', () => {
  const records = [
    ...recs('DBS', 6, ['performance', 'longevity', 'scale']),
    ...recs('BCI_NONINVASIVE', 7, ['performance']),
  ]
  const ids = ['DBS', 'BCI_NONINVASIVE', 'FOCUSED_ULTRASOUND']

  it('separates sufficient from insufficient subfields', () => {
    const r = coverageReport(records, ids)
    expect(r.sufficient).toEqual(['DBS'])
    expect(r.insufficient.sort()).toEqual(['BCI_NONINVASIVE', 'FOCUSED_ULTRASOUND'])
    expect(r.fdThreeAvailableIn).toBe(1)
    expect(r.total).toBe(3)
  })

  it('keeps a zero-record subfield visible', () => {
    // An empty subfield is the loudest coverage signal and must not vanish
    // just because it contributed no rows.
    expect(coverageReport(records, ids).bySubfield.FOCUSED_ULTRASOUND.records).toBe(0)
  })

  it('falls back to the subfields present in the data', () => {
    expect(coverageReport(records).total).toBe(2)
  })
})
