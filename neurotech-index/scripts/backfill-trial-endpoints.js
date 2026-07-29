/**
 * backfill-trial-endpoints.js — add the design and endpoint block to trials that
 * were indexed before scripts/lib/trial-design.js existed.
 *
 *   node --env-file=.env scripts/backfill-trial-endpoints.js            # dry run
 *   node --env-file=.env scripts/backfill-trial-endpoints.js --commit
 *   node --env-file=.env scripts/backfill-trial-endpoints.js --commit --force
 *
 * The nightly ingest now captures endpoints, arm types and masking, but it only
 * rewrites trials it re-fetches. This fills in the ~8,300 already stored.
 *
 * Endpoints are what make METH 3 and 4 assessable at all (spec 5.2.3), and what
 * evidences the pre-specified primary endpoint the design-quality grade needs
 * (spec 5.3.2). Every value is read from the registration; nothing is inferred.
 *
 * THE WRITE INVARIANT. This owns exactly one key inside news_feed.metadata:
 * `design`. It reads each row, merges that one key, and writes the row back by
 * id. It never deletes and never replaces a whole metadata object with one it
 * did not read first. See CLAUDE.md and docs/funding-data-loss-2026-07-29.md.
 */
import { createClient } from '@supabase/supabase-js'
import { trialDesign, TRIAL_DESIGN_FIELDS } from './lib/trial-design.js'

const COMMIT = process.argv.includes('--commit')
const FORCE = process.argv.includes('--force')
const UA = 'Mozilla/5.0 (compatible; NeuroBaseBot/1.0; +https://neurobase.app)'
const PIPELINE = 'trial-endpoints-2026-07'
const BATCH = 40
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function fetchDesigns(nctIds) {
  const out = new Map()
  for (let i = 0; i < nctIds.length; i += BATCH) {
    const slice = nctIds.slice(i, i + BATCH)
    const url = `https://clinicaltrials.gov/api/v2/studies?filter.ids=${slice.join(',')}` +
      `&fields=${TRIAL_DESIGN_FIELDS}&pageSize=${BATCH}&format=json`
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) { console.error(`\n  ! registry ${res.status} on a batch of ${slice.length}`); continue }
      const data = await res.json()
      for (const s of data.studies || []) {
        const id = s.protocolSection?.identificationModule?.nctId
        if (id) out.set(id, trialDesign(s))
      }
    } catch (err) {
      console.error(`\n  ! batch failed: ${err.message}`)
    }
    process.stdout.write(`\r  fetched ${Math.min(i + BATCH, nctIds.length)}/${nctIds.length}`)
    await sleep(150)
  }
  process.stdout.write('\n')
  return out
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  const trials = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('news_feed')
      .select('id,metadata').eq('entry_type', 'trial').range(from, from + 999)
    if (error) { console.error('read failed:', error.message); process.exit(1) }
    if (!data.length) break
    trials.push(...data)
    if (data.length < 1000) break
  }
  const withNct = trials.filter(t => t.metadata?.nctId)
  const todo = FORCE ? withNct : withNct.filter(t => !t.metadata.design)
  console.log(`${trials.length} trials, ${withNct.length} with an NCT id, ${todo.length} needing a design block.`)
  if (!todo.length) { console.log('Nothing to do. Use --force to refresh existing blocks.'); return }

  const designs = await fetchDesigns([...new Set(todo.map(t => t.metadata.nctId))])

  const updates = []
  let noRecord = 0
  for (const t of todo) {
    const d = designs.get(t.metadata.nctId)
    if (!d) { noRecord++; continue }
    // Merge ONE key into the metadata we just read. Never a blind replace.
    updates.push({ id: t.id, metadata: { ...t.metadata, design: d }, pipeline_version: PIPELINE })
  }

  const stats = { prespecified: 0, sham: 0, control: 0, masked: 0, outcomes: 0 }
  for (const u of updates) {
    const d = u.metadata.design
    if (d.hasPrespecifiedPrimary) stats.prespecified++
    if (d.hasShamArm) stats.sham++
    if (d.hasControlArm) stats.control++
    if (d.masking && d.masking !== 'NONE') stats.masked++
    stats.outcomes += d.primaryOutcomes.length + d.secondaryOutcomes.length
  }
  console.log(`\n${updates.length} trial(s) ready to update.` + (noRecord ? ` ${noRecord} had no registry record.` : ''))
  console.log(`  with a pre-specified primary endpoint: ${stats.prespecified}`)
  console.log(`  with a sham arm:                       ${stats.sham}`)
  console.log(`  with any control arm:                  ${stats.control}`)
  console.log(`  with masking beyond none:              ${stats.masked}`)
  console.log(`  outcome measures captured:             ${stats.outcomes}`)

  if (!COMMIT) { console.log('\nDry run. Nothing written. Re-run with --commit.'); return }

  // UPDATE, not upsert. An upsert takes the INSERT path for validation, so
  // omitting a NOT NULL column like `title` fails the whole batch — and adding
  // `title` back would mean this script writes a column it does not own, which
  // is exactly what the write invariant in CLAUDE.md forbids. Per-row updates
  // touch only `metadata` and `pipeline_version`, and cannot create a row.
  const CONCURRENCY = 20
  let done = 0, failed = 0
  for (let i = 0; i < updates.length; i += CONCURRENCY) {
    const chunk = updates.slice(i, i + CONCURRENCY)
    const results = await Promise.all(chunk.map(u =>
      sb.from('news_feed')
        .update({ metadata: u.metadata, pipeline_version: u.pipeline_version })
        .eq('id', u.id)))
    for (const r of results) {
      if (r.error) { failed++; if (failed <= 3) console.error(`\n  ! ${r.error.message}`) }
      else done++
    }
    process.stdout.write(`\r  wrote ${done}/${updates.length}${failed ? ` (${failed} failed)` : ''}`)
  }
  console.log(`\n✓ updated ${done} trial(s).${failed ? ` ${failed} failed.` : ''}`)
  if (failed) process.exit(1)
}

run().catch(e => { console.error(e); process.exit(1) })
