/**
 * backfill-companies-house.js — incorporation dates for UK-registered companies.
 *
 *   node --env-file=.env scripts/backfill-companies-house.js            # dry run
 *   node --env-file=.env scripts/backfill-companies-house.js --commit
 *
 * STATUS as of 15 Aug 2026: NOT RUN. This script needs COMPANIES_HOUSE_KEY, the
 * project decided against the registration step, and nothing here has ever
 * written a row. It is kept because the search API is the precise way to do this
 * and the matcher below is tested; it is inert, not abandoned.
 *
 * There is a keyless alternative for the same fact, verified reachable on
 * 15 Aug 2026:
 *
 *   https://download.companieshouse.gov.uk/BasicCompanyDataAsOneFile-YYYY-MM-01.zip
 *
 * No registration, HTTP 200, ~493 MB zipped, one row per UK company with
 * CompanyName, CompanyNumber and IncorporationDate. Matching offline against
 * that file needs no key and no rate limiting, at the cost of the download and
 * roughly 2.5 GB unzipped. It would reach the 90 UK-located companies that have
 * no incorporation year — 8% of the index.
 *
 * Whichever route is used, `pickCompany` below is the part that matters and is
 * unchanged by the choice: the register is full of namesakes and this takes a
 * hit only when exactly one entry survives.
 *
 * This writes incorporated_year (migration 018), NOT founded_year.
 *
 * The register's `date_of_creation` is the date the company was incorporated at
 * Companies House. That is the same class of fact as SEC Form D Item 2 and the
 * same distance from "founded": a business can trade for years before it
 * registers, and re-registering resets the date. Putting it in founded_year
 * because it is the only date available for a UK company would be exactly the
 * conflation docs/founded-backfill-scope.md exists to prevent.
 *
 * Matching is the whole risk. A register search on "Neuros" returns dozens of
 * companies, so a hit is only taken when:
 *
 *   - the register's name matches ours on the same `core` normalisation the
 *     funding pipeline uses, which strips legal suffixes but keeps
 *     name-distinguishing words like "Group"; and
 *   - the company is not dissolved, unless we hold no other candidate; and
 *   - exactly one candidate survives. Two survivors means we cannot tell which
 *     company a row refers to, and the row is left alone.
 *
 * That last rule is why this will always cover less than the register contains.
 * It is the rule that stops "Aura" becoming "Aura Group", which cost this repo
 * $205M on the funding chart once already.
 *
 * The write invariant: UPDATE scoped by id, touching only the incorporated_*
 * columns. It never inserts and never deletes, and it never overwrites a value
 * already established from an SEC filing — a US filing and a UK registration
 * can both exist, and the one already there was not guessed.
 */
import { createClient } from '@supabase/supabase-js'
import { core } from './lib/funding.js'

const KEY = process.env.COMPANIES_HOUSE_KEY
const COMMIT = process.argv.includes('--commit')
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit')
  return i > -1 ? Number(process.argv[i + 1]) : Infinity
})()

/** The register asks for no more than 600 requests in five minutes. */
const PACE_MS = 600
const sleep = ms => new Promise(r => setTimeout(r, ms))

const API = 'https://api.company-information.service.gov.uk'
const auth = () => 'Basic ' + Buffer.from(`${KEY}:`).toString('base64')

async function search(name) {
  const url = `${API}/search/companies?q=${encodeURIComponent(name)}&items_per_page=20`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(url, { headers: { Authorization: auth() }, signal: ctrl.signal })
    if (res.status === 429) return { rateLimited: true }
    if (!res.ok) return null
    return await res.json()
  } catch { return null } finally { clearTimeout(t) }
}

/**
 * The one register entry that is unambiguously this company, or null.
 * `core` is the funding pipeline's normalisation, so "Acme Neuro Ltd" matches
 * "ACME NEURO LIMITED" and "Acme Neuro Group Ltd" does not.
 */
