import { describe, it, expect } from 'vitest'
import {
  core, matchIssuer, shouldQueryFormD, unavailableReason, classifyFailure, FAILURE,
  clusterRounds, totalRaised, trailingRaised, filingAmount, parseFilingXml, latestRaise,
  filingIndexUrl, recordViolations, needsVerification, trailingSortReadiness, isUsLocation,
  parseIncorporation, preferIncorporation, stripInvisible, norm,
} from './funding.js'
import { initialise, assertSafe } from '../backfill-funding-fields.js'

const round = (date, amountUsd, accession = '0001-24-1') => ({
  date, amountUsd, accession, sourceUrl: filingIndexUrl('123', accession), amountBasis: 'sold',
})

describe('issuer name matching', () => {
  it('matches the same company across legal suffixes', () => {
    expect(matchIssuer('Nalu Medical', 'Nalu Medical, Inc.  (CIK 0001234567)')).toBe('exact')
    expect(matchIssuer('NeuroPace', 'NeuroPace, Inc.')).toBe('exact')
    expect(matchIssuer('Onward Medical', 'Onward Medical N.V.')).toBe('exact')
  })

  it('rejects a bigger namesake rather than inheriting its filings', () => {
    // The failure this pipeline actually had: a prefix match handed RefleXion
    // Medical's rounds to a company called Reflexion.
    expect(matchIssuer('Reflexion', 'RefleXion Medical Inc  (CIK 0001606366)')).toBe(null)
    expect(matchIssuer('Science Corporation', 'Science Applications International Corp')).toBe(null)
  })

  it('rejects investment vehicles that merely name the company', () => {
    expect(matchIssuer('Paradromics', 'SCP Paradromics LLC  (CIK 0002006119)')).toBe(null)
    expect(matchIssuer('Paradromics', 'What If Ventures Paradromics 2022, a series of What If SPV LLC')).toBe(null)
    expect(matchIssuer('Neuralink', 'Neuralink Capital Partners LP')).toBe(null)
  })

  it('accepts a rename only when it is declared, never inferred', () => {
    // The DB has the 2016 name; the filer shortened it in 2021.
    expect(matchIssuer('Axonics Modulation Technologies', 'Axonics, Inc.')).toBe(null)
    expect(matchIssuer('Axonics Modulation Technologies', 'Axonics, Inc.', ['Axonics'])).toBe('alias')
  })

  it('does not drop "Group" or "Holdings" to force a match', () => {
    // This one reached production. Our AURA is a robotics company in Madrid;
    // EDGAR's "Aura Group, Inc." is in Boston. Treating "Group" as a legal
    // suffix made them one company and put $205M of Aura Group's money on the
    // chart at rank 3, above Saluda Medical.
    expect(matchIssuer('AURA', 'Aura Group, Inc.')).toBe(null)
    expect(matchIssuer('Kernel', 'Kernel Holdings Corp')).toBe(null)
    // A company that really is a "Group" still matches its own filings.
    expect(matchIssuer('Aura Group', 'Aura Group, Inc.')).toBe('exact')
    // And the legal suffixes that carry no information still come off.
    expect(matchIssuer('Saluda Medical', 'Saluda Medical Inc  (CIK 0001679788)')).toBe('exact')
  })

  it('does not treat a shared stem as a match', () => {
    // The rule that would find Axonics by dropping generic words also matches
    // these two, which are different companies. Hence the explicit alias list.
    expect(matchIssuer('Neuros Medical', 'Neuros Corp')).toBe(null)
    expect(matchIssuer('Precision Neuroscience', 'Precision Medicine Inc')).toBe(null)
  })

  it('ignores a trailing corporate-structure phrase', () => {
    expect(core('Neuros Medical Inc, a Delaware corporation')).toBe(core('Neuros Medical'))
  })
})

