/**
 * purge-offtopic-trials.js — remove trials the topical gate rejects.
 *
 * One-off cleanup for what accumulated before scripts/trials.js had a gate at
 * all: it stored everything ClinicalTrials.gov returned for 16 neurotech search
 * terms, and the registry's full-text search returns intravitreal eye implants
 * for "neural implant" and obstetric anesthesia for "neuraxial".
 *
 *   node --env-file=.env scripts/purge-offtopic-trials.js            # report only
 *   node --env-file=.env scripts/purge-offtopic-trials.js --commit   # back up + delete
 *
 * DRY RUN BY DEFAULT — it prints what it would delete and writes nothing. With
 * --commit it first backs up every row it is about to delete to a timestamped
 * JSON file next to the other backups, so a bad gate is recoverable.
 *
 * Deterministic: the gate is regex over registry fields. No model call, no API.
 *
 * Re-runnable. Once trials.js gates on ingest, a clean run finds nothing to do.
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { onTopicTrial, trialHaystack, TRIAL_OFF_TOPIC } from './lib/trial-gate.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const COMMIT = process.argv.includes('--commit')
const VERBOSE = process.argv.includes('--verbose')

// Keyset-paginate: OFFSET times out on a table this size.
async function allTrials() {
  const rows = []
  let cur = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    const { data, error } = await sb.from('news_feed')
      .select('id,title,summary,topics,relevance_score,url,metadata')
      .eq('entry_type', 'trial').gt('id', cur).order('id').limit(1000)
    if (error) { console.error(error.message); process.exit(1) }
    if (!data?.length) break
    rows.push(...data)
    cur = data[data.length - 1].id
    if (data.length < 1000) break
  }
  return rows
}

const trials = await allTrials()
const drop = trials.filter(t => !onTopicTrial(t))
const keep = trials.length - drop.length

console.log(`\nNeuroBase off-topic trial purge${COMMIT ? '' : '  (DRY RUN — nothing will be written)'}\n`)
console.log(`  trials in index      ${trials.length}`)
console.log(`  gate keeps           ${keep}`)
console.log(`  gate drops           ${drop.length}  (${(drop.length / trials.length * 100).toFixed(1)}%)\n`)

// Trials that read as another speciality and are kept anyway — the lexicon
// overruled the off-topic family. These are the likeliest false positives left,
// so they are worth an eye before a commit.
const suspect = trials.filter(t => TRIAL_OFF_TOPIC.test(trialHaystack(t)) && onTopicTrial(t))
if (suspect.length) {
  console.log(`  kept despite matching an off-topic family (lexicon overruled): ${suspect.length}`)
  for (const t of suspect.slice(0, 10)) console.log(`      ${t.title.slice(0, 88)}`)
  console.log()
}

const shown = VERBOSE ? drop : drop.slice(0, 40)
console.log(`  ${VERBOSE ? 'all' : 'highest-ranked'} trials to drop:`)
for (const t of [...shown].sort((a, b) => b.relevance_score - a.relevance_score)) {
  console.log(`    [${String(t.relevance_score).padStart(2)}] ${t.title.slice(0, 92)}`)
}
if (!VERBOSE && drop.length > shown.length) console.log(`    … and ${drop.length - shown.length} more (--verbose for all)`)

if (!COMMIT) {
  console.log(`\nDry run. Re-run with --commit to back up and delete these ${drop.length} rows.\n`)
  process.exit(0)
}

if (!drop.length) { console.log('\nNothing to delete.\n'); process.exit(0) }

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backup = join(HERE, '..', `purged-trials-${stamp}.json`)
writeFileSync(backup, JSON.stringify(drop, null, 2))
console.log(`\n  backed up ${drop.length} rows to ${backup}`)

let deleted = 0
for (let i = 0; i < drop.length; i += 200) {
  const batch = drop.slice(i, i + 200).map(t => t.id)
  const { error } = await sb.from('news_feed').delete().in('id', batch)
  if (error) { console.error(`  delete failed at ${i}: ${error.message}`); process.exit(1) }
  deleted += batch.length
}
console.log(`  deleted ${deleted} rows\n`)
console.log('Run `npm run verify:cron` to confirm the table still meets its floors.\n')
