/**
 * backfill-incorporation.js — when a funded company was incorporated, from its
 * own Form D filing.
 *
 *   node --env-file=.env scripts/backfill-incorporation.js            # dry run
 *   node --env-file=.env scripts/backfill-incorporation.js --commit
 *   node --env-file=.env scripts/backfill-incorporation.js --limit 20
 *
 * Requires migration 018. Source: Form D Item 2, `<yearOfInc>`, read out of the
 * same primary_doc.xml the funding pipeline already downloads for its amounts.
 * The parse and the precedence rule are `parseIncorporation` and
 * `preferIncorporation` in scripts/lib/funding.js, which are pure and tested;
 * this script is the sweep around them.
 *
 * Measured coverage on 15 Aug 2026, over the 204 companies with a sourced total
 * and a CIK: 149 declare an exact year, 54 declare only "over five years ago",
 * 1 yields nothing. See docs/founded-backfill-scope.md.
 *
 * What this deliberately does NOT do:
 *
 *   It never writes `founded`. That column has no provenance and disagrees with
 *   the filings in four of the nine cases that overlap, and overwriting it would
 *   erase the only record of that. See the migration.
 *
 *   It never converts a bound into a year. An issuer that says "over five years
 *   ago" has not told us when it was incorporated, only that it was before a
 *   date, and that is what gets stored.
 *
 *   It never infers a year from the first filing date, the state of
 *   incorporation, or anything else the issuer did not declare.
 *
 * The write invariant: this upserts ONLY the four incorporated_* columns it
 * owns, on rows matched by id. It never deletes a row to update it. See
 * docs/funding-data-loss-2026-07-29.md for what happens otherwise.
 */
import { createClient } from '@supabase/supabase-js'
import { parseIncorporation, preferIncorporation } from './lib/funding.js'

const UA = { headers: { 'User-Agent': 'NeuroBase research@neurobase.app' } }
const COMMIT = process.argv.includes('--commit')
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit')
  return i > -1 ? Number(process.argv[i + 1]) : Infinity
})()

/** SEC asks for no more than 10 requests a second. This is well inside it, and
 *  the whole sweep is about 450 requests. */
const PACE_MS = 130
const sleep = ms => new Promise(r => setTimeout(r, ms))

/** How many of an issuer's filings to open before giving up on a year. Ordered
 *  earliest first: a young issuer states its year and an old one never will, so
 *  a fourth request almost never changes the answer. */
const MAX_FILINGS = 3

const bareCik = cik => String(cik).replace(/^0+/, '')
const padCik = cik => String(cik).padStart(10, '0')
const docUrl = (cik, adsh) =>
  `https://www.sec.gov/Archives/edgar/data/${bareCik(cik)}/${String(adsh).replace(/-/g, '')}/primary_doc.xml`

