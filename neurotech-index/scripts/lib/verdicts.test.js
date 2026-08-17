import { describe, it, expect } from 'vitest'
import { normalise, CANONICAL } from './verdicts.js'
import { readFileSync } from 'node:fs'

describe('normalise', () => {
  it('passes a canonical tag through', () => {
    for (const tag of Object.keys(CANONICAL)) expect(normalise(tag)).toBe(tag)
  })

  it('collapses the five ways the file said "no year"', () => {
    for (const s of ['no year', 'no year found', 'no founding year found',
      'no founding year established', 'no year stated'])
      expect(normalise(s)).toBe('no-year')
  })

  it('collapses case variants that were the same category', () => {
    expect(normalise('not a company')).toBe('not-a-company')
    expect(normalise('NOT A COMPANY')).toBe('not-a-company')
    expect(normalise('NOT A COMPANY - EU research project')).toBe('not-a-company')
  })

  it('tolerates surrounding whitespace', () => {
    expect(normalise('  scope question  ')).toBe('scope')
  })

  it('throws on an unknown verdict rather than inventing a category', () => {
    // A silent default is how the drift started: a new phrasing would land in an
    // "other" bucket and never be looked at again.
    expect(() => normalise('something new')).toThrow(/unknown verdict/)
    expect(() => normalise('')).toThrow(/unknown verdict/)
    expect(() => normalise(null)).toThrow(/unknown verdict/)
  })

  it('names the valid tags in the error, so the fix is obvious', () => {
    expect(() => normalise('mystery')).toThrow(/not-a-company/)
  })

  it('is not fooled by a tag that only looks canonical', () => {
    expect(() => normalise('not-a-companies')).toThrow()
    expect(() => normalise('SCOPE')).toThrow()
  })
})

describe('the committed data file', () => {
  const rows = JSON.parse(readFileSync('scripts/data/founding-unresolved.json', 'utf8'))

  it('has a verdict on every entry that normalises', () => {
    for (const r of rows) {
      expect(() => normalise(r.verdict), `${r.name}: ${r.verdict}`).not.toThrow()
    }
  })

  it('carries a name and a note on every entry', () => {
    for (const r of rows) {
      expect(r.name, JSON.stringify(r)).toBeTruthy()
      expect(r.note, r.name).toBeTruthy()
    }
  })

  it('carries a url except where the finding is that there is nothing to link', () => {
    // A null url is honest for a row whose whole problem is having no website.
    // It is not honest anywhere else, because the note would then be unbacked.
    const NO_LINK_OK = new Set(['no-website', 'existence-unverified', 'not-a-company'])
    for (const r of rows.filter(r => !r.url)) {
      expect(NO_LINK_OK.has(normalise(r.verdict)), `${r.name} (${r.verdict})`).toBe(true)
    }
  })

  it('names exactly one company per entry', () => {
    // Six companies were once filed under a single comma-joined name, which no
    // name lookup could ever have matched. A comma is not itself the tell:
    // "Setagon, Inc" and "SOFIA Labs, LLC" are one company each. What matters is
    // whether what follows the comma is a legal suffix or another company.
    const SUFFIX = /^(inc|llc|ltd|limited|corp|corporation|co|plc|sa|nv|bv|gmbh|ab|oy|as|aps|srl|sl|spa|pty|kk|ag)\.?$/i
    for (const r of rows) {
      const tail = r.name.split(',').slice(1).map(s => s.trim())
      const notASuffix = tail.filter(t => !SUFFIX.test(t))
      expect(notASuffix, r.name).toEqual([])
    }
  })

  it('names each company at most once', () => {
    const seen = new Set()
    const dupes = []
    for (const r of rows) { if (seen.has(r.name)) dupes.push(r.name); seen.add(r.name) }
    expect(dupes).toEqual([])
  })
})
