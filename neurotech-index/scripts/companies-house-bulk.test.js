import { describe, it, expect } from 'vitest'
import { splitCsvLine, yearOfCreation, looksUk } from './backfill-companies-house-bulk.js'

describe('splitCsvLine', () => {
  it('splits a plain row', () => {
    expect(splitCsvLine('ACME NEURO LTD,01234567,Active')).toEqual(['ACME NEURO LTD', '01234567', 'Active'])
  })

  /** The register quotes any name containing a comma, and a naive split puts
   *  half the name into the next column and shifts every field after it. */
  it('keeps a quoted name containing a comma in one field', () => {
    expect(splitCsvLine('"ACME NEURO, INC.",01234567,Active'))
      .toEqual(['ACME NEURO, INC.', '01234567', 'Active'])
  })

  it('handles an escaped quote inside a name', () => {
    expect(splitCsvLine('"THE ""BRAIN"" COMPANY LTD",1,Active')[0]).toBe('THE "BRAIN" COMPANY LTD')
  })

  it('keeps empty fields rather than dropping them', () => {
    expect(splitCsvLine('A,,C')).toEqual(['A', '', 'C'])
  })
})

describe('yearOfCreation', () => {
  /** The register writes dates day-first, so 05/04/2011 is April, not May, and
   *  either way the year is the last field — reading it positionally rather
   *  than by parsing avoids the ambiguity entirely. */
  it('reads the year from a day-first register date', () => {
    expect(yearOfCreation('05/04/2011')).toBe(2011)
    expect(yearOfCreation('31/12/1999')).toBe(1999)
  })

  it('also accepts an ISO date', () => {
    expect(yearOfCreation('2011-04-05')).toBe(2011)
  })

  it('has no answer for a blank or malformed date', () => {
    expect(yearOfCreation('')).toBe(null)
    expect(yearOfCreation(null)).toBe(null)
    expect(yearOfCreation('not a date')).toBe(null)
  })
})

describe('looksUk', () => {
  /**
   * The gate that a dry run proved necessary: without it the register matched
   * ableX in Auckland, AE Studio in Los Angeles and Biomedical Solutions in
   * Chuo, Japan against British companies that merely share a name.
   */
  it('accepts UK locations', () => {
    for (const l of ['Didcot, UK', 'Exeter, UK', 'London, United Kingdom', 'Cambridge, England',
      'Glasgow, Scotland', 'Belfast, Northern Ireland', 'Oxford', 'Harwell, Oxfordshire']) {
      expect(looksUk(l), l).toBe(true)
    }
  })

  it('rejects the non-UK locations that produced wrong matches', () => {
    for (const l of ['Auckland, New Zealand', 'Los Angeles, USA', 'Chuo, Japan', 'Toronto, Canada',
      'Austin, USA', 'Montmorency, France', 'Bergamo, Italy', 'Vienna, Austria',
      'Eindhoven / Athens, The Netherlands / Greece']) {
      expect(looksUk(l), l).toBe(false)
    }
  })

  /** Absence is not a UK address, and this is the source with the most
   *  namesakes in the index. */
  it('rejects a missing location rather than guessing', () => {
    expect(looksUk(null)).toBe(false)
    expect(looksUk('')).toBe(false)
    expect(looksUk(undefined)).toBe(false)
  })

  it('does not match a place name buried inside a longer word', () => {
    expect(looksUk('Yorkville, USA')).toBe(false)
    expect(looksUk('Newcastle, Australia')).toBe(true)   // known limit: bare city names are ambiguous
  })
})
