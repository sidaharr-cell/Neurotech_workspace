/**
 * backfill-incorporation.js — when a company was incorporated, from its own
 * Form D filing.
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
 * Measured coverage on 15 Aug 2026, over the 214 companies with a CIK: 151
 * declare an exact year, 56 declare only "over five years ago", 7 yield nothing.
 * The other 870 companies on the site have no CIK and are out of this script's
 * reach entirely — Form D is a US private-placement filing, and most of the
 * index has never made one. See docs/founded-backfill-scope.md.
 *
 * This is INCORPORATION, not founding. The two differ, and not by rounding:
 * Merge Labs reads 2025 in `founded` against 2016 on its filing, Saluda Medical
 * 2013 against 2023. Both are redomiciliations or shell reuse, not errors.
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
   * Every company with a CIK, not just the funded ones. A CIK is what makes an
   * issuer reachable on EDGAR, and having raised a sourced round is a separate
   * fact — 214 companies have a CIK against 205 with a total, and the ones in
   * the gap were being skipped for no reason the source cares about.
   *
   * A dry run works BEFORE migration 018 is applied, because it writes nothing
   * and previewing the sweep is what you want before changing a schema. Only
   * --commit requires the columns. Same shape as the COLUMNS_009 fallback in
   * src/lib/fundingBoard.js.
   */
  const BASE = 'id,name,cik,founded'
  const select = cols => sb.from('organizations').select(cols)
    .eq('type', 'company')
    .not('cik', 'is', null)
    .order('name')
    .limit(1000)

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
  console.log(`${targets.length} companies with a CIK${COMMIT ? '' : '  (dry run)'}\n`)

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

  /**
   * UPDATE per row, not upsert.
   *
   * `upsert` compiles to INSERT ... ON CONFLICT, and Postgres evaluates the
   * INSERT before it ever reaches the conflict clause — so a payload of
   * {id, incorporated_*} fails organizations.name's NOT NULL constraint and the
   * whole batch dies. Adding `name` to the payload would fix the error and
   * break the rule: this script does not own that column and must not write it.
   * An UPDATE scoped by id cannot insert a row and cannot touch a column it was
   * not given, which is the write invariant stated at the top of this file.
   */
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

run().catch(e => { console.error(e); process.exit(1) })
