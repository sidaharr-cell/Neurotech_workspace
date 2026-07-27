/**
 * companyFunding.js — the single funding overlay for companies.
 *
 * Funding is intentionally NOT stored in the `organizations` table: the DB holds
 * the company *entity* (name, location, description, facets), and disclosed
 * capital raised lives here in committed JSON keyed by company name, merged in
 * at render time. Two sources:
 *   1. funding.json — SEC EDGAR Form D, auto-updated daily by
 *      scripts/backfill-funding.js for EVERY company in the DB (negative
 *      "source:none" markers included). Grows the chart automatically.
 *   2. companies-funding.json — hand-/web-curated figures (incl. round label +
 *      year, and totals SEC can't see such as IPO proceeds or foreign rounds).
 *
 * Merge: total = max(SEC, curated) so curated hand-verified numbers win where
 * SEC undercounts and SEC freshness flows up where it's higher; the round
 * label/size/date come from whichever source is more recent.
 *
 * Shape per company: { total, latestRound, roundYear, latestAmount, latestDate, source }
 * total & latestAmount are in $M.
 */
import curated from '../data/companies-funding.json'
import sec from '../data/funding.json'

function merge(a = {}, b = {}) {
  const total = Math.max(a.total || 0, b.total || 0)
  // Freshest round metadata wins; fall back to whichever source has any.
  const cands = [a, b].filter(x => x.latestDate || x.latestAmount || x.latestRound)
  cands.sort((x, y) => new Date(y.latestDate || 0) - new Date(x.latestDate || 0))
  const latest = cands[0] || {}
  const src = [a.total ? 'sec' : null, b.total ? 'curated' : null].filter(Boolean).join('+') || 'none'
  // Dated rounds for the funding-per-year chart: SEC's dated filings when we
  // have them, else a single synthesized point from the curated round.
  let rounds = a.rounds || null
  if ((!rounds || !rounds.length) && (b.latestAmount || b.total)) {
    const date = b.latestDate || (b.roundYear ? `${b.roundYear}-01-01` : null)
    if (date) rounds = [{ date, amount: b.latestAmount || b.total }]
  }
  return {
    total,
    latestAmount: latest.latestAmount || 0,
    latestDate: latest.latestDate || null,
    latestRound: latest.latestRound || b.latestRound || null,
    roundYear: latest.roundYear || b.roundYear || null,
    rounds: rounds || [],
    source: src,
  }
}

const MAP = {}
for (const name of new Set([...Object.keys(sec), ...Object.keys(curated)])) {
  MAP[name] = merge(sec[name], curated[name])
}

export const fundingMap = MAP
export const getFunding = name => MAP[name] || null

/** All companies with disclosed funding, richest first — reflects the whole
 *  landscape, not just any one curated list. */
export function topFunded(limit = 20) {
  return Object.entries(MAP)
    .map(([name, f]) => ({ name, ...f }))
    .filter(f => (f.total || 0) > 0)
    .sort((a, b) => (b.total || 0) - (a.total || 0))
    .slice(0, limit)
}
