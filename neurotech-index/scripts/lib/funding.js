/**
 * funding.js — the pure decision logic behind funding ingestion.
 *
 * Everything here is a function of its arguments: no network, no database, no
 * clock. That is the point. The rules that decide whether a company is queried
 * at all, what an absent figure means, and which filings form one round are the
 * rules most likely to be wrong, so they live where a test can reach them.
 *
 * Amounts are whole US dollars throughout. The old JSON overlay stored millions;
 * the conversion happens at the edge, in the ingestion script.
 */

// ── Issuer name matching ────────────────────────────────────────────────────

/** Issuer names that are never the operating company itself. */
const BAD_ISSUER = /\b(spv|fund|trust|partners|capital|ventures|holdings|series|lp|l\.p\.)\b/i

/** Legal-entity words, dropped before comparing two names. */
const LEGAL = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|lp|llp|plc|gmbh|ag|sa|bv|nv|oy|ab|as|srl|spa|pbc|holdings|group|the)\b/gi

/** Trailing corporate-structure phrases that a filer adds and a database does
 *  not: "Neuros Medical Inc, a Delaware corporation" and the like. */
const TAIL = /\b(a|an)\s+[a-z\s]+\b(corporation|company|partnership|series)\b.*$/i

export const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * The comparable core of a company name: drop EDGAR's "(CIK ...)" suffix, drop
 * a trailing structure phrase, drop legal-entity words, then normalise.
 *
 * Exact equality of cores is the match test, not a prefix test. "RefleXion
 * Medical Inc" does not match "Reflexion"; "Nalu Medical, Inc." still matches
 * "Nalu Medical". A prefix test admits every bigger namesake, which is the
 * failure mode this pipeline had.
 */
export const core = s => norm(
  String(s || '')
    // EDGAR appends "(CIK 0001603756)" and, for a listed issuer, "(AXNX)".
    // Stripping only the CIK left the ticker in the string, so every public
    // company failed to match its own filings. Axonics has five Form D filings
    // and the pipeline reported none.
    .replace(/\([^)]*\)/g, ' ')
    // Periods next, so "N.V." and "L.P." reach the LEGAL strip as words.
    .replace(/\./g, '')
    .replace(TAIL, ' ')
    .replace(LEGAL, ' ')
)

/**
 * Does an EDGAR issuer display name refer to the company we asked about?
 * Returns 'exact' | 'alias' | null.
 *
 * The test is equality of cores, never a prefix or a shared stem. An earlier
 * draft of this function accepted a match when one name was the other minus
 * generic industry words, so that "Axonics Modulation Technologies" would find
 * "Axonics, Inc." after the 2021 rename. Its own test killed it: that rule also
 * matches "Neuros Medical" against "Neuros Corp", which is a different company.
 * The two cases are structurally identical, so no amount of tuning separates
 * them.
 *
 * Renames are handled instead by `aliases`, an explicit list. Asserting that two
 * names are one company is a factual claim about the world, exactly like a
 * dollar figure, so it carries a source URL in scripts/data/company-aliases.json
 * rather than being inferred from string shape.
 *
 * @param {string} queryName    the name in our database
 * @param {string} displayName  the EDGAR issuer display name
 * @param {string[]} aliases    known alternate names for queryName
 */
export function matchIssuer(queryName, displayName, aliases = []) {
  if (!queryName || !displayName) return null
  if (BAD_ISSUER.test(displayName)) return null
  const dn = core(displayName)
  if (!dn) return null
  if (dn === core(queryName)) return 'exact'
  if (aliases.some(a => core(a) === dn)) return 'alias'
  return null
}

// ── Which companies get queried at all ──────────────────────────────────────

/** Statuses for which a private round is not the relevant instrument. */
const CLOSED_TO_PRIVATE = new Set(['public', 'acquired', 'defunct'])

/**
 * Should this company be queried against Form D on this run?
 *
 * The spec says a public or acquired company is never queried. Taken literally
 * that also throws away their history, and the project decision is the opposite:
 * their private totals are real and are the most interesting figures on the
 * chart, because they show what it cost to reach an IPO or an acquisition.
 * Axonics raised through five Form D filings between 2014 and 2018 and then
 * listed; refusing to look means its $163M has no source and cannot be shown.
 *
 * So the rule splits in two. A company whose private-raising history is already
 * recorded is never queried again once it goes public, is acquired, or dies:
 * that history is closed and re-querying it only risks picking up a subsidiary
 * or a namesake. A company with no history yet is queried once, whatever its
 * status, to establish what it raised while private.
 *
 * The other half of the spec's intent is enforced by `latestRaise` below, which
 * never reports an ongoing raise for these companies no matter what a query
 * returns.
 */
