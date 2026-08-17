import { it, expect } from 'vitest'
import { findingError, lowConfidenceReason, EARLIEST_YEAR, VALID_KINDS } from './findings.js'

const YEAR = 2026
const ok = (over = {}) => ({
  name: 'Example', year: 2015, kind: 'company_site',
  url: 'https://example.com/about', evidence: 'Founded in 2015.',
  confidence: 'high', ...over,
})

it('a well-formed finding is accepted', () => {
  expect(findingError(ok(), 1, YEAR)).toBe(null)
})

// --- name matching -----------------------------------------------------------
// The rule that exists because "Aura" once matched "Aura Group" and took $205M.

it('a name matching no row is refused', () => {
  expect(findingError(ok(), 0, YEAR)).toBe('matches 0 rows in the database')
})

it('a name matching two rows is refused rather than guessed at', () => {
  // The real case: "Precision Neuroscience" and "PrecisionNeuroscience" hash to
  // different UUIDv5 ids, so both rows exist and the 2021 year cannot be placed.
  expect(findingError(ok({ name: 'PrecisionNeuroscience' }), 2, YEAR)).toBe('matches 2 rows in the database')
})

// --- year plausibility -------------------------------------------------------

it('Carl Zeiss 1846 is accepted; a 1900 floor rejected a real company', () => {
  const zeiss = ok({ name: 'Carl Zeiss', year: 1846, kind: 'company_site' })
  expect(findingError(zeiss, 1, YEAR)).toBe(null)
})

it('a year before the floor is still refused', () => {
  expect(findingError(ok({ year: 1720 }), 1, YEAR)).toBe('implausible year 1720')
  expect(EARLIEST_YEAR > 1720).toBeTruthy()
})

it('a year in the future is refused', () => {
  expect(findingError(ok({ year: YEAR + 1 }), 1, YEAR)).toBe(`implausible year ${YEAR + 1}`)
})

it('the current year is allowed', () => {
  expect(findingError(ok({ year: YEAR }), 1, YEAR)).toBe(null)
})

it('a missing or non-numeric year is refused rather than coerced', () => {
  expect(findingError(ok({ year: undefined }), 1, YEAR)).toMatch(/^implausible year/)
  expect(findingError(ok({ year: 'a while ago' }), 1, YEAR)).toMatch(/^implausible year/)
})

// --- source ------------------------------------------------------------------

it('an unknown source kind is refused', () => {
  expect(findingError(ok({ kind: 'linkedin' }), 1, YEAR)).toBe('unknown source kind "linkedin"')
  expect(!VALID_KINDS.has('linkedin')).toBeTruthy()
})

it('every kind but record_description needs a URL', () => {
  expect(findingError(ok({ url: null }), 1, YEAR)).toBe('no source URL')
  const own = ok({ kind: 'record_description', url: null })
  expect(findingError(own, 1, YEAR)).toBe(null)
})

// --- low confidence ----------------------------------------------------------
// The rule that was backwards: a CONTRADICTED weak year was written and an
// uncontested one was refused.

it('a low-confidence finding with nothing explaining it is refused', () => {
  const bare = ok({ confidence: 'low', conflict: undefined, caveat: undefined })
  expect(findingError(bare, 1, YEAR)).toBe('low confidence with neither a conflict nor a caveat recorded')
})

it('a conflict admits a low-confidence finding', () => {
  const f = ok({ confidence: 'low', conflict: 'A grant covering 2009 predates the claimed 2010 start.' })
  expect(findingError(f, 1, YEAR)).toBe(null)
})

it('a caveat admits a low-confidence finding, which a conflict-only rule refused', () => {
  // Avalon AI: aggregator-only, nothing contradicts it, and the old rule threw
  // it out for being uncontested.
  const f = ok({
    name: 'Avalon AI', year: 2015, kind: 'aggregator', confidence: 'low',
    caveat: 'Aggregator-only; UK Companies House has no matching entity.',
  })
  expect(findingError(f, 1, YEAR)).toBe(null)
  expect(lowConfidenceReason(f)).toBe('Aggregator-only; UK Companies House has no matching entity.')
})

it('an empty-string caveat does not count as a reason', () => {
  const f = ok({ confidence: 'low', caveat: '' })
  expect(findingError(f, 1, YEAR)).toMatch(/^low confidence with neither/)
})

it('medium and high confidence need no explanation', () => {
  for (const confidence of ['medium', 'high']) {
    expect(findingError(ok({ confidence }), 1, YEAR)).toBe(null)
  }
})

it('a conflict is preferred over a caveat when both are present', () => {
  const f = ok({ confidence: 'low', conflict: 'Sources say 2011 and 2013.', caveat: 'Thin.' })
  expect(lowConfidenceReason(f)).toBe('Sources say 2011 and 2013.')
})

// --- ordering ----------------------------------------------------------------

it('the row-count check runs first, so an unmatched name is not also blamed for its year', () => {
  const bad = ok({ year: 1720, kind: 'linkedin', url: null })
  expect(findingError(bad, 0, YEAR)).toBe('matches 0 rows in the database')
})
