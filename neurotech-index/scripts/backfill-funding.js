/**
 * backfill-funding.js — company funding from SEC EDGAR Form D, with provenance.
 *
 *   node --env-file=.env scripts/backfill-funding.js                  # dry run
 *   node --env-file=.env scripts/backfill-funding.js --commit         # write
 *   node --env-file=.env scripts/backfill-funding.js --limit 25       # top 25 by stored total
 *   node --env-file=.env scripts/backfill-funding.js --only "Neuralink,Synchron"
 *   node --env-file=.env scripts/backfill-funding.js --force          # ignore freshness
 *
 * What changed in Phase 2, and why.
 *
 * 1. Provenance. The old version built the archive URL, fetched it, read two
 *    numbers, and discarded the URL, the CIK, and the accession number. Every
 *    figure it produced was therefore unciteable. This version keeps all three
 *    and writes them beside the number, which is what migration 008 requires and
 *    what hard rule 1 has always required.
 *
 * 2. Failure reasons. Every failure used to collapse into `{ source: 'none' }`:
 *    no hits, hits that failed the name filter, a matched issuer with no
 *    amounts, a founding-year rejection, and any thrown exception were one
 *    indistinguishable outcome. They are now six named codes (scripts/lib/
 *    funding.js FAILURE), logged per company and summarised at the end, and they
 *    map onto the display enum through unavailableReason().
 *
 * 3. Status branching. A public, acquired, or defunct company is not raising
 *    private rounds, so it never gets an ongoing latest-raise figure. It is
 *    still queried once, because its historical Form D filings are what its
 *    private total is made of. See shouldQueryFormD in the lib for the full
 *    argument.
 *
 * 4. Amounts. The old code used max(totalAmountSold, totalOfferingAmount), so a
 *    company that registered $100M and sold $10M was charted at $100M. This
 *    prefers money actually sold and flags the fallback.
 *
 * 5. Rounds go to Postgres. funding_rounds gets one row per round with its
 *    accession number and filing URL.
 *
 *    Nothing in src/ reads src/data/funding.json any more: Phase 3 moved the
 *    chart, and the company pages followed. Its one remaining job is the
 *    freshness ledger that makes this sweep incremental, recording that a
 *    company was checked whether or not the check found anything. Without that,
 *    the 877 companies with no Form D would be re-queried every night.
 *
 *    Migration 009 adds organizations.funding_checked_at, which does that job in
 *    the database. This script prefers the column when it exists and falls back
 *    to the file when it does not, so applying 009 retires the file with no
 *    further change, and the file can then be deleted.
 *
 * Nothing is written without --commit.
 */
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createClient } from '@supabase/supabase-js'
import {
  matchIssuer, shouldQueryFormD, latestRaise, unavailableReason, classifyFailure,
  clusterRounds, totalRaised, parseFilingXml, filingDocUrl, filingIndexUrl, isUsLocation,
  retiresStoredFigure,
} from './lib/funding.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, '../src/data')

const arg = name => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : null
}
const COMMIT = process.argv.includes('--commit')
const FORCE = process.argv.includes('--force')
const LIMIT = Number(arg('--limit')) || null
// Company names contain commas ("iSchemaView, Inc."), so a semicolon in the
// argument switches the separator to semicolons.
const onlyArg = arg('--only')
const ONLY = onlyArg
  ? onlyArg.split(onlyArg.includes(';') ? ';' : ',').map(s => s.trim()).filter(Boolean)
  : null

const STALE_DAYS = 21
const PIPELINE = 'funding-phase2'
const UA = { headers: { 'User-Agent': 'NeuroBase research@neurobase.app' } }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const usdToM = usd => Math.round(usd / 1e6)

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// ── EDGAR ───────────────────────────────────────────────────────────────────

