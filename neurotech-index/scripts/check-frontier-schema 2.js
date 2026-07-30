/**
 * check-frontier-schema.js — is migration 011 actually applied?
 *
 *   node --env-file=.env scripts/check-frontier-schema.js
 *
 * Exits 0 when every object and column the frontier record layer needs is
 * present, and non-zero otherwise, naming exactly what is missing.
 *
 * WHY THIS EXISTS. "The migration is applied" and "PostgREST can see it" are
 * different claims, and when they disagree the error you get is the same 404
 * either way: `Could not find the table 'public.frontier_records' in the schema
 * cache`. That message cannot distinguish a migration that never ran, one that
 * rolled back on a later statement, one applied to a different project, and one
 * applied fine but not yet reloaded into the API's schema cache. Each has a
 * different fix, so guessing wastes a round trip every time.
 *
 * This checks columns too, not just tables. A migration edited between runs can
 * leave a table that exists but lacks a column the scripts write, and that
 * failure surfaces much later as a confusing insert error.
 */
import { createClient } from '@supabase/supabase-js'

// Every column the scripts read or write. Kept in step with migration 011.
const EXPECTED = {
  frontier_records: [
    'id', 'subfield', 'partition_version', 'axis', 'axis_type', 'indication',
    'indication_version', 'current_value', 'held_by_type', 'held_by_id',
    'established_date', 'confidence', 'superseded_by', 'record_version', 'notes',
    'source', 'source_url', 'first_seen', 'last_updated', 'pipeline_version',
  ],
  frontier_record_changes: [
    'id', 'record_id', 'record_version', 'field', 'old_value', 'new_value',
    'reason', 'changed_by', 'changed_at',
  ],
  frontier_record_proposals: [
    'id', 'record_id', 'subfield', 'axis', 'axis_type', 'indication',
    'proposed_value', 'item_type', 'item_id', 'source_url', 'evidence_grade',
    'rubric_version', 'rationale', 'status', 'reviewed_by', 'reviewed_at',
    'review_note', 'created_at',
  ],
  frontier_records_live: ['id', 'subfield', 'axis', 'axis_type', 'superseded_by'],
}

// Proof the credentials point at a populated NeuroBase, so "table missing" is
// never confused with "wrong project" or "bad key".
const SENTINELS = ['papers', 'organizations', 'relationships']

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }
  const ref = (process.env.SUPABASE_URL.match(/https:\/\/([^.]+)\./) || [])[1] || '?'
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  console.log(`project ${ref}\n`)

  // ── Is this the right database at all ─────────────────────────────────────
  const wrongProject = []
  for (const t of SENTINELS) {
    const { error } = await sb.from(t).select('*').limit(1)
    if (error) wrongProject.push(`${t}: ${error.message}`)
  }
  if (wrongProject.length) {
    console.error('These long-standing tables are not reachable either:')
    for (const m of wrongProject) console.error(`  ✗ ${m}`)
    console.error('\nSo this is a credentials or project problem, not migration 011.')
    process.exit(1)
  }
  console.log(`✓ reachable, and ${SENTINELS.join(', ')} all resolve.\n`)

  // ── The frontier objects ──────────────────────────────────────────────────
  const missingTables = [], missingCols = []
  for (const [table, cols] of Object.entries(EXPECTED)) {
    const { error } = await sb.from(table).select('*').limit(1)
    if (error) { missingTables.push(table); console.log(`  ✗ ${table} — not present`); continue }

    // Ask for each column by name; PostgREST rejects unknown ones.
    const bad = []
    for (const c of cols) {
      const { error: e } = await sb.from(table).select(c).limit(1)
      if (e) bad.push(c)
    }
    if (bad.length) {
      missingCols.push(`${table}: ${bad.join(', ')}`)
      console.log(`  ! ${table} — present, missing column(s): ${bad.join(', ')}`)
    } else {
      console.log(`  ✓ ${table} — present, all ${cols.length} expected column(s)`)
    }
  }

  if (!missingTables.length && !missingCols.length) {
    // Row counts, so an applied-but-empty layer is visibly different from a
    // loaded one.
    console.log('')
    for (const t of ['frontier_records', 'frontier_record_proposals', 'frontier_record_changes']) {
      const { count } = await sb.from(t).select('*', { count: 'exact', head: true })
      console.log(`  ${t}: ${count ?? 0} row(s)`)
    }
    console.log('\nMigration 011 is applied. Run:')
    console.log('  node --env-file=.env scripts/backfill-frontier-records.js --commit')
    return
  }

  console.log('')
  if (missingTables.length === Object.keys(EXPECTED).length) {
    console.log('Every frontier object is missing, while the rest of the database is fine.')
    console.log('That means migration 011 has not taken effect on this project. Either:')
    console.log('')
    console.log('  1. It never ran, or it rolled back. The Supabase SQL editor runs a')
    console.log('     script as ONE transaction, so a single failing statement discards')
    console.log('     all of it, and it runs only the SELECTED text if anything is')
    console.log('     highlighted. Re-run supabase/migrations/011-frontier-records.sql')
    console.log('     with nothing selected and read the result line.')
    console.log('')
    console.log('  2. It ran, but the API has not reloaded. Run this in the SQL editor:')
    console.log("       notify pgrst, 'reload schema';")
    console.log('')
    console.log('  To tell them apart, run this in the SQL editor:')
    console.log("       select table_name from information_schema.tables")
    console.log("        where table_schema = 'public' and table_name like 'frontier%';")
    console.log('     Rows returned means case 2. No rows means case 1.')
  } else if (missingTables.length) {
    console.log(`Partially applied: ${missingTables.join(', ')} missing.`)
    console.log('Re-running the migration is safe; every statement is create-if-not-exists.')
  } else {
    console.log('Tables exist but columns are missing, so an older version of the')
    console.log('migration was applied. Re-running it will NOT add them: the table')
    console.log('already exists, so `create table if not exists` is a no-op. Add the')
    console.log('columns by hand with `alter table ... add column if not exists`:')
    for (const m of missingCols) console.log(`  ${m}`)
  }
  process.exit(1)
}

run().catch(e => { console.error(e); process.exit(1) })