describe('which companies are queried', () => {
  const hasHistory = true

  it('never re-queries Form D for a public, acquired, or defunct company', () => {
    expect(shouldQueryFormD('public', hasHistory)).toBe(false)
    expect(shouldQueryFormD('acquired', hasHistory)).toBe(false)
    expect(shouldQueryFormD('defunct', hasHistory)).toBe(false)
  })

  it('queries one of them once, to establish what it raised while private', () => {
    // Axonics raised through five Form D filings and then listed. Never looking
    // means its private total has no source and cannot be charted.
    expect(shouldQueryFormD('acquired', false)).toBe(true)
  })

  it('queries private companies and unresearched ones', () => {
    expect(shouldQueryFormD('private', hasHistory)).toBe(true)
    expect(shouldQueryFormD('subsidiary', hasHistory)).toBe(true)
    expect(shouldQueryFormD(null, hasHistory)).toBe(true)
  })

  it('never reports an ongoing raise for a public company, even with filings', () => {
    const r = latestRaise({
      status: 'public', searched: true, isUsIssuer: true,
      rounds: [round('2018-04-12', 40e6)],
    })
    expect(r.amountUsd).toBe(null)
    expect(r.reason).toBe('not_applicable_public')
  })

  it('reports the newest round for a private company', () => {
    const r = latestRaise({
      status: 'private', searched: true, isUsIssuer: true,
      rounds: [round('2023-01-01', 20e6), round('2025-06-01', 50e6)],
    })
    expect(r.amountUsd).toBe(50e6)
    expect(r.reason).toBe(null)
  })
})

describe('why a latest raise is absent', () => {
  it('resolves a foreign issuer to foreign_issuer_not_covered', () => {
    expect(unavailableReason({
      status: 'private', isUsIssuer: false, searched: true, filingCount: 0,
    })).toBe('foreign_issuer_not_covered')
  })

  it('resolves a public company to not_applicable_public without searching', () => {
    expect(unavailableReason({
      status: 'public', isUsIssuer: false, searched: false, filingCount: 0,
    })).toBe('not_applicable_public')
  })

  it('resolves an acquired company to not_applicable_acquired', () => {
    expect(unavailableReason({
      status: 'acquired', isUsIssuer: true, searched: false, filingCount: 0,
    })).toBe('not_applicable_acquired')
  })

  it('does not call a defunct company acquired', () => {
    // Before migration 009 widened the CHECK, defunct had to borrow the
    // acquired code, which said Pear Therapeutics was bought when it filed for
    // chapter 11.
    expect(unavailableReason({
      status: 'defunct', isUsIssuer: true, searched: false, filingCount: 0,
    })).toBe('not_applicable_defunct')
  })

  it('prefers the listing status over the foreign-issuer fact when both apply', () => {
    // Onward Medical is both Dutch and listed on Euronext. One enum, one value:
    // the listing is the more specific reason Form D does not apply.
    expect(unavailableReason({
      status: 'public', isUsIssuer: false, searched: false, filingCount: 0,
    })).toBe('not_applicable_public')
  })

  it('says unverified when nothing has been checked yet', () => {
    expect(unavailableReason({
      status: null, isUsIssuer: false, searched: false, filingCount: 0,
    })).toBe('unverified')
  })

  it('says no_filing_found only after a real search of a US issuer', () => {
    expect(unavailableReason({
      status: 'private', isUsIssuer: true, searched: true, filingCount: 0,
    })).toBe('no_filing_found')
  })
})

describe('where a company is', () => {
  it('reads US locations as US', () => {
    expect(isUsLocation('Fremont, CA')).toBe(true)
    expect(isUsLocation('Boston, USA')).toBe(true)
  })

  it('reads foreign locations as not US', () => {
    expect(isUsLocation('Eindhoven, NL')).toBe(false)
    expect(isUsLocation('Sydney, AU')).toBe(false)
  })

  it('says nothing when the string does not say', () => {
    expect(isUsLocation('')).toBe(null)
    expect(isUsLocation(null)).toBe(null)
  })
})

describe('failure classification', () => {
  it('separates the five ways a lookup comes back empty', () => {
    expect(classifyFailure({ searched: false })).toBe(FAILURE.NOT_SEARCHED)
    expect(classifyFailure({ searched: true, hitCount: 0 })).toBe(FAILURE.NO_HITS)
    expect(classifyFailure({ searched: true, hitCount: 9, matchCount: 0 })).toBe(FAILURE.NAME_MISMATCH)
    expect(classifyFailure({ searched: true, hitCount: 9, matchCount: 3, filingCount: 0 })).toBe(FAILURE.NO_AMOUNTS)
    expect(classifyFailure({ searched: true, foundedMismatch: true })).toBe(FAILURE.FOUNDED_MISMATCH)
    expect(classifyFailure({ error: new Error('socket hang up') })).toBe(FAILURE.FETCH_ERROR)
  })

  it('returns null when the lookup succeeded', () => {
    expect(classifyFailure({ searched: true, hitCount: 4, matchCount: 2, filingCount: 2 })).toBe(null)
  })
})

