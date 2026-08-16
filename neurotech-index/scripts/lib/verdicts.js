/**
 * verdicts.js — the controlled vocabulary for founding-unresolved.json.
 *
 * That file is the most useful thing the founding sweep produced. It records,
 * with a URL each, every row that could not take a founding year and why:
 * duplicates, rows named after products, rows that are not companies, dead
 * domains, wrong locations. It is meant to be worked through by a person.
 *
 * It was written across many rounds and its `verdict` field drifted into 60-odd
 * distinct strings for about 17 real categories — "no year", "no year found",
 * "no founding year found" and "no founding year established" all meaning
 * exactly one thing, plus case variants of the same words. A field like that
 * cannot be counted, sorted or filtered, which defeats the point of having it.
 *
 * So: one canonical tag per entry, from CANONICAL below. `normalise` maps every
 * string the file has ever held. It THROWS on anything it does not recognise
 * rather than defaulting, because a silent default is how the drift started —
 * a new phrasing would land in an "other" bucket and never be noticed.
 *
 * Where an entry has more than one problem, the verdict names the one that
 * decides what to DO with the row, and the note carries the rest. A row that is
 * both out of scope and has a dead domain is a scope decision: whether it stays
 * in the index at all does not depend on the domain.
 */

/** The tags, most consequential first: what a person would act on. */
export const CANONICAL = {
  'not-a-company': 'A research project, consortium, society, grant, facility, publication or book.',
  'duplicate': 'The same company as another row in the index.',
  'product-not-company': 'Named after a product; the founding year belongs to a parent the index does not name.',
  'wrong-entity': 'The row describes a different company than its name says.',
  'scope': 'Probably not neurotechnology.',
  'dissolved': 'Confirmed closed by a registry.',
  'acquired': 'Absorbed into another company and no longer independent.',
  'renamed': 'Still one company, but trading under a different name than the row.',
  'dead-domain': 'The website does not resolve, is parked, or was resold to someone else.',
  'stale-url': 'The company is alive; the website in the index has moved.',
  'no-website': 'The index has no usable website for it.',
  'existence-unverified': 'Could not establish that the company exists at all.',
  'incorporation-only': 'Only an incorporation date could be found, which is not a founding.',
  'year-disputed': 'Sources give different years and none is decisive.',
  'no-year': 'Searched, and no founding year is recorded anywhere findable.',
  'wrong-location': 'The location field is wrong.',
  'wrong-description': 'The stored description describes something else.',
  'withdrawn': 'A year was recorded and then retracted on verification.',
}

/**
 * Every verdict string the file has held, mapped to its canonical tag.
 * Explicit rather than fuzzy: a mapping table can be reviewed, a regex cannot.
 */
const ALIASES = {
  // not a company
  'not a company': 'not-a-company',
  'NOT A COMPANY': 'not-a-company',
  'NOT A COMPANY - EU research project': 'not-a-company',
  'NOT A COMPANY - open-source academic project': 'not-a-company',
  'NOT A COMPANY - content farm': 'not-a-company',
  'no founding year; likely not a company': 'not-a-company',
  'dead domain, no company entity': 'not-a-company',
  // duplicate
  'duplicate of Onward Medical under a former name': 'duplicate',
  'DUPLICATE OF INCEREB - confirmed': 'duplicate',
  'ambiguous - two companies': 'duplicate',
  // product, not company
  'product not company': 'product-not-company',
  'row is named after a product': 'product-not-company',
  'TWO DIFFERENT PRODUCTS CONFLATED': 'product-not-company',
  'subsidiary launch, not a founding': 'product-not-company',
  // wrong entity
  'wrong entity': 'wrong-entity',
  'WRONG COMPANY IN THE INDEX': 'wrong-entity',
  'WRONG NAME IN THE INDEX': 'wrong-entity',
  'misspelled': 'wrong-entity',
  // scope
  'scope question': 'scope',
  'no founding year; scope question': 'scope',
  'aggregator-only, and a scope question': 'scope',
  'scope questions - six therapy or wellness services in one batch': 'scope',
  'scope question and a rebrand': 'scope',
  'possible mis-inclusion': 'scope',
  'NOT NEUROTECH - mis-described row': 'scope',
  // lifecycle
  'dissolved': 'dissolved',
  'defunct': 'dissolved',
  'acquired': 'acquired',
  'renamed': 'renamed',
  'rebrand': 'renamed',
  'entity chain': 'renamed',
  // website
  'dead domain': 'dead-domain',
  'dead page': 'dead-domain',
  'dead domain, almost certainly defunct': 'dead-domain',
  'no year; domain dead and namesakes everywhere': 'dead-domain',
  'STALE ROW - domain now belongs to someone else': 'dead-domain',
  'stale url': 'stale-url',
  'site is password-gated, not abandoned': 'stale-url',
  'no website': 'no-website',
  'cannot search': 'no-website',
  // existence
  'existence unverified': 'existence-unverified',
  'cannot verify the company exists': 'existence-unverified',
  // dating
  'incorporation only': 'incorporation-only',
  'incorporation only, no founding statement': 'incorporation-only',
  'sources disagree, unresolved': 'year-disputed',
  'year unresolved': 'year-disputed',
  'three candidate years, none of them a founding statement': 'year-disputed',
  'no year': 'no-year',
  'no year found': 'no-year',
  'no founding year found': 'no-year',
  'no founding year established': 'no-year',
  'no year stated': 'no-year',
  'year is inferred, not stated': 'no-year',
  'no year; existed by 2006': 'no-year',
  // field errors
  'wrong location': 'wrong-location',
  'location wrong': 'wrong-location',
  'no year, and the location is wrong': 'wrong-location',
  'no year, and the location looks wrong': 'wrong-location',
  'location and product both look wrong': 'wrong-location',
  'no year, and OUR PRODUCT DESCRIPTION IS WRONG': 'wrong-description',
  // verification
  'withdrawn after verification': 'withdrawn',
}

/**
 * @returns {string} the canonical tag
 * @throws when the verdict is not recognised — deliberately, so a new phrasing
 *   is a loud failure rather than a quiet new category.
 */
export function normalise(verdict) {
  const v = String(verdict ?? '').trim()
  if (Object.hasOwn(CANONICAL, v)) return v
  if (Object.hasOwn(ALIASES, v)) return ALIASES[v]
  throw new Error(
    `unknown verdict ${JSON.stringify(v)}. Add it to ALIASES in scripts/lib/verdicts.js, ` +
    `or use one of: ${Object.keys(CANONICAL).join(', ')}`)
}
