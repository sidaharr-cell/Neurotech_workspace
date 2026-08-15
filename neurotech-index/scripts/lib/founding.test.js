import { describe, it, expect } from 'vitest'
import {
  pageText, extractFoundingYear, preferFounding, aboutUrl, ABOUT_PATHS,
} from './founding.js'

const NOW = 2026
const year = (text, now = NOW) => extractFoundingYear(text, now)?.year ?? null

describe('pageText', () => {
  it('drops script and style contents rather than reading them as prose', () => {
    const html = '<style>.a{content:"founded in 1999"}</style><script>var x="founded in 1998"</script><p>Founded in 2015.</p>'
    expect(year(pageText(html))).toBe(2015)
  })

  it('collapses entities and whitespace so a claim split across tags still reads', () => {
    expect(year(pageText('<p>Founded&nbsp;in\n\n  <b>2014</b>.</p>'))).toBe(2014)
  })
})

describe('what is never a founding year', () => {
  /** The failure this whole module exists to prevent: a footer copyright line
   *  sits on nearly every page and a naive year grab reads it as a founding
   *  date on any site that never states one. */
  it('ignores a copyright year', () => {
    expect(year('© 2019 Acme Neuro Inc. All rights reserved.')).toBe(null)
    expect(year('Copyright 2021 Acme Neuro')).toBe(null)
    expect(year(pageText('<footer>&copy; 2023 Acme</footer>'))).toBe(null)
  })

  it('ignores a policy or last-updated date', () => {
    expect(year('Privacy policy last updated 2024.')).toBe(null)
    expect(year('Terms of service, effective 2022.')).toBe(null)
  })

  it('still finds the real claim on a page that also has a copyright line', () => {
    expect(year('Acme was founded in 2013. © 2024 Acme Neuro. All rights reserved.')).toBe(2013)
  })

  it('refuses a year in the future', () => {
    expect(year('Founded in 2031.')).toBe(null)
  })

  it('refuses a year old enough to be a university rather than a company', () => {
    expect(year('Our partner hospital, established in 1848, ...')).toBe(null)
  })

  it('has nothing to say about a page with no year at all', () => {
    expect(year('We build implantable neurostimulators.')).toBe(null)
    expect(year('')).toBe(null)
    expect(extractFoundingYear(null, NOW)).toBe(null)
  })
})

describe('the claims it recognises', () => {
  it('reads the explicit phrasings', () => {
    expect(year('The company was founded in 2015 in Boston.')).toBe(2015)
    expect(year('Founded: 2009')).toBe(2009)
    expect(year('Established in 2002 in Nijmegen.')).toBe(2002)
    expect(year('We started in 2018 with three engineers.')).toBe(2018)
  })

  it('reads a spin-out sentence', () => {
    expect(year('Spun out of the University of Melbourne in 2014, the company ...')).toBe(2014)
    expect(year('Spun-off from Philips Research in 2007.')).toBe(2007)
  })

  it('reads "since", which is the only phrasing some small companies use', () => {
    expect(year('Improving seizure care since 2006.')).toBe(2006)
    expect(year('AE.STUDIO · SINCE 2016 Scientists Who Ship.')).toBe(2016)
  })

  /**
   * A real false positive from the first sweep. "since 2006" here dates a
   * coating technology's clinical use, not Accentus Medical's founding.
   */
  it('refuses a "since" that is dating something other than the company', () => {
    expect(year('has undergone successful clinical application since 2006 in the field of custom-made and modular implants')).toBe(null)
    expect(year('Our device has been approved since 2014.')).toBe(null)
    expect(year('In use at over 200 hospitals since 2011.')).toBe(null)
    expect(year('A member of the consortium since 2018.')).toBe(null)
  })

  it('still takes an explicit claim on a page whose "since" is guarded out', () => {
    expect(year('Cleared for sale since 2014. Acme was founded in 2009.')).toBe(2009)
  })

  it('prefers the explicit claim when a page carries both', () => {
    const r = extractFoundingYear('Trusted by clinicians since 2019. Acme was founded in 2011.', NOW)
    expect(r.year).toBe(2011)
    expect(r.kind).toBe('founded')
  })

  it('keeps the phrase the year came from, so a person can audit it', () => {
    const r = extractFoundingYear('Acme Neuro was founded in 2015 by two engineers.', NOW)
    expect(r.phrase).toContain('founded in 2015')
  })

  /** Incorporation has a better source in Form D and is a different fact. */
  it('does not read an incorporation sentence as a founding year', () => {
    expect(year('Acme Neuro, Inc. was incorporated in Delaware in 2016.')).toBe(null)
  })
})

describe('preferFounding', () => {
  const f = (kind, y) => ({ kind, year: y, phrase: '' })

  it('takes whichever reading exists when only one does', () => {
    expect(preferFounding(null, f('since', 2010))).toEqual(f('since', 2010))
    expect(preferFounding(f('founded', 2010), null)).toEqual(f('founded', 2010))
    expect(preferFounding(null, null)).toBe(null)
  })

  it('prefers the stronger claim whichever page it came from', () => {
    // An About page saying "founded in 2015" beats a homepage saying "since 2018".
    expect(preferFounding(f('since', 2018), f('founded', 2015))).toEqual(f('founded', 2015))
    expect(preferFounding(f('founded', 2015), f('since', 2018))).toEqual(f('founded', 2015))
  })

  it('takes the earlier year between two equally strong claims', () => {
    // A later date is usually a rebrand or a regional subsidiary.
    expect(preferFounding(f('founded', 2019), f('founded', 2012))).toEqual(f('founded', 2012))
  })

  it('does not depend on the order pages were fetched in', () => {
    const seen = [f('since', 2020), f('founded', 2011), f('established', 2015)]
    const fwd = seen.reduce((a, r) => preferFounding(a, r), null)
    const rev = [...seen].reverse().reduce((a, r) => preferFounding(a, r), null)
    expect(fwd).toEqual(f('founded', 2011))
    expect(rev).toEqual(fwd)
  })
})

describe('aboutUrl', () => {
  it('builds candidates against the site origin, not the stored path', () => {
    expect(aboutUrl('https://acme.com/products/x', '/about')).toBe('https://acme.com/about')
    expect(aboutUrl('https://acme.com', '')).toBe('https://acme.com/')
  })

  it('refuses anything that is not an http(s) site', () => {
    expect(aboutUrl('javascript:alert(1)', '/about')).toBe(null)
    expect(aboutUrl('not a url', '/about')).toBe(null)
    expect(aboutUrl(null, '/about')).toBe(null)
  })

  it('asks the dedicated About page before the homepage', () => {
    expect(ABOUT_PATHS.indexOf('/about')).toBeLessThan(ABOUT_PATHS.indexOf(''))
  })
})