/** Every Form D and Form D/A an issuer has filed, earliest first. */
async function formDFilings(cik) {
  const res = await fetch(`https://data.sec.gov/submissions/CIK${padCik(cik)}.json`, UA)
  if (!res.ok) return null
  const recent = (await res.json()).filings?.recent
  if (!recent?.form) return []
  return recent.form
    .map((form, i) => ({ form, date: recent.filingDate[i], adsh: recent.accessionNumber[i] }))
    .filter(f => f.form === 'D' || f.form === 'D/A')
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** The best reading available for one company, and the filing it came from. */
async function readIncorporation(cik) {
  const filings = await formDFilings(cik)
  await sleep(PACE_MS)
  if (filings === null) return { error: 'submissions fetch failed' }
  if (!filings.length) return { reading: null }

  let best = null, source = null
  for (const f of filings.slice(0, MAX_FILINGS)) {
    const url = docUrl(cik, f.adsh)
    const res = await fetch(url, UA)
    await sleep(PACE_MS)
    if (!res.ok) continue
    const reading = parseIncorporation(await res.text(), Number(f.date.slice(0, 4)))
    if (reading.kind === 'unknown' || reading.kind === 'planned') continue
    const chosen = preferIncorporation(best, reading)
    if (chosen !== best) { best = chosen; source = url }
    if (best?.kind === 'exact') break     // nothing later can improve on this
  }
  return { reading: best, source }
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  /**
   * A dry run works BEFORE migration 018 is applied, because it writes nothing
   * and previewing the sweep is exactly what you want before changing a schema.
   * Only --commit requires the columns to exist. Same shape as the COLUMNS_009
   * fallback in src/lib/fundingBoard.js.
   */
  const BASE = 'id,name,cik,founded'
  const select = cols => sb.from('organizations').select(cols)
    .eq('type', 'company')
    .not('total_raised_usd', 'is', null)
    .not('cik', 'is', null)
    .order('total_raised_usd', { ascending: false })
    .limit(500)

  let { data: orgs, error } = await select(`${BASE},incorporated_year,incorporated_before_year`)
  if (error && /incorporated_/.test(error.message)) {
    if (COMMIT) {
      console.error('Migration 018 has not been applied, so there is nothing to write to.')
      console.error('Apply supabase/migrations/018-incorporation-year.sql, then re-run.')
      process.exit(1)
    }
    console.warn('Migration 018 not applied. Reading anyway, since a dry run writes nothing.\n')
    ;({ data: orgs, error } = await select(BASE))
  }
  if (error) { console.error('read failed:', error.message); process.exit(1) }

  const targets = orgs.slice(0, LIMIT)
  console.log(`${targets.length} funded companies with a CIK${COMMIT ? '' : '  (dry run)'}\n`)

  const now = new Date().toISOString()
  const updates = []
  const stats = { exact: 0, bound: 0, none: 0, failed: 0 }
  const conflicts = []

  for (const o of targets) {
    const { reading, source, error: err } = await readIncorporation(o.cik)
    if (err) { stats.failed++; console.warn(`  ! ${o.name}: ${err}`); continue }
    if (!reading) { stats.none++; continue }

    if (reading.kind === 'exact') {
      stats.exact++
      // Recorded, never resolved here. A gap usually means the company
      // reincorporated, which is a fact about the company and not an error in
      // either number, and it needs a person who has read the filing.
      if (o.founded && Number(o.founded) !== reading.year) {
        conflicts.push(`${o.name}: founded=${o.founded} filing=${reading.year}`)
      }
      updates.push({
        id: o.id,
        incorporated_year: reading.year,
        incorporated_before_year: null,
        incorporated_source_url: source,
        incorporated_retrieved_at: now,
      })
    } else {
      stats.bound++
      updates.push({
        id: o.id,
        incorporated_year: null,
        incorporated_before_year: reading.before,
        incorporated_source_url: source,
        incorporated_retrieved_at: now,
      })
    }
  }

  const n = targets.length
  const pct = k => (n ? Math.round((100 * k) / n) : 0)
  console.log(`exact year : ${stats.exact} (${pct(stats.exact)}%)`)
  console.log(`bound only : ${stats.bound} (${pct(stats.bound)}%)`)
  console.log(`nothing    : ${stats.none}`)
  console.log(`failed     : ${stats.failed}`)

  if (conflicts.length) {
    console.log(`\n${conflicts.length} disagree with the unsourced \`founded\` column, which is left alone:`)
    for (const c of conflicts) console.log(`  ${c}`)
  }

  if (!COMMIT) {
    console.log(`\nDry run. ${updates.length} rows would be written. Re-run with --commit.`)
    return
  }

  // Upserts only the columns this script owns, matched on id. Chunked so one
  // oversized request cannot fail the whole sweep.
  let written = 0
  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100)
    const { error: wErr } = await sb.from('organizations').upsert(chunk, { onConflict: 'id' })
    if (wErr) { console.error('write failed:', wErr.message); process.exit(1) }
    written += chunk.length
  }
  console.log(`\nWrote ${written} rows.`)
}

run().catch(e => { console.error(e); process.exit(1) })