describe('Form D amounts', () => {
  it('reports money sold, not the ceiling the issuer registered', () => {
    expect(filingAmount({ totalAmountSold: 10e6, totalOfferingAmount: 100e6 }))
      .toEqual({ amountUsd: 10e6, amountBasis: 'sold' })
  })

  it('falls back to the offering only when nothing is sold, and flags it', () => {
    expect(filingAmount({ totalAmountSold: 0, totalOfferingAmount: 50e6 }))
      .toEqual({ amountUsd: 50e6, amountBasis: 'offering' })
  })

  it('treats an indefinite offering as no figure at all', () => {
    expect(filingAmount({ totalAmountSold: 0, totalOfferingAmount: 'Indefinite' }))
      .toEqual({ amountUsd: 0, amountBasis: null })
  })

  it('parses the two fields out of a primary document', () => {
    const xml = '<offeringData><totalOfferingAmount>5000000</totalOfferingAmount>' +
      '<totalAmountSold>4200000</totalAmountSold></offeringData>'
    expect(parseFilingXml(xml)).toEqual({ amountUsd: 4200000, amountBasis: 'sold' })
  })
})

describe('rounds', () => {
  it('groups amendments of one offering into a single round', () => {
    const rounds = clusterRounds([
      round('2024-01-10', 20e6, 'a-1'),
      round('2024-03-01', 50e6, 'a-2'),   // 51 days later: same round, restated
      round('2025-06-01', 30e6, 'b-1'),   // over a year later: a new round
    ])
    expect(rounds).toHaveLength(2)
    expect(rounds[0].amountUsd).toBe(50e6)
    expect(rounds[0].filingCount).toBe(2)
    // The round is sourced to the filing the figure came from, not the first one.
    expect(rounds[0].accession).toBe('a-2')
    expect(totalRaised(rounds)).toBe(80e6)
  })

  it('does not sum restatements of the same offering', () => {
    const rounds = clusterRounds([round('2024-01-10', 20e6), round('2024-02-10', 60e6)])
    expect(totalRaised(rounds)).toBe(60e6)
  })

  it('sums only rounds inside the trailing window', () => {
    const rounds = [round('2023-01-01', 100e6), round('2025-06-01', 40e6)]
    expect(trailingRaised(rounds, 24, '2026-07-28')).toBe(40e6)
  })

  it('returns zero, not a bar, for a company with no round in the window', () => {
    expect(trailingRaised([round('2019-01-01', 100e6)], 24, '2026-07-28')).toBe(0)
  })
})

describe('record validation', () => {
  it('fails a figure that has no source URL', () => {
    expect(recordViolations({ total_raised_usd: 250e6, inclusion_basis: 'BCI' }))
      .toContain('total_without_source')
    expect(recordViolations({ latest_raise_usd: 50e6, latest_raise_source_url: null }))
      .toContain('latest_raise_without_source')
  })

  it('fails a round whose amount has no source URL', () => {
    expect(recordViolations({}, [{ amount_usd: 10e6, source_url: null }]))
      .toContain('round_without_source')
  })

  it('fails an absent raise that gives no reason', () => {
    expect(recordViolations({ latest_raise_usd: null })).toContain('missing_unavailable_reason')
  })

  it('fails a record carrying both an amount and an unavailable reason', () => {
    expect(recordViolations({
      latest_raise_usd: 50e6, latest_raise_source_url: 'https://sec.gov/x',
      latest_raise_unavailable_reason: 'no_filing_found',
    })).toContain('amount_and_reason')
  })

  it('fails a stage with no evidence behind it', () => {
    expect(recordViolations({ furthest_stage: 'pivotal', stage_evidence_type: 'none' }))
      .toContain('stage_without_evidence')
  })

  it('fails a funded record with no inclusion basis', () => {
    expect(recordViolations({
      total_raised_usd: 250e6, total_raised_source_url: 'https://sec.gov/x',
    })).toContain('missing_inclusion_basis')
  })

  it('passes a fully sourced record', () => {
    expect(recordViolations({
      total_raised_usd: 250e6, total_raised_source_url: 'https://sec.gov/x',
      latest_raise_usd: 50e6, latest_raise_source_url: 'https://sec.gov/y',
      inclusion_basis: 'Implanted cortical BCI for speech restoration.',
    }, [{ amount_usd: 50e6, source_url: 'https://sec.gov/y' }])).toEqual([])
  })
})

