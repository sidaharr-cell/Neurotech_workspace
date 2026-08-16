import { describe, it, expect } from 'vitest'
import { siteUrl, siteLabel } from './website.js'

describe('siteUrl', () => {
  it('passes an ordinary site through', () => {
    expect(siteUrl('https://www.acme.com')).toBe('https://www.acme.com/')
    expect(siteUrl('http://acme.com/about')).toBe('http://acme.com/about')
  })

  it('adds a scheme to a bare host', () => {
    expect(siteUrl('acme.com')).toBe('https://acme.com/')
  })

  // The 28 real values that were rendering as dead links.
  it('rejects the placeholder strings actually stored in this database', () => {
    for (const s of ['https://N/A', 'https://n/a', 'https://NA', 'https://Web', 'https://Not up'])
      expect(siteUrl(s)).toBe(null)
  })

  it('rejects a company name pasted into the website field', () => {
    // These parse. "https://Deep Brain Innovations" has a hostname, which is why
    // a truthiness guard let them through and a reader saw a link reading "deep".
    expect(siteUrl('https://Deep Brain Innovations')).toBe(null)
    expect(siteUrl('https://DiamPark')).toBe(null)
    expect(siteUrl('https://customKYnetics')).toBe(null)
  })

  it('rejects empty and missing values', () => {
    for (const s of ['', '   ', null, undefined]) expect(siteUrl(s)).toBe(null)
  })

  it('rejects a non-http scheme', () => {
    expect(siteUrl('javascript:alert(1)')).toBe(null)
    expect(siteUrl('mailto:hi@acme.com')).toBe(null)
  })

  it('rejects a host with no dot', () => {
    expect(siteUrl('https://localhost')).toBe(null)
    expect(siteUrl('https://intranet')).toBe(null)
  })

  it('keeps an aggregator profile, which is a real destination', () => {
    // Whether it should BE the company website is a separate question, and one
    // for a person: removing it leaves the row with nothing at all.
    expect(siteUrl('https://www.f6s.com/sofialabsllc')).toBe('https://www.f6s.com/sofialabsllc')
    expect(siteUrl('https://www.linkedin.com/company/buyology-inc/'))
      .toBe('https://www.linkedin.com/company/buyology-inc/')
  })

  it('keeps hosts with hyphens and subdomains', () => {
    expect(siteUrl('https://www.nbt-analytics.com/')).toBe('https://www.nbt-analytics.com/')
    expect(siteUrl('https://site.ieee.org/sf-embs')).toBe('https://site.ieee.org/sf-embs')
  })
})

describe('siteLabel', () => {
  it('shows the host without www', () => {
    expect(siteLabel('https://www.acme.com/about')).toBe('acme.com')
    expect(siteLabel('https://sub.acme.co.uk')).toBe('sub.acme.co.uk')
  })

  it('shows nothing where there is no link to show', () => {
    expect(siteLabel('https://N/A')).toBe(null)
    expect(siteLabel(null)).toBe(null)
  })
})

describe('a link must not point somewhere other than it reads', () => {
  it('rejects embedded credentials, which disguise the destination', () => {
    // "https://acme.com@evil.example/" displays as acme.com and goes to
    // evil.example. Nothing legitimate in this column needs userinfo.
    expect(siteUrl('https://acme.com@evil.example/')).toBe(null)
    expect(siteUrl('https://user:pw@acme.com')).toBe(null)
  })

  it('rejects a mail address, which a naive scheme prefix once laundered', () => {
    expect(siteUrl('mailto:hi@acme.com')).toBe(null)
  })
})