export function shouldQueryFormD(status, hasStoredHistory = false) {
  if (CLOSED_TO_PRIVATE.has(status)) return !hasStoredHistory
  return true
}

/**
 * The latest raise to display, or the reason there is none.
 *
 * For a public, acquired, or defunct company the answer is always a reason, even
 * when Form D filings exist. Those filings are history: reporting the last one
 * as "latest raise" next to a live private round implies the company is still
 * raising, which is the misreading the status branch exists to prevent.
 */
export function latestRaise({ status, rounds = [], isUsIssuer, searched }) {
  if (CLOSED_TO_PRIVATE.has(status)) {
    return { amountUsd: null, reason: unavailableReason({ status, isUsIssuer, searched, filingCount: rounds.length }) }
  }
  const newest = [...rounds].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]
  if (!newest || !newest.amountUsd) {
    return { amountUsd: null, reason: unavailableReason({ status, isUsIssuer, searched, filingCount: rounds.length }) }
  }
  return { amountUsd: newest.amountUsd, date: newest.date, round: newest, reason: null }
}

/**
 * Why this company has no latest-raise figure. One value, from the enum in
 * migration 008, replacing the single "n/a" that stood for five situations.
 *
 * Order matters. A company can be several of these at once (Onward Medical is
 * both publicly listed and a non-US issuer), and the most specific fact about
 * why Form D does not apply comes first.
 *
 * @param {object} o
 * @param {string|null} o.status        organizations.status
 * @param {boolean} o.isUsIssuer        true when a US CIK was resolved
 * @param {boolean} o.searched          true when EDGAR was actually queried
 * @param {number} o.filingCount        filings found for the resolved issuer
 */
export function unavailableReason({ status, isUsIssuer, searched, filingCount }) {
  if (status === 'public') return 'not_applicable_public'
  if (status === 'acquired' || status === 'defunct') return 'not_applicable_acquired'
  if (!searched) return 'unverified'
  if (!isUsIssuer) return 'foreign_issuer_not_covered'
  if (!filingCount) return 'no_filing_found'
  return 'no_filing_found'
}

/**
 * The distinct ways a lookup can come back empty. The old pipeline collapsed all
 * of these into `{ source: 'none' }`, which is why nobody could tell a foreign
 * issuer from a broken matcher. These codes are for the run log and the audit
 * trail; `unavailableReason` maps them onto the far smaller display enum.
 */
export const FAILURE = {
  NOT_SEARCHED: 'not_searched',           // skipped by shouldQueryFormD
  NO_HITS: 'no_hits',                     // EDGAR returned nothing for the name
  NAME_MISMATCH: 'name_mismatch',         // hits existed, none was this company
  NO_AMOUNTS: 'no_amounts',               // issuer matched, every filing parsed to zero
  FOUNDED_MISMATCH: 'founded_mismatch',   // filings predate the company: a namesake
  FETCH_ERROR: 'fetch_error',             // network or parse failure
}

/**
 * Classify an empty result. Kept separate from the fetching so the reason a
 * lookup failed is decided by rules, not by wherever the code happened to
 * return null.
 */
export function classifyFailure({ searched, hitCount, matchCount, filingCount, foundedMismatch, error }) {
  if (error) return FAILURE.FETCH_ERROR
  if (!searched) return FAILURE.NOT_SEARCHED
  if (foundedMismatch) return FAILURE.FOUNDED_MISMATCH
  if (!hitCount) return FAILURE.NO_HITS
  if (!matchCount) return FAILURE.NAME_MISMATCH
  if (!filingCount) return FAILURE.NO_AMOUNTS
  return null
}

// ── Where a company is ──────────────────────────────────────────────────────

const US_STATES = new Set(('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN ' +
  'MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR').split(' '))