async function edgarSearch(name) {
  const url = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(name)}%22&forms=D`
  const res = await fetch(url, UA)
  if (!res.ok) throw new Error(`EDGAR search ${res.status}`)
  const body = await res.json()
  return body.hits?.hits?.map(h => h._source) || []
}

/**
 * Former names for a CIK, straight from EDGAR. This is how a rename is
 * established: the submissions document says so, and its URL is the citation.
 * No string-similarity guessing.
 */
async function formerNames(cik) {
  try {
    const url = `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`
    const res = await fetch(url, UA)
    if (!res.ok) return { names: [], url }
    const body = await res.json()
    return { names: (body.formerNames || []).map(f => f.name), url }
  } catch { return { names: [], url: null } }
}

async function fetchFilingAmount(cik, adsh) {
  const res = await fetch(filingDocUrl(cik, adsh), UA)
  if (!res.ok) throw new Error(`filing ${res.status}`)
  return parseFilingXml(await res.text())
}

/**
 * Resolve one company to its Form D history.
 * Returns { rounds, cik, matchKind, failure, aliasSourceUrl, stats }.
 */
async function resolve(org) {
  const stats = { hits: 0, matches: 0, filings: 0 }
  try {
    const hits = await edgarSearch(org.name)
    stats.hits = hits.length
    if (!hits.length) {
      return { rounds: [], failure: classifyFailure({ searched: true, hitCount: 0 }), stats }
    }

    let matched = hits.filter(h => matchIssuer(org.name, h.display_names?.[0]))
    let matchKind = matched.length ? 'exact' : null
    let aliasSourceUrl = null

    // Nothing matched on the current name. The issuer may have renamed, so ask
    // EDGAR for its former names before giving up. Capped at the three most
    // common CIKs so a generic company name cannot fan out into dozens of calls.
    if (!matched.length) {
      const freq = {}
      for (const h of hits) { const c = h.ciks?.[0]; if (c) freq[c] = (freq[c] || 0) + 1 }
      const candidates = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0])
      for (const cik of candidates) {
        const { names, url } = await formerNames(cik)
        await sleep(120)
        if (names.some(n => matchIssuer(org.name, n))) {
          matched = hits.filter(h => h.ciks?.[0] === cik)
          matchKind = 'alias'
          aliasSourceUrl = url
          break
        }
      }
    }

    stats.matches = matched.length
    if (!matched.length) {
      return { rounds: [], failure: classifyFailure({ searched: true, hitCount: hits.length, matchCount: 0 }), stats }
    }

    // Lock to the single most-frequent issuer CIK among the matches.
    const freq = {}
    for (const h of matched) { const c = h.ciks?.[0]; if (c) freq[c] = (freq[c] || 0) + 1 }
    const cik = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0]
    if (!cik) {
      return { rounds: [], failure: classifyFailure({ searched: true, hitCount: hits.length, matchCount: 0 }), stats }
    }

    const filings = []
    for (const h of matched.filter(m => m.ciks?.[0] === cik)) {
      try {
        const { amountUsd, amountBasis } = await fetchFilingAmount(cik, h.adsh)
        if (amountUsd > 0) {
          filings.push({
            date: h.file_date,
            amountUsd,
            amountBasis,
            accession: h.adsh,
            sourceUrl: filingIndexUrl(cik, h.adsh),
          })
        }
      } catch { /* one unreadable filing must not lose the rest */ }
      await sleep(120)
    }
    stats.filings = filings.length

    if (!filings.length) {
      return {
        rounds: [], cik, matchKind,
        failure: classifyFailure({ searched: true, hitCount: hits.length, matchCount: matched.length, filingCount: 0 }),
        stats,
      }
    }

    // A namesake gives itself away by filing before the company existed.
    const founded = parseInt(org.founded, 10)
    const newest = filings.map(f => f.date).sort().pop()
    if (founded && newest && new Date(newest).getUTCFullYear() < founded) {
      return {
        rounds: [], cik, matchKind,
        failure: classifyFailure({ searched: true, foundedMismatch: true }), stats,
      }
    }

    return { rounds: clusterRounds(filings), cik, matchKind, aliasSourceUrl, failure: null, stats }
  } catch (error) {
    return { rounds: [], failure: classifyFailure({ error }), stats }
  }
}

// ── Company set ─────────────────────────────────────────────────────────────

/**
 * Has migration 009 added funding_checked_at? When it has, the freshness ledger
 * is a column and src/data/funding.json has no remaining job. Until then the
 * committed file carries it. Asking beats assuming, so this script works either
 * side of the migration and switches over on its own.
 */
async function hasCheckedAtColumn() {
  const { error } = await sb.from('organizations').select('funding_checked_at').limit(1)
  return !error
}

async function loadCompanies(withCheckedAt) {
  const cols = 'id,name,founded,location,status,cik,total_raised_usd'
    + (withCheckedAt ? ',funding_checked_at' : '')
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('organizations')
      .select(cols)
      .eq('type', 'company').range(from, from + 999)
    if (error) throw new Error(`load companies: ${error.message}`)
    all.push(...data)
    if (data.length < 1000) break
  }
  if (ONLY) return all.filter(c => ONLY.includes(c.name))
  // --limit takes the biggest known raisers first, so a short run covers the
  // companies that can actually reach the chart.
  if (LIMIT) {
    return [...all].sort((a, b) => (b.total_raised_usd || 0) - (a.total_raised_usd || 0)).slice(0, LIMIT)
  }
  return all
}

/** Which companies already have round history stored. */
async function storedHistory() {
  const byOrg = {}
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('funding_rounds')
      .select('organization_id,accession_number').range(from, from + 999)
    if (error) throw new Error(`load rounds: ${error.message}`)
    for (const r of data) (byOrg[r.organization_id] ||= []).push(r.accession_number)
    if (data.length < 1000) break
  }
  return byOrg
}

// ── Run ─────────────────────────────────────────────────────────────────────

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }

  const dbLedger = await hasCheckedAtColumn()
  const companies = await loadCompanies(dbLedger)
  const history = await storedHistory()
  const legacyPath = join(dataDir, 'funding.json')
  let legacy = {}
  try { legacy = JSON.parse(readFileSync(legacyPath, 'utf8')) } catch { /* first run */ }

  console.log(dbLedger
    ? 'freshness ledger: organizations.funding_checked_at'
    : 'freshness ledger: src/data/funding.json (apply migration 009 to move it into Postgres)')

  // A check counts whether or not it found anything: the 877 companies with no
  // Form D must not be re-queried nightly just because the answer was "none".
  const checkedAt = org => (dbLedger ? org.funding_checked_at : legacy[org.name]?.checkedAt)
  const fresh = org =>
    !FORCE && checkedAt(org) && (Date.now() - new Date(checkedAt(org))) / 864e5 < STALE_DAYS

  const tally = { resolved: 0, reused: 0, skipped: 0, byFailure: {}, aliasMatches: 0, offeringBasis: 0 }
  const orgUpdates = []
  const roundRows = []
  const retiredIds = []   // figures withdrawn this run; their rounds go too
  const nextLegacy = { ...legacy }
  const now = new Date().toISOString()

  console.log(`${companies.length} companies to check. ${COMMIT ? 'WRITING' : 'dry run'}.\n`)

  for (const org of companies) {
    const hasHistory = (history[org.id] || []).length > 0
    const searched = shouldQueryFormD(org.status, hasHistory)

    if (!searched) {
      tally.skipped++
      const reason = unavailableReason({ status: org.status, isUsIssuer: true, searched: false, filingCount: 0 })
      orgUpdates.push({
        id: org.id, name: org.name,
        latest_raise_usd: null,
        latest_raise_unavailable_reason: reason,
        ...(dbLedger ? { funding_checked_at: now } : {}),
        pipeline_version: PIPELINE,
      })
      console.log(`  – ${org.name}: not queried (${org.status}), reason ${reason}`)
      continue
    }

    if (fresh(org) && hasHistory) { tally.reused++; continue }

    const { rounds, cik, matchKind, aliasSourceUrl, failure, stats } = await resolve(org)
    if (matchKind === 'alias') tally.aliasMatches++

    if (failure || !rounds.length) {
      tally.byFailure[failure] = (tally.byFailure[failure] || 0) + 1
      // A CIK proves the company files with the SEC. Without one, fall back to
      // the location the database already holds.
      const isUsIssuer = cik ? true : isUsLocation(org.location) !== false
      const reason = unavailableReason({
        status: org.status, isUsIssuer, searched: true, filingCount: stats.filings,
      })
      const update = {
        id: org.id, name: org.name,
        latest_raise_usd: null,
        latest_raise_unavailable_reason: reason,
        cik: cik || null,
        ...(dbLedger ? { funding_checked_at: now } : {}),
        pipeline_version: PIPELINE,
      }
      // A company that used to resolve and now definitively does not was
      // matched to the wrong issuer. Leaving the old total standing keeps a
      // figure on the chart that this run just established we cannot source, so
      // retire it along with its rounds. A fetch_error never triggers this: a
      // network blip is not evidence about a company.
      if (org.total_raised_usd != null && retiresStoredFigure(failure)) {
        Object.assign(update, {
          total_raised_usd: null,
          total_raised_source_url: null,
          total_raised_retrieved_at: null,
          total_raised_confidence: 'unverified',
          latest_raise_date: null,
          latest_raise_source_url: null,
          latest_raise_retrieved_at: null,
          latest_raise_confidence: 'unverified',
          latest_raise_accession_number: null,
        })
        retiredIds.push(org.id)
        delete nextLegacy[org.name]
        console.log(`  ! ${org.name}: retiring a stored $${usdToM(org.total_raised_usd)}M total — ${failure}`)
      }
      orgUpdates.push(update)
      nextLegacy[org.name] = { source: 'none', failure, checkedAt: now }
      console.log(`  ✗ ${org.name}: ${failure} (hits ${stats.hits}, matches ${stats.matches}) -> ${reason}`)
      await sleep(200)
      continue
    }

    tally.resolved++
    if (rounds.some(r => r.amountBasis === 'offering')) tally.offeringBasis++

    const total = totalRaised(rounds)
    const latest = latestRaise({ status: org.status, rounds, isUsIssuer: true, searched: true })
    const totalSourceUrl = aliasSourceUrl || rounds[rounds.length - 1].sourceUrl

    orgUpdates.push({
      id: org.id, name: org.name,
      total_raised_usd: total,
      total_raised_source_url: totalSourceUrl,
      total_raised_retrieved_at: now,
      total_raised_confidence: 'filing_verified',
      latest_raise_usd: latest.amountUsd,
      latest_raise_date: latest.date || null,
      latest_raise_source_url: latest.round?.sourceUrl || null,
      latest_raise_retrieved_at: latest.amountUsd ? now : null,
      latest_raise_confidence: latest.amountUsd ? 'filing_verified' : 'unverified',
      latest_raise_accession_number: latest.round?.accession || null,
      latest_raise_unavailable_reason: latest.reason,
      latest_raise_date_basis: 'filing_date',
      cik,
      ...(dbLedger ? { funding_checked_at: now } : {}),
      pipeline_version: PIPELINE,
    })

    for (const r of rounds) {
      roundRows.push({
        organization_id: org.id,
        amount_usd: r.amountUsd,
        round_date: r.date,
        date_basis: 'filing_date',
        round_type: null,               // Form D does not name the round
        source: 'edgar_form_d',
        source_url: r.sourceUrl,
        accession_number: r.accession,
        confidence: r.amountBasis === 'sold' ? 'filing_verified' : 'press_reported',
        retrieved_at: now,
        last_updated: now,
        pipeline_version: PIPELINE,
      })
    }

    nextLegacy[org.name] = {
      total: usdToM(total),
      latestAmount: latest.amountUsd ? usdToM(latest.amountUsd) : 0,
      latestDate: latest.date || null,
      rounds: rounds.map(r => ({ date: r.date, amount: usdToM(r.amountUsd) })).filter(r => r.amount > 0),
      source: 'sec',
      checkedAt: now,
    }

    const flag = matchKind === 'alias' ? ' [alias]' : ''
    console.log(`  ✓ ${org.name}${flag}: $${usdToM(total)}M across ${rounds.length} round(s)` +
      `${latest.amountUsd ? `, latest $${usdToM(latest.amountUsd)}M ${latest.date}` : `, latest ${latest.reason}`}`)
    await sleep(200)
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const before = Object.values(legacy).filter(v => v?.total > 0).length
  const beforeRate = Object.keys(legacy).length ? before / Object.keys(legacy).length : 0
  console.log('\n─── run summary ───')
  console.log(`resolved:        ${tally.resolved}`)
  console.log(`reused (fresh):  ${tally.reused}`)
  console.log(`not queried:     ${tally.skipped}`)
  console.log(`alias matches:   ${tally.aliasMatches}`)
  console.log(`rounds found:    ${roundRows.length}`)
  if (retiredIds.length) console.log(`figures retired: ${retiredIds.length}`)
  if (tally.offeringBasis) {
    console.log(`offering basis:  ${tally.offeringBasis} company/companies have a round priced off ` +
      'totalOfferingAmount because nothing was sold yet')
  }
  console.log('failures:')
  for (const [code, n] of Object.entries(tally.byFailure).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(code).padEnd(18)} ${n}`)
  }
  const attempted = tally.resolved + Object.values(tally.byFailure).reduce((a, b) => a + b, 0)
  console.log(`\nmatch rate this run: ${tally.resolved}/${attempted} ` +
    `(${attempted ? Math.round((tally.resolved / attempted) * 100) : 0}%)`)
  console.log(`match rate before:   ${before}/${Object.keys(legacy).length} (${Math.round(beforeRate * 100)}%) ` +
    'across the whole company set')

  if (!COMMIT) {
    console.log('\nDry run. Nothing written. Re-run with --commit to apply.')
    return
  }

  // ── Write ─────────────────────────────────────────────────────────────────
  // Retired rounds go first. If the run dies between the two writes, the result
  // is an organization with no total and no rounds, which is merely incomplete.
  // The other order leaves rounds behind that nothing points at.
  if (retiredIds.length) {
    const { error } = await sb.from('funding_rounds').delete().in('organization_id', retiredIds)
    if (error) { console.error('\nfunding_rounds delete failed:', error.message); process.exit(1) }
    console.log(`  retired the rounds of ${retiredIds.length} organization(s)`)
  }
  let n = 0
  for (let i = 0; i < orgUpdates.length; i += 100) {
    const chunk = orgUpdates.slice(i, i + 100)
    const { error } = await sb.from('organizations').upsert(chunk, { onConflict: 'id' })
    if (error) { console.error('\norganizations upsert failed:', error.message); process.exit(1) }
    n += chunk.length
    process.stdout.write(`\r  organizations ${n}/${orgUpdates.length}`)
  }
  let m = 0
  for (let i = 0; i < roundRows.length; i += 100) {
    const chunk = roundRows.slice(i, i + 100)
    const { error } = await sb.from('funding_rounds')
      .upsert(chunk, { onConflict: 'organization_id,accession_number' })
    if (error) { console.error('\nfunding_rounds upsert failed:', error.message); process.exit(1) }
    m += chunk.length
    process.stdout.write(`\r  funding_rounds ${m}/${roundRows.length}`)
  }

  if (!dbLedger) {
    const sorted = Object.fromEntries(Object.keys(nextLegacy).sort().map(k => [k, nextLegacy[k]]))
    writeFileSync(legacyPath, JSON.stringify(sorted, null, 2) + '\n')
  }
  console.log(`\n✓ wrote ${orgUpdates.length} organizations and ${roundRows.length} rounds` +
    (dbLedger ? '. src/data/funding.json is no longer written and can be deleted.' : ', and src/data/funding.json'))
}

run().catch(e => { console.error(e); process.exit(1) })
