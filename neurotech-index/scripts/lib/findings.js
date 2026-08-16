/**
 * findings.js — whether a hand-gathered founding year may be written.
 *
 * Extracted from apply-search-findings.js, where it was inline and therefore
 * untested, and where two of its rules were wrong in ways nobody could see
 * without running the whole pipeline against a live database.
 *
 * The rules exist because founding-findings.json is assembled by hand from web
 * searches, which is exactly where a wrong year slips in.
 */

export const VALID_KINDS = new Set([
  'company_site', 'wikidata', 'wikipedia', 'record_description',
  'companies_house', 'press', 'aggregator',
])

/**
 * The earliest year worth believing.
 *
 * This was 1900 until Carl Zeiss — founded in Jena on 17 November 1846, and in
 * this index because it makes surgical microscopes — was rejected as
 * "implausible year 1846". The floor was guarding against a parsed street number
 * or a four-digit product code, and 1900 was a guess that happened to exclude a
 * real company. 1800 still catches the failure it was meant to catch: no
 * neurotechnology company predates it, and a stray "1720" is still refused.
 */
export const EARLIEST_YEAR = 1800

/**
 * A low-confidence year must arrive with the reason it is shaky attached.
 *
 * Originally that reason had to be a `conflict` — another credible year. That
 * had it backwards. A weak year that some source CONTRADICTS was written, while
 * a weak year that nothing contradicts was refused. So an aggregator entry that
 * every other source agreed with was rejected precisely because it was
 * uncontested, and one with a live dispute sailed through.
 *
 * A `caveat` now satisfies the same requirement: a plain statement of why the
 * evidence is thin ("Crunchbase only; no company page states a year"). The
 * invariant is unchanged — a shaky year never arrives bare — but it is now
 * satisfiable by the honest description of thin evidence, which is the common
 * case, rather than only by a dispute, which is the rare one.
 */
export function lowConfidenceReason(f) {
  return f.conflict || f.caveat || null
}

/**
 * @returns {string|null} why this finding must not be written, or null if it may be.
 * `matchCount` is how many database rows the name matched: not one is fatal,
 * because guessing which row is the point of failure this whole file prevents.
 */
export function findingError(f, matchCount, currentYear) {
  if (matchCount !== 1) return `matches ${matchCount} rows in the database`
  if (!VALID_KINDS.has(f.kind)) return `unknown source kind "${f.kind}"`
  if (f.kind !== 'record_description' && !f.url) return 'no source URL'
  if (!(f.year >= EARLIEST_YEAR && f.year <= currentYear)) return `implausible year ${f.year}`
  if (f.confidence === 'low' && !lowConfidenceReason(f)) {
    return 'low confidence with neither a conflict nor a caveat recorded'
  }
  return null
}
