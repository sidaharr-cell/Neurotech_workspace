/**
 * backfill-funding-fields.js — initialise the migration-008 columns on rows that
 * predate it. Sets every new field to null or 'unverified'. It never guesses.
 *
 *   node --env-file=.env scripts/backfill-funding-fields.js            # dry run
 *   node --env-file=.env scripts/backfill-funding-fields.js --commit   # write
 *
 * Dry run is the default on purpose: hard rule 5 says no migration runs against
 * production data without explicit approval, and --commit is that approval.
 *
 * What it writes, and nothing else:
 *   display_name                     <- name, where null. Not a new fact; it is
 *                                       the string the chart already renders.
 *   capital_scope                    <- 'private_only', where null
 *   total_raised_confidence          <- 'unverified', where null
 *   latest_raise_confidence          <- 'unverified', where null
 *   latest_raise_unavailable_reason  <- 'unverified', where null and no amount
 *   stage_evidence_type              <- 'none', where null
 *
 * What it deliberately does NOT write:
 *   Any dollar amount. There are 144 SEC totals and 28 curated totals sitting in
 *   src/data/*.json today, and not one of them has a source URL, an accession
 *   number, or a CIK stored beside it — backfill-funding.js fetches the archive
 *   document and throws the URL away. Copying those numbers into a column called
 *   total_raised_usd would create a figure with no source, which hard rule 1
 *   forbids and which the CHECK constraint in migration 008 rejects outright.
 *   They move in Phase 2, when the ingestion re-run captures their provenance.
 *   This script prints how many figures it is leaving behind, so the gap is
 *   visible rather than silent.
 *
 *   status, modality, furthest_stage, inclusion_basis. Every one of those is a
 *   judgement about a real company. Null means nobody has made it yet.
 *
 * Idempotent: it only touches columns that are still null, so a second run is a
 * no-op. Safe to run before or after the funding figures land.
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, '../src/data')
const COMMIT = process.argv.includes('--commit')
const STAMP = 'funding-phase1'
const CHUNK = 200

// Built inside run(), not at module scope, so the pure helpers below can be
// imported by a test that has no credentials.
let sb = null

// The full set of columns this script is allowed to write. Anything not on this
// list is a fact about a company and is not ours to invent.
const WRITABLE = new Set([
  'id', 'name', 'display_name', 'capital_scope', 'total_raised_confidence',
  'latest_raise_confidence', 'latest_raise_unavailable_reason', 'stage_evidence_type',
  'pipeline_version',
])

const READ = 'id,name,display_name,capital_scope,total_raised_confidence,' +
  'latest_raise_confidence,latest_raise_unavailable_reason,latest_raise_usd,stage_evidence_type'

/** The row's initialised form, or null when it already has every default. */
export function initialise(r) {
  const patch = {}
  if (r.display_name == null) patch.display_name = r.name
  if (r.capital_scope == null) patch.capital_scope = 'private_only'
  if (r.total_raised_confidence == null) patch.total_raised_confidence = 'unverified'
  if (r.latest_raise_confidence == null) patch.latest_raise_confidence = 'unverified'
  if (r.latest_raise_usd == null && r.latest_raise_unavailable_reason == null) {
    patch.latest_raise_unavailable_reason = 'unverified'
  }
  if (r.stage_evidence_type == null) patch.stage_evidence_type = 'none'
  if (!Object.keys(patch).length) return null
  // name is echoed because it is NOT NULL and upsert writes a whole tuple.
  return { id: r.id, name: r.name, pipeline_version: STAMP, ...patch }
}

/** Refuse to send anything outside WRITABLE, whatever a future edit adds. */
export function assertSafe(rows) {
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (/_usd$/.test(k)) throw new Error(`refusing to write a dollar amount in "${k}"`)
      if (!WRITABLE.has(k)) throw new Error(`refusing to write disallowed column "${k}"`)
    }
  }
}

/** Count the figures in the JSON overlay that this script is NOT migrating. */
function unmigratedFigures() {
  const read = f => { try { return JSON.parse(readFileSync(join(dataDir, f), 'utf8')) } catch { return {} } }
  const sec = read('funding.json')
  const curated = read('companies-funding.json')
  const secTotals = Object.values(sec).filter(v => v?.total > 0).length
  const secRounds = Object.values(sec).reduce((n, v) => n + (v?.rounds?.length || 0), 0)
  const curatedTotals = Object.values(curated).filter(v => v?.total > 0).length
  return { secTotals, secRounds, curatedTotals }
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }
  sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('organizations').select(READ).range(from, from + 999)
    if (error) {
      console.error('read failed:', error.message)
      if (/does not exist/.test(error.message)) {
        console.error('Apply supabase/migrations/008-funding.sql first.')
      }
      process.exit(1)
    }
    rows.push(...data)
    if (data.length < 1000) break
  }

  const patches = rows.map(initialise).filter(Boolean)
  assertSafe(patches)

  console.log(`organizations read:  ${rows.length}`)
  console.log(`rows needing init:   ${patches.length}`)
  if (patches.length) {
    const sample = patches[0]
    console.log(`sample patch:        ${JSON.stringify(sample)}`)
  }

  const { secTotals, secRounds, curatedTotals } = unmigratedFigures()
  console.log('')
  console.log('NOT migrated by this script, because these figures have no stored source URL:')
  console.log(`  ${secTotals} SEC totals and ${secRounds} dated SEC rounds in src/data/funding.json`)
  console.log(`  ${curatedTotals} curated totals in src/data/companies-funding.json`)
  console.log('  They move in Phase 2, once ingestion captures the CIK, accession number, and URL.')
  console.log('')

  if (!COMMIT) {
    console.log('Dry run. Nothing was written. Re-run with --commit to apply.')
    return
  }

  let written = 0
  for (let i = 0; i < patches.length; i += CHUNK) {
    const chunk = patches.slice(i, i + CHUNK)
    const { error } = await sb.from('organizations').upsert(chunk, { onConflict: 'id' })
    if (error) { console.error('\nupsert failed:', error.message); process.exit(1) }
    written += chunk.length
    process.stdout.write(`\r  written ${written}/${patches.length}`)
  }
  console.log(`\n✓ initialised ${written} rows. No dollar amount was written.`)
}

// Only run when invoked directly. Importing this file (from a test) must not
// touch the database.
if (process.argv[1] && process.argv[1].endsWith('backfill-funding-fields.js')) {
  run().catch(e => { console.error(e); process.exit(1) })
}