describe('the phase 1 backfill', () => {
  it('never writes a dollar amount', () => {
    const patch = initialise({ id: 'x', name: 'Neuralink', latest_raise_usd: null })
    expect(Object.keys(patch).some(k => /_usd$/.test(k))).toBe(false)
    expect(() => assertSafe([{ id: 'x', name: 'n', total_raised_usd: 1 }])).toThrow(/dollar amount/)
  })

  it('refuses any column outside its allowlist', () => {
    expect(() => assertSafe([{ id: 'x', status: 'private' }])).toThrow(/disallowed column/)
  })

  it('initialises only what is still null, and is a no-op when done', () => {
    expect(initialise({
      id: 'x', name: 'n', display_name: 'n', capital_scope: 'private_only',
      total_raised_confidence: 'unverified', latest_raise_confidence: 'unverified',
      latest_raise_unavailable_reason: 'unverified', stage_evidence_type: 'none',
      latest_raise_usd: null,
    })).toBe(null)
  })
})

describe('verification queue', () => {
  const now = '2026-07-28'

  it('queues a record that has never been verified', () => {
    expect(needsVerification({ total_raised_confidence: 'unverified' }, now)).toBe(true)
  })

  it('queues a verified record once it goes stale', () => {
    expect(needsVerification({
      total_raised_confidence: 'filing_verified', latest_raise_confidence: 'filing_verified',
      last_verified_at: '2026-01-01',
    }, now)).toBe(true)
  })

  it('leaves a fresh, fully verified record alone', () => {
    expect(needsVerification({
      total_raised_confidence: 'filing_verified', latest_raise_confidence: 'filing_verified',
      last_verified_at: '2026-07-01',
    }, now)).toBe(false)
  })
})

describe('trailing sort readiness', () => {
  it('reports not ready when most records hold one round', () => {
    const r = trailingSortReadiness({
      a: [{ date: '2020-01-01' }, { date: '2025-01-01' }],
      b: [{ date: '2025-01-01' }],
      c: [],
    })
    expect(r.qualifying).toBe(1)
    expect(r.ready).toBe(false)
  })

  it('reports ready at 80 percent with three-year spans', () => {
    const spanned = [{ date: '2021-01-01' }, { date: '2025-01-01' }]
    const r = trailingSortReadiness({ a: spanned, b: spanned, c: spanned, d: spanned, e: [] })
    expect(r.share).toBe(0.8)
    expect(r.ready).toBe(true)
  })

  it('does not count a company whose rounds sit inside one year', () => {
    expect(trailingSortReadiness({ a: [{ date: '2025-01-01' }, { date: '2025-06-01' }] }).qualifying).toBe(0)
  })
})

// ── Form D Item 2: when the issuer says it was incorporated ─────────────────

const yearOfInc = inner => `<?xml version="1.0"?><edgarSubmission><primaryIssuer>
  <entityName>Example Neuro Inc</entityName>
  <yearOfInc>${inner}</yearOfInc>
</primaryIssuer></edgarSubmission>`

