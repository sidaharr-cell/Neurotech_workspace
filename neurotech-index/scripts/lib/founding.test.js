import { describe, it, expect } from 'vitest'
import {
  pageText, extractFoundingYear, extractSchemaFounding, preferFounding, aboutUrl, ABOUT_PATHS,
  sameSite, mentionsCompany,
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

  it('asks the homepage first, where schema.org markup lives', () => {
    expect(ABOUT_PATHS.indexOf('')).toBe(0)
    expect(ABOUT_PATHS).toContain('/about')
  })
})

// ── schema.org foundingDate ────────────────────────────────────────────────

const ld = obj => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`

describe('extractSchemaFounding', () => {
  it('reads foundingDate off an Organization node', () => {
    const html = ld({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme Neuro', foundingDate: '2015-04-01' })
    expect(extractSchemaFounding(html)).toMatchObject({ year: 2015, kind: 'schema_org' })
  })

  it('accepts a bare year and a fully qualified type', () => {
    expect(extractSchemaFounding(ld({ '@type': 'Corporation', foundingDate: '2009' })).year).toBe(2009)
    expect(extractSchemaFounding(ld({ '@type': 'https://schema.org/MedicalOrganization', foundingDate: '2011-01-01' })).year).toBe(2011)
  })

  it('finds the node inside an @graph or an array', () => {
    const html = ld({ '@graph': [{ '@type': 'WebSite' }, { '@type': 'Organization', foundingDate: '2018' }] })
    expect(extractSchemaFounding(html).year).toBe(2018)
    expect(extractSchemaFounding(ld([{ '@type': 'Organization', foundingDate: '2004' }])).year).toBe(2004)
  })

  /** A foundingDate on an Event or a Person is a different fact wearing the
   *  same key, and adopting it would date the company by one of its conferences. */
  it('ignores foundingDate on a node that is not an organization', () => {
    expect(extractSchemaFounding(ld({ '@type': 'Event', foundingDate: '1999' }))).toBe(null)
    expect(extractSchemaFounding(ld({ '@type': 'Person', foundingDate: '1970' }))).toBe(null)
  })

  it('survives a malformed block rather than throwing', () => {
    const html = '<script type="application/ld+json">{ not json </script>'
      + ld({ '@type': 'Organization', foundingDate: '2020' })
    expect(extractSchemaFounding(html).year).toBe(2020)
  })

  it('reads the microdata form too', () => {
    expect(extractSchemaFounding('<meta itemprop="foundingDate" content="2013-06-01">').year).toBe(2013)
  })

  it('has nothing to say about a page with no markup', () => {
    expect(extractSchemaFounding('<p>Founded in 2015.</p>')).toBe(null)
    expect(extractSchemaFounding('')).toBe(null)
  })

  /** This is why it is checked first: it works on a page with no readable text,
   *  which is what a JavaScript-rendered site serves. */
  it('works on a shell page that carries no prose at all', () => {
    const shell = '<html><head>' + ld({ '@type': 'Organization', foundingDate: '2017' }) + '</head><body><div id="root"></div></body></html>'
    expect(pageText(shell).length).toBeLessThan(400)
    expect(extractSchemaFounding(shell).year).toBe(2017)
  })
})

describe('preferFounding ranks schema.org above prose', () => {
  it('takes machine-written markup over a "founded in" sentence', () => {
    const schema = { kind: 'schema_org', year: 2016, phrase: '' }
    const prose = { kind: 'founded', year: 2019, phrase: '' }
    expect(preferFounding(prose, schema)).toEqual(schema)
    expect(preferFounding(schema, prose)).toEqual(schema)
  })
})

// ── The guards the 15 Aug 2026 sweep needed and did not have ───────────────

describe('sameSite', () => {
  it('accepts the company\'s own host and a www variant', () => {
    expect(sameSite('https://acme.com/about', 'https://acme.com')).toBe(true)
    expect(sameSite('https://www.acme.com/about', 'https://acme.com')).toBe(true)
  })

  it('allows a one-label regional variant', () => {
    expect(sameSite('https://pajunk.com/about', 'https://pajunkusa.com')).toBe(true)
  })

  /** Axonics was dated 1979 because its domain redirected to Boston Scientific,
   *  and 1979 is when Boston Scientific was founded. A real year, a different
   *  company. */
  it('rejects an acquirer the domain redirects to', () => {
    expect(sameSite('https://bostonscientific.com/', 'https://axonicsmodulation.com')).toBe(false)
    expect(sameSite('https://verint.com/', 'https://cogitocorp.com')).toBe(false)
  })

  /** Eight companies were all dated 2005 — the parking host's own footer year. */
  it('rejects domain-for-sale parking hosts', () => {
    for (const h of ['https://www.hugedomains.com/x', 'https://brandsly.com/y', 'https://sedo.com/z']) {
      expect(sameSite(h, 'https://acme.com'), h).toBe(false)
    }
  })

  /** CLAUDE.md forbids it outright, and two companies were scraped from it. */
  it('rejects LinkedIn and other directories', () => {
    expect(sameSite('https://www.linkedin.com/company/x', 'https://mddtinc.ca')).toBe(false)
    expect(sameSite('https://crunchbase.com/organization/x', 'https://acme.com')).toBe(false)
  })

  it('rejects anything unparseable', () => {
    expect(sameSite(null, 'https://acme.com')).toBe(false)
    expect(sameSite('https://acme.com', null)).toBe(false)
  })
})

describe('mentionsCompany', () => {
  it('accepts a window naming the company', () => {
    expect(mentionsCompany('Founded in 2015, NeuraLace is a technology company', 'NeuraLace Medical')).toBe(true)
  })

  it('accepts a company referring to itself by its initials', () => {
    expect(mentionsCompany('ABT was founded in 1998 by Alex Doman', 'Advanced Brain Technologies')).toBe(true)
  })

  /**
   * The false positives that made this guard necessary. Both sentences are on
   * the company's own About page and neither is about the company.
   */
  it('rejects a sentence about a person', () => {
    expect(mentionsCompany('he has been pain-free since 1993. Richard tested his technology', 'Sana Health')).toBe(false)
    expect(mentionsCompany('for Female Urology and Continence Care since 1993. He has trained over 30 fellows', 'NeuSpera Medical')).toBe(false)
  })

  it('is not satisfied by a generic word shared with the name', () => {
    // "Medical" alone must not qualify a sentence as being about this company.
    expect(mentionsCompany('our medical advisory board since 1998', 'Axonia Medical')).toBe(false)
  })

  it('imposes nothing when no name is supplied', () => {
    expect(mentionsCompany('founded in 2011', null)).toBe(true)
  })
})

describe('extractFoundingYear with a company name', () => {
  it('keeps a claim that names the company', () => {
    expect(extractFoundingYear('Founded in 1998, AXONIA MEDICAL prides itself', NOW, 'Axonia Medical')?.year).toBe(1998)
  })

  it('drops a claim that names only a person', () => {
    expect(extractFoundingYear('he has been pain-free since 1993 and built the device', NOW, 'Sana Health')).toBe(null)
  })

  it('skips the person sentence and takes the company one', () => {
    const text = 'Richard has been pain-free since 1993. Sana Health was founded in 2016.'
    expect(extractFoundingYear(text, NOW, 'Sana Health')?.year).toBe(2016)
  })
})

describe('mentionsCompany: a company talking about itself', () => {
  /**
   * Real values the first version of this guard would have thrown away. Each is
   * on the company's own verified domain, where "the company" is unambiguous.
   */
  it('accepts a company referring to itself without its name', () => {
    expect(mentionsCompany('About the Company Founded in 2015 in Tampere, Finland', 'Neuro Event Labs')).toBe(true)
    expect(mentionsCompany('The company was founded in 2014 in the Republic of Buryatia', 'DRD Biotech')).toBe(true)
    expect(mentionsCompany('2016 - Founded Founded in 2016, our Co-Founders identified the need', 'PathAI')).toBe(true)
  })

  /** Real false positives. A testimonial and a biography, both on About pages. */
  it('still rejects a person as the subject', () => {
    expect(mentionsCompany('player since 2018 If you, or someone you know', 'Litesprite', 'Logan Niles, player ')).toBe(false)
    expect(mentionsCompany('pain-free since 1993', 'Sana Health', 'and he has been pain-free ')).toBe(false)
  })

  it('rejects a person even when the company is also named nearby', () => {
    // "Dr Smith founded Acme and has practised since 1998" dates the practice.
    expect(mentionsCompany('Acme since 1998', 'Acme Neuro', 'Dr Smith has practised ')).toBe(false)
  })
})

describe('a month between "in" and the year', () => {
  /**
   * "NEOFECT was founded in June 2010 by Hoyoung Ban and Scott Kim" was sitting
   * in our own stored description and the extractor could not read it, because
   * the pattern expected the year to follow "in" directly.
   */
  it('reads a founding sentence that names the month', () => {
    expect(year('NEOFECT was founded in June 2010 by Hoyoung Ban and Scott Kim, two students', NOW)).toBe(2010)
    expect(year('The company was founded in March 2015 in Boston.')).toBe(2015)
    expect(year('Established in September 2004 as a spin-off.')).toBe(2004)
    expect(year('We started in Jan 2019 with three engineers.')).toBe(2019)
  })

  it('reads a full date', () => {
    expect(year('Acme was founded in 3rd April 2012 in Leeds.')).toBe(2012)
    expect(year('Founded in May of 2008.')).toBe(2008)
  })

  it('still reads the bare form', () => {
    expect(year('Acme was founded in 2015.')).toBe(2015)
  })

  /** The month must not become a way in for an unrelated year. */
  it('does not reach across a sentence to find a year', () => {
    expect(year('Acme was founded in Boston. The building dates from 1890.')).toBe(null)
  })
})