/**
 * Is this organization a US entity, judged from the location string the DB
 * already holds? Returns true, false, or null when the string does not say.
 *
 * Locations in this database look like "Fremont, CA", "Boston, USA",
 * "Eindhoven, NL", "Sydney, AU". The last comma-separated token is the signal.
 *
 * This is only ever a fallback. A resolved CIK is proof that a company files
 * with the SEC and outranks it: Saluda Medical is in Sydney and files Form D
 * through a US entity, so a location-only rule would wrongly exempt it.
 */
export function isUsLocation(location) {
  const tail = String(location || '').split(',').pop()?.trim().toUpperCase()
  if (!tail) return null
  if (tail === 'USA' || tail === 'US' || tail === 'UNITED STATES') return true
  if (US_STATES.has(tail)) return true
  if (/^[A-Z]{2}$/.test(tail)) return false     // a two-letter non-US country code
  if (/^[A-Z]{3,}$/.test(tail)) return false    // a spelled-out foreign country
  return null
}

// ── Rounds ──────────────────────────────────────────────────────────────────

/** Filings this far apart in days belong to different rounds. */
export const ROUND_GAP_DAYS = 120

/**
 * Group Form D filings into rounds. A round is a run of filings no more than
 * ROUND_GAP_DAYS apart; its amount is the largest single filing in the run, and
 * it is dated and sourced to that filing.
 *
 * Why the largest rather than the sum: a company amends a Form D as a round
 * closes, and each amendment restates the cumulative total for that offering.
 * Summing them counts the same dollars several times over.
 *
 * @param {Array<{date:string, amountUsd:number, accession:string, sourceUrl:string, amountBasis:string}>} filings
 * @returns {Array<{date:string, amountUsd:number, accession:string, sourceUrl:string, amountBasis:string, filingCount:number}>}
 */
export function clusterRounds(filings) {
  const sorted = [...filings].sort((a, b) => a.date.localeCompare(b.date))
  const rounds = []
  let cur = null
  for (const f of sorted) {
    const gap = cur ? (new Date(f.date) - new Date(cur.date)) / 864e5 : Infinity
    if (gap > ROUND_GAP_DAYS) {
      cur = { ...f, filingCount: 1 }
      rounds.push(cur)
    } else {
      cur.filingCount++
      cur.date = f.date
      // The round keeps the biggest filing, and its provenance travels with it.
      if (f.amountUsd > cur.amountUsd) {
        cur.amountUsd = f.amountUsd
        cur.accession = f.accession
        cur.sourceUrl = f.sourceUrl
        cur.amountBasis = f.amountBasis
      }
    }
  }
  return rounds
}

/** Lifetime disclosed capital: one contribution per round. */
export const totalRaised = rounds => rounds.reduce((n, r) => n + (r.amountUsd || 0), 0)

/** Capital raised in rounds dated within `months` of `asOf`. */
export function trailingRaised(rounds, months, asOf) {
  const cutoff = new Date(asOf)
  cutoff.setMonth(cutoff.getMonth() - months)
  return rounds
    .filter(r => r.date && new Date(r.date) >= cutoff)
    .reduce((n, r) => n + (r.amountUsd || 0), 0)
}

// ── Form D amounts ──────────────────────────────────────────────────────────

/**
 * What a Form D says was raised.
 *
 * totalAmountSold is money actually taken. totalOfferingAmount is the ceiling
 * the issuer registered, which it may never reach. The old pipeline used
 * max(sold, offering), so a company that registered $100M and sold $10M was
 * charted at $100M. That is a figure the filing does not support.
 *
 * This prefers sold, and falls back to the offering only when nothing has been
 * sold yet, flagging the basis so the fallback is visible downstream rather than
 * indistinguishable from real money.
 *
 * "Indefinite" is a legal value in this field and is not a number.
 */
export function filingAmount({ totalAmountSold, totalOfferingAmount }) {
  const sold = Number(totalAmountSold)
  const offered = Number(totalOfferingAmount)
  if (Number.isFinite(sold) && sold > 0) return { amountUsd: sold, amountBasis: 'sold' }
  if (Number.isFinite(offered) && offered > 0) return { amountUsd: offered, amountBasis: 'offering' }
  return { amountUsd: 0, amountBasis: null }
}

/** Parse the two amount fields out of a Form D primary_doc.xml. */
export function parseFilingXml(xml) {
  const pick = tag => xml.match(new RegExp(`<${tag}>([^<]+)<`))?.[1] ?? null
  return filingAmount({
    totalAmountSold: pick('totalAmountSold'),
    totalOfferingAmount: pick('totalOfferingAmount'),
  })
}