describe('parseIncorporation', () => {
  it('reads the year a young issuer declares', () => {
    const xml = yearOfInc('<withinFiveYears>true</withinFiveYears><value>2014</value>')
    expect(parseIncorporation(xml, 2015)).toEqual({ kind: 'exact', year: 2014 })
  })

  it('turns "over five years ago" into a dated bound', () => {
    const xml = yearOfInc('<overFiveYears>true</overFiveYears>')
    expect(parseIncorporation(xml, 2021)).toEqual({ kind: 'bound', before: 2016 })
  })

  it('will not invent a bound without the filing year', () => {
    const xml = yearOfInc('<overFiveYears>true</overFiveYears>')
    expect(parseIncorporation(xml, null)).toEqual({ kind: 'unknown' })
  })

  it('reports an issuer that did not exist yet at filing time', () => {
    const xml = yearOfInc('<yetToBeFormed>true</yetToBeFormed>')
    expect(parseIncorporation(xml, 2020)).toEqual({ kind: 'planned' })
  })

  it('reports unknown when the form carries no yearOfInc at all', () => {
    expect(parseIncorporation('<edgarSubmission></edgarSubmission>', 2020))
      .toEqual({ kind: 'unknown' })
  })

  /**
   * The bug the scoping probe actually had. A <value> tag elsewhere in the
   * document must not be mistaken for the incorporation year: reading it off
   * the whole document reported 27 of 45 real filings as having no year.
   */
  it('ignores a value tag outside the yearOfInc block', () => {
    const xml = `<?xml version="1.0"?><edgarSubmission>
      <submissionType><value>D</value></submissionType>
      <primaryIssuer><yearOfInc><withinFiveYears>true</withinFiveYears><value>2019</value></yearOfInc></primaryIssuer>
    </edgarSubmission>`
    expect(parseIncorporation(xml, 2019)).toEqual({ kind: 'exact', year: 2019 })
  })

  it('is not fooled by a value tag outside the block when there is no year inside', () => {
    const xml = `<?xml version="1.0"?><edgarSubmission>
      <submissionType><value>2001</value></submissionType>
      <primaryIssuer><yearOfInc><overFiveYears>true</overFiveYears></yearOfInc></primaryIssuer>
    </edgarSubmission>`
    expect(parseIncorporation(xml, 2021)).toEqual({ kind: 'bound', before: 2016 })
  })
})

describe('preferIncorporation', () => {
  const exact = year => ({ kind: 'exact', year })
  const bound = before => ({ kind: 'bound', before })

  it('takes whichever reading exists when only one does', () => {
    expect(preferIncorporation(null, bound(2010))).toEqual(bound(2010))
    expect(preferIncorporation(exact(2010), null)).toEqual(exact(2010))
    expect(preferIncorporation(null, null)).toBe(null)
  })

  it('prefers an exact year to a bound, whichever order they arrive in', () => {
    expect(preferIncorporation(bound(2016), exact(2009))).toEqual(exact(2009))
    expect(preferIncorporation(exact(2009), bound(2016))).toEqual(exact(2009))
  })

  it('keeps the stronger of two bounds, which is the earlier one', () => {
    // Both are true of the same company, but "no later than 2004" implies "no
    // later than 2011", so it is the claim with more in it: at least 22 years
    // old rather than at least 15. Keeping 2011 understates the company's age.
    expect(preferIncorporation(bound(2004), bound(2011))).toEqual(bound(2004))
    expect(preferIncorporation(bound(2011), bound(2004))).toEqual(bound(2004))
  })

  it('does not let a weaker bound from a later filing overwrite a stronger one', () => {
    // The order the sweep sees them in must not change the answer.
    const seen = [bound(2016), bound(2004), bound(2011)]
    expect(seen.reduce((acc, r) => preferIncorporation(acc, r), null)).toEqual(bound(2004))
  })

  it('keeps the earliest exact year, since reincorporating resets the later one', () => {
    // Saluda Medical reads 2013 on an early filing and 2023 after redomiciling.
    expect(preferIncorporation(exact(2023), exact(2013))).toEqual(exact(2013))
  })

  it('prefers a bound to nothing usable', () => {
    expect(preferIncorporation({ kind: 'unknown' }, bound(2010))).toEqual(bound(2010))
  })
})

describe('invisible characters in stored names', () => {
  /**
   * A real row: "DeepBrainz​" carries a trailing zero-width space. It is
   * invisible everywhere, and it made the company reappear in the unsearched
   * queue after it had been recorded, because two strings that looked identical
   * were not.
   */
  it('normalises a name carrying a zero-width space', () => {
    expect(core('DeepBrainz​')).toBe(core('DeepBrainz'))
    expect(norm('DeepBrainz​')).toBe('deepbrainz')
  })

  it('strips the whole family of invisible marks', () => {
    for (const ch of ['​', '‌', '‍', '⁠', '﻿', '‎']) {
      expect(core(`Acme${ch} Neuro`), JSON.stringify(ch)).toBe(core('Acme Neuro'))
    }
  })

  it('exposes the strip on its own, for callers comparing raw names', () => {
    expect(stripInvisible('DeepBrainz​')).toBe('DeepBrainz')
    expect(stripInvisible('plain')).toBe('plain')
    expect(stripInvisible(null)).toBe('')
  })

  it('leaves visible characters alone', () => {
    expect(stripInvisible('Sim&Cure — Grabels')).toBe('Sim&Cure — Grabels')
  })
})
