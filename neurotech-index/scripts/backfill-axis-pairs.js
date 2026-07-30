/**
 * backfill-axis-pairs.js — apply scripts/data/frontier-axis-pairs.json.
 *
 *   node --env-file=.env scripts/backfill-axis-pairs.js            # dry run
 *   node --env-file=.env scripts/backfill-axis-pairs.js --commit
 *
 * Requires migration 012.
 *
 * A pair is what makes FD 4 reachable (spec 5.1.1): "improves one axis without
 * the loss along a paired axis the field treats as necessary", and a 4 MUST name
 * both axes and say why the tradeoff was binding. This loads those statements.
 *
 * A PAIR WHOSE AXES DO NOT EXIST IS USELESS, so the loader checks both axes
 * against frontier_records for the same subfield and reports any that dangle.
 * A dangling pair can never produce a 4, because there is no record to beat and
 * none to check for regression. That is a warning rather than a hard failure:
 * the pair may be correct and simply waiting on its records.
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { uuidv5 } from './lib/uuid.js'
import { SUBFIELD_IDS, PARTITION_VERSION } from '../src/lib/subfields.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const COMMIT = process.argv.includes('--commit')
const PIPELINE = 'axis-pairs-phase2'

const AXIS_TYPES = ['performance', 'longevity', 'invasiveness', 'scale',
  'regulatory', 'manufacturability', 'cost']
const STRENGTHS = ['settled', 'contested', 'asserted']

export const pairId = key => uuidv5(`axis-pair:${key}`)

/** Validate one pair. Returns problem strings, empty when clean. */
export function validatePair(key, p) {
  const errs = []
  const need = (c, m) => { if (!c) errs.push(m) }
  need(/^[a-z0-9][a-z0-9-]*$/.test(key), `key "${key}" must be a lowercase slug`)
  need(SUBFIELD_IDS.includes(p.subfield), `subfield "${p.subfield}" is not in SUBFIELD_IDS`)
  need(typeof p.axis_a === 'string' && p.axis_a.trim().length > 3, 'axis_a is missing or too short')
  need(typeof p.axis_b === 'string' && p.axis_b.trim().length > 3, 'axis_b is missing or too short')
  need(p.axis_a !== p.axis_b, 'an axis paired with itself is not a tradeoff')
  need(AXIS_TYPES.includes(p.axis_a_type), `axis_a_type "${p.axis_a_type}" is not an axis type`)
  need(AXIS_TYPES.includes(p.axis_b_type), `axis_b_type "${p.axis_b_type}" is not an axis type`)
  // A 4 has to cite this text, so an empty one makes the score unciteable.
  need(typeof p.why_binding === 'string' && p.why_binding.trim().length > 40,
    'why_binding must explain why the field treats the pair as coupled')
  need(!p.strength || STRENGTHS.includes(p.strength), `strength "${p.strength}" is not one of ${STRENGTHS.join(', ')}`)
  return errs
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  const file = JSON.parse(readFileSync(join(__dirname, 'data/frontier-axis-pairs.json'), 'utf8'))
  const entries = Object.entries(file.pairs || {}).filter(([k]) => !k.startsWith('_'))
  if (!entries.length) { console.log('No pairs in scripts/data/frontier-axis-pairs.json.'); return }

  const problems = []
  for (const [k, p] of entries) for (const m of validatePair(k, p)) problems.push(`${k}: ${m}`)
  if (problems.length) {
    console.error(`${problems.length} problem(s):\n`)
    for (const p of problems) console.error(`  ✗ ${p}`)
    process.exit(1)
  }

  // Do both axes of each pair actually exist as records?
  const { data: recs, error: rErr } = await sb.from('frontier_records_live')
    .select('subfield,axis').not('subfield', 'is', null)
  if (rErr) {
    console.error('could not read frontier_records_live:', rErr.message)
    if (/schema cache|does not exist/i.test(rErr.message)) console.error('Apply migration 011 first.')
    process.exit(1)
  }
  const known = new Set(recs.map(r => `${r.subfield}|${r.axis}`))
  const dangling = []
  for (const [k, p] of entries) {
    const missing = [p.axis_a, p.axis_b].filter(a => !known.has(`${p.subfield}|${a}`))
    if (missing.length) dangling.push([k, missing])
  }

  const rows = entries.map(([key, p]) => ({
    id: pairId(key),
    subfield: p.subfield,
    partition_version: PARTITION_VERSION,
    axis_a: p.axis_a.trim(),
    axis_b: p.axis_b.trim(),
    axis_a_type: p.axis_a_type,
    axis_b_type: p.axis_b_type,
    why_binding: p.why_binding.trim(),
    strength: p.strength || 'asserted',
    source_url: p.source_url || null,
    notes: p.notes || null,
    pipeline_version: PIPELINE,
    last_updated: new Date().toISOString(),
  }))

  for (const r of rows) {
    console.log(`  · [${r.subfield}] ${r.axis_a}\n      ⟷ ${r.axis_b}   (${r.strength})`)
  }
  console.log(`\n${rows.length} pair(s) across ${new Set(rows.map(r => r.subfield)).size} subfield(s).`)
  const byStrength = {}
  for (const r of rows) byStrength[r.strength] = (byStrength[r.strength] || 0) + 1
  console.log('strength:', Object.entries(byStrength).map(([k, v]) => `${k} ${v}`).join(', '))

  if (dangling.length) {
    console.log(`\n${dangling.length} pair(s) name an axis with no matching record. ` +
      `These cannot yield an FD 4 until the record exists:`)
    for (const [k, miss] of dangling) for (const m of miss) console.log(`  ? ${k}: no record for "${m}"`)
  } else {
    console.log('\nEvery paired axis has a matching record. All pairs are evaluable.')
  }

  if (!COMMIT) { console.log('\nDry run. Nothing written. Re-run with --commit.'); return }
  const { error } = await sb.from('frontier_axis_pairs').upsert(rows, { onConflict: 'id' })
  if (error) {
    console.error('upsert failed:', error.message)
    if (/schema cache|does not exist/i.test(error.message)) console.error('Apply migration 012 first.')
    process.exit(1)
  }
  console.log(`✓ wrote ${rows.length} axis pair(s).`)
}

if (process.argv[1] && process.argv[1].endsWith('backfill-axis-pairs.js')) {
  run().catch(e => { console.error(e); process.exit(1) })
}
