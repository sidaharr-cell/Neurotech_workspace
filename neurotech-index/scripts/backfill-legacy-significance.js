/**
 * backfill-legacy-significance.js — freeze the scores the new sort replaces.
 *
 *   node --env-file=.env scripts/backfill-legacy-significance.js            # dry run
 *   node --env-file=.env scripts/backfill-legacy-significance.js --commit
 *   node --env-file=.env scripts/backfill-legacy-significance.js --commit --force
 *
 * Requires migration 014. Run it the same day the migration is applied.
 *
 * Spec 10.2 keeps these as the comparison surface for evaluating the new sort,
 * and spec 13 wants the rank correlation against them. Nothing else preserves
 * them: the 6am cron rewrites relevance_score on every feed item, paper and
 * trial it touches, so the baseline drifts nightly and an overwritten value
 * cannot be recovered by any later migration.
 *
 * IDEMPOTENT AND NON-DESTRUCTIVE. A row that already carries a snapshot is left
 * alone unless --force is given. The whole point is a value frozen at one
 * moment; silently refreshing it against a drifted score would destroy the thing
 * being preserved while looking like a successful run.
 */
import { createClient } from '@supabase/supabase-js'

const COMMIT = process.argv.includes('--commit')
const FORCE = process.argv.includes('--force')
const CONCURRENCY = 25

/** Each table, the live column being frozen, and the row filter. */
const TARGETS = [
  { table: 'news_feed', from: 'relevance_score', label: 'feed items and trials' },
  { table: 'papers', from: 'rank_score', label: 'papers' },
]

async function pageAll(sb, table, select) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(select).range(from, from + 999)
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) {
        console.error(`  ! ${table}: ${error.message}`)
        console.error('    Apply supabase/migrations/014-legacy-significance.sql first.')
        process.exit(1)
      }
      console.error(`  ! ${table} read failed: ${error.message}`)
      return out
    }
    if (!data.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const takenAt = new Date().toISOString()

  for (const t of TARGETS) {
    const rows = await pageAll(sb, t.table, `id,${t.from},legacy_significance`)
    const withScore = rows.filter(r => r[t.from] != null)
    const already = withScore.filter(r => r.legacy_significance != null)
    const todo = FORCE ? withScore : withScore.filter(r => r.legacy_significance == null)

    console.log(`\n${t.table} (${t.label})`)
    console.log(`  rows:                    ${rows.length}`)
    console.log(`  with a live ${t.from}: ${withScore.length}`)
    console.log(`  already snapshotted:     ${already.length}`)
    console.log(`  to snapshot now:         ${todo.length}`)
    if (already.length && !FORCE) {
      console.log('  (existing snapshots left untouched; --force would overwrite them,')
      console.log('   which would destroy the frozen baseline this exists to keep)')
    }
    if (!todo.length) continue

    if (!COMMIT) continue

    let done = 0, failed = 0
    for (let i = 0; i < todo.length; i += CONCURRENCY) {
      const chunk = todo.slice(i, i + CONCURRENCY)
      const results = await Promise.all(chunk.map(r =>
        sb.from(t.table)
          .update({ legacy_significance: r[t.from], legacy_significance_at: takenAt })
          .eq('id', r.id)))
      for (const res of results) {
        if (res.error) { failed++; if (failed <= 3) console.error(`\n  ! ${res.error.message}`) }
        else done++
      }
      process.stdout.write(`\r  snapshotted ${done}/${todo.length}${failed ? ` (${failed} failed)` : ''}`)
    }
    process.stdout.write('\n')
    if (failed) { console.error(`  ${failed} row(s) failed.`); process.exitCode = 1 }
  }

  if (!COMMIT) {
    console.log('\nDry run. Nothing written. Re-run with --commit.')
    console.log('Run it the same day migration 014 is applied: the 6am cron rewrites')
    console.log('relevance_score nightly and an overwritten score cannot be recovered.')
    return
  }
  console.log(`\n✓ snapshot taken at ${takenAt}.`)
}

run().catch(e => { console.error(e); process.exit(1) })
