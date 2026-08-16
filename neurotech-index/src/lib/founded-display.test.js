import { describe, it, expect } from 'vitest'
import { foundingLine, foundingText, foundingSortYear, sourceHost } from './founded-display'

const sourced = (over = {}) => ({
  founded_year: 2019,
  founded_source_kind: 'press',
  founded_source_url: 'https://icn2.cat/en/business-and-innovation/spin-off-companies/4597',
  ...over,
})

describe('a year never renders without its source', () => {
  /**
   * The legacy column holds 22 unsourced values and five of the twelve that can
   * be checked against a filing disagree with it. It is not a fallback.
   */
  it('ignores the legacy founded column entirely', () => {
    expect(foundingLine({ founded: '2025' })).toBe(null)
    expect(foundingLine({ founded: '2013', founded_year: null, incorporated_year: null })).toBe(null)
  })

  it('says nothing when there is nothing sourced to say', () => {
    expect(foundingLine({})).toBe(null)
    expect(foundingLine(null)).toBe(null)
  })
})

describe('founding beats incorporation, and is labelled as itself', () => {
  it('renders a sourced founding year', () => {
    const l = foundingLine(sourced())
    expect(foundingText(l)).toBe('Founded 2019')
    expect(l.sourceHost).toBe('icn2.cat')
  })

  /** Axonics: incorporated 2012, operating 2013. Both are true and they are not
   *  the same fact, so the page must not call the filing a founding. */
  it('prefers the founding year when both exist', () => {
    const l = foundingLine(sourced({ founded_year: 2013, incorporated_year: 2012 }))
    expect(foundingText(l)).toBe('Founded 2013')
  })

  it('falls back to incorporation but never calls it Founded', () => {
    const l = foundingLine({ incorporated_year: 2012, incorporated_source_url: 'https://www.sec.gov/x' })
    expect(foundingText(l)).toBe('Incorporated 2012')
    expect(l.approximates).toBe(true)
  })

  it('renders a bound as a bound', () => {
    const l = foundingLine({ incorporated_before_year: 2004, incorporated_source_url: 'https://www.sec.gov/x' })
    expect(foundingText(l)).toBe('Incorporated by 2004')
    expect(l.bound).toBe(true)
  })
})

describe('the source class is visible, because the classes are not equal', () => {
  it('marks an aggregator as an unsourced compilation', () => {
    const l = foundingLine(sourced({ founded_source_kind: 'aggregator', founded_source_url: 'https://pitchbook.com/x' }))
    expect(l.weak).toBe(true)
    expect(l.sourceLabel).toMatch(/unsourced/i)
  })

  it('does not mark press, a filing or Wikidata as weak', () => {
    for (const k of ['press', 'wikidata', 'wikipedia', 'companies_house']) {
      expect(foundingLine(sourced({ founded_source_kind: k })).weak, k).toBe(false)
    }
  })

  it('flags the company\'s own site as self-reported without calling it weak', () => {
    const l = foundingLine(sourced({ founded_source_kind: 'company_site', founded_source_url: 'https://acme.com/about' }))
    expect(l.selfReported).toBe(true)
    expect(l.weak).toBe(false)
  })

  /** Our own description has no URL to offer, so it must not render a dead link. */
  it('offers no link for a year taken from our own record', () => {
    const l = foundingLine(sourced({ founded_source_kind: 'record_description', founded_source_url: null }))
    expect(l.url).toBe(null)
    expect(l.sourceHost).toBe(null)
    expect(l.weak).toBe(true)
  })

  it('treats an unknown class as weak rather than trusting it', () => {
    expect(foundingLine(sourced({ founded_source_kind: 'something_new' })).weak).toBe(true)
  })
})

describe('conflicts travel to the page', () => {
  /** Onward Medical is reported as 2014 and as 2015 by reputable sources. */
  it('carries the disagreement through', () => {
    const l = foundingLine(sourced({ founded_year: 2014, founded_conflict: 'Another source gives 2015' }))
    expect(l.conflict).toMatch(/2015/)
  })

  it('leaves conflict null when the sources agree', () => {
    expect(foundingLine(sourced()).conflict).toBe(null)
  })
})

describe('foundingSortYear', () => {
  it('sorts on whichever fact answered', () => {
    expect(foundingSortYear(sourced())).toBe(2019)
    expect(foundingSortYear({ incorporated_year: 2012 })).toBe(2012)
  })

  /** A bound asserts only "no later than", so that is the year it sorts as. */
  it('sorts a bound as the latest year it permits', () => {
    expect(foundingSortYear({ incorporated_before_year: 2004 })).toBe(2004)
  })

  it('has no year for a company with nothing sourced', () => {
    expect(foundingSortYear({ founded: '2015' })).toBe(null)
  })
})

describe('sourceHost', () => {
  it('drops www and the scheme', () => {
    expect(sourceHost('https://www.sec.gov/Archives/x')).toBe('sec.gov')
  })
  it('survives rubbish', () => {
    expect(sourceHost('not a url')).toBe(null)
    expect(sourceHost(null)).toBe(null)
  })
})