// ── URLs ────────────────────────────────────────────────────────────────────

const bareCik = cik => String(cik).replace(/^0+/, '')
const bareAdsh = adsh => String(adsh).replace(/-/g, '')

/** The document the amounts were read from. */
export const filingDocUrl = (cik, adsh) =>
  `https://www.sec.gov/Archives/edgar/data/${bareCik(cik)}/${bareAdsh(adsh)}/primary_doc.xml`

/** The human-readable filing page. This is what gets stored as source_url and
 *  shown to a reader who wants to check a number. */
export const filingIndexUrl = (cik, adsh) =>
  `https://www.sec.gov/Archives/edgar/data/${bareCik(cik)}/${bareAdsh(adsh)}/${adsh}-index.htm`

/** The issuer's filing history, cited as the source for a status value. */
export const issuerUrl = cik =>
  `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${String(cik).padStart(10, '0')}&type=&dateb=&owner=include&count=40`

// ── Record validation ───────────────────────────────────────────────────────

/**
 * The integrity rules, as a pure function, so they can be checked before a write
 * as well as after one. scripts/validate-funding.js runs the same rules as
 * queries against the whole table, and migration 008 enforces the two most
 * important ones as CHECK constraints. Three statements of the same rule is
 * deliberate: the constraint stops a bad write, the query catches a record that
 * predates the constraint, and this catches it before the round trip.
 *
 * @returns {string[]} rule ids violated; empty means the record is sound
 */
export function recordViolations(org = {}, rounds = []) {
  const bad = []
  if (org.total_raised_usd != null && !org.total_raised_source_url) bad.push('total_without_source')
  if (org.latest_raise_usd != null && !org.latest_raise_source_url) bad.push('latest_raise_without_source')
  if (org.latest_raise_usd == null && !org.latest_raise_unavailable_reason) bad.push('missing_unavailable_reason')
  if (org.latest_raise_usd != null && org.latest_raise_unavailable_reason) bad.push('amount_and_reason')
  if (org.furthest_stage && (!org.stage_evidence_type || org.stage_evidence_type === 'none')) {
    bad.push('stage_without_evidence')
  }
  if (org.total_raised_usd != null && !org.inclusion_basis) bad.push('missing_inclusion_basis')
  if (rounds.some(r => r.amount_usd != null && !r.source_url)) bad.push('round_without_source')
  return bad
}

// ── Verification freshness ──────────────────────────────────────────────────

export const STALE_DAYS = 90

/**
 * Does this record need re-checking? Staleness alone is not enough: a record
 * whose figures were never verified has no timestamp to be stale, and
 * last_verified_at is a LEAST over non-null timestamps, so one fresh dimension
 * hides three missing ones.
 */
export function needsVerification(org, now) {
  const confidences = [org.total_raised_confidence, org.latest_raise_confidence]
  if (confidences.some(c => !c || c === 'unverified')) return true
  if (!org.last_verified_at) return true
  return (new Date(now) - new Date(org.last_verified_at)) / 864e5 > STALE_DAYS
}

/**
 * Is there enough round history to make trailing_24mo the default sort?
 *
 * The switch condition from the spec: at least three years of history for 80
 * percent of records. "Three years of history" is measured as the span between
 * a company's first and last known round, which is the only thing the data can
 * actually show. A company with one round has a span of zero and does not count,
 * however recent that round is.
 *
 * Reports itself rather than being remembered.
 */
export const TRAILING_SORT_THRESHOLD = 0.8
export const TRAILING_SORT_MIN_SPAN_YEARS = 3

export function trailingSortReadiness(roundsByOrg) {
  const orgs = Object.keys(roundsByOrg)
  let qualifying = 0
  for (const id of orgs) {
    const dates = (roundsByOrg[id] || []).map(r => r.date).filter(Boolean).sort()
    if (dates.length < 2) continue
    const span = (new Date(dates[dates.length - 1]) - new Date(dates[0])) / (365.25 * 864e5)
    if (span >= TRAILING_SORT_MIN_SPAN_YEARS) qualifying++
  }
  const share = orgs.length ? qualifying / orgs.length : 0
  return {
    total: orgs.length,
    qualifying,
    share,
    ready: share >= TRAILING_SORT_THRESHOLD,
  }
}