export function pickCompany(ourName, items = []) {
  const want = core(ourName)
  if (!want) return null
  const named = items.filter(i => core(i.title) === want && i.date_of_creation)
  if (!named.length) return null
  const live = named.filter(i => i.company_status !== 'dissolved')
  const pool = live.length ? live : named
  // Two survivors means we cannot say which company the row refers to.
  return pool.length === 1 ? pool[0] : null
}

async function run() {
  if (!KEY) {
    console.error('COMPANIES_HOUSE_KEY is not set, so there is nothing to query.')
    console.error('The key is free: https://developer.company-information.service.gov.uk/')
    console.error('Register an application, then add COMPANIES_HOUSE_KEY=... to .env')
    process.exit(1)
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  // Only companies with no incorporation reading yet. A value already
  // established from an SEC filing is not re-litigated against a UK register.
  const { data: orgs, error } = await sb.from('organizations')
    .select('id,name,location,incorporated_year,incorporated_before_year')
    .eq('type', 'company')
    .is('incorporated_year', null)
    .is('incorporated_before_year', null)
    .order('name').limit(1200)
  if (error) {
    console.error('read failed:', error.message)
    if (/incorporated_/.test(error.message)) console.error('Run migration 018 first.')
    process.exit(1)
  }

  const targets = orgs.slice(0, LIMIT)
  console.log(`${targets.length} companies with no incorporation year yet${COMMIT ? '' : '  (dry run)'}\n`)

  const now = new Date().toISOString()
  const updates = []
  const stats = { matched: 0, ambiguous: 0, none: 0, rateLimited: 0 }
  const samples = []

  for (const o of targets) {
    const res = await search(o.name)
    await sleep(PACE_MS)
    if (res?.rateLimited) {
      stats.rateLimited++
      // The register punishes a burst; back off rather than spend the window
      // proving it.
      await sleep(30000)
      continue
    }
    if (!res) { stats.none++; continue }
    const items = res.items || []
    const hit = pickCompany(o.name, items)
    if (!hit) {
      if (items.some(i => core(i.title) === core(o.name))) stats.ambiguous++
      else stats.none++
      continue
    }
    stats.matched++
    const year = Number(String(hit.date_of_creation).slice(0, 4))
    if (!(year >= 1900 && year <= new Date().getFullYear())) { stats.none++; continue }
    const url = `https://find-and-update.company-information.service.gov.uk/company/${hit.company_number}`
    if (samples.length < 12) {
      samples.push(`  ${o.name} = ${year} (${hit.company_number}, ${hit.company_status})`)
    }
    updates.push({
      id: o.id,
      incorporated_year: year,
      incorporated_before_year: null,
      incorporated_source_url: url,
      incorporated_retrieved_at: now,
    })
  }

  const n = targets.length
  const pct = k => `${k} (${n ? Math.round((100 * k) / n) : 0}%)`
  console.log(`matched one register entry : ${pct(stats.matched)}`)
  console.log(`name matched, ambiguous    : ${pct(stats.ambiguous)}  (left alone on purpose)`)
  console.log(`no match                   : ${pct(stats.none)}`)
  console.log(`rate limited               : ${stats.rateLimited}`)
  if (samples.length) console.log(`\nsample:\n${samples.join('\n')}`)

  if (!COMMIT) {
    console.log(`\nDry run. ${updates.length} rows would be written. Re-run with --commit.`)
    return
  }

  let written = 0
  const failures = []
  for (const { id, ...cols } of updates) {
    const { error: wErr } = await sb.from('organizations').update(cols).eq('id', id)
    if (wErr) failures.push(`${id}: ${wErr.message}`)
    else written++
  }
  console.log(`\nWrote ${written} of ${updates.length} rows.`)
  if (failures.length) {
    console.error(`${failures.length} failed:`)
    for (const f of failures.slice(0, 10)) console.error(`  ${f}`)
    process.exit(1)
  }
}

// Importable for tests without running the sweep.
if (process.argv[1] && process.argv[1].endsWith('backfill-companies-house.js')) {
  run().catch(e => { console.error(e); process.exit(1) })
}
