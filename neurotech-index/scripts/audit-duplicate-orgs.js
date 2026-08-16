/**
 * audit-duplicate-orgs.js — companies that appear twice in the index.
 *
 *   node --env-file=.env scripts/audit-duplicate-orgs.js            # report
 *   node --env-file=.env scripts/audit-duplicate-orgs.js --merge    # copy fields onto the keeper
 *
 * Prompted by an apparent nine duplicate names in the scope audit, EIGHT OF
 * WHICH WERE NOT REAL. That audit paginated on rank_score with no tiebreaker, so
 * page boundaries shuffled: 23 rows came back twice and 23 were never read.
 * Fixing the pagination left exactly one true duplicate, "Precision
 * Neuroscience" against "PrecisionNeuroscience".
 *
 * The lesson is in the script rather than only in the story: every paginated
 * read here ends with .order('id').
 *
 * Ids are a deterministic UUIDv5 of the name (scripts/lib/uuid.js), so two rows
 * for one company means the two names differ by punctuation, a suffix or an
 * accent — enough to hash apart, not enough to be different companies.
 *
 * WHAT THIS CANNOT FIND: a company that RENAMED. G-Therapeutics SA of Lausanne
 * became GTX Medical and then ONWARD Medical of Eindhoven, and both rows are in
 * the index describing the same spinal-cord stimulation product. The two names
 * share no letters, so no normalisation reaches it. That one surfaced only
 * because a verifier reading Onward's history mentioned the former name.
 * Catching renames needs an alias list — the same shape as
 * scripts/data/company-aliases.json, which the funding pipeline already keeps
 * for exactly this reason — not a cleverer string comparison.
 *
 * This NEVER DELETES, and that is deliberate rather than timid. Every row may be
 * pointed at by relationships, funding_rounds, devices matched on manufacturer,
 * or an external link to /company/:id. Deleting one is a decision about which
 * URL stops working, and needs a person. What `--merge` does instead is copy any
 * field the keeper is missing FROM the duplicate, so no researched fact is
 * stranded on the row nobody looks at, and then report the pair.
 *
 * The keeper is the row with more filled fields, breaking ties on rank_score.
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { core } from './lib/funding.js'

const MERGE = process.argv.includes('--merge')

/** Fields worth rescuing from a duplicate. Provenance travels with its value:
 *  copying a year without its source would strand the claim. */
const GROUPS = [
  ['founded_year', 'founded_source_kind', 'founded_source_url', 'founded_evidence',
    'founded_retrieved_at', 'founded_conflict'],
  ['incorporated_year', 'incorporated_before_year', 'incorporated_source_url',
    'incorporated_retrieved_at'],
  ['total_raised_usd', 'total_raised_source_url', 'total_raised_confidence', 'total_raised_retrieved_at'],
  ['cik'], ['website'], ['location'], ['description'], ['founded'], ['status'], ['modality'],
  ['furthest_stage', 'stage_evidence_type', 'stage_evidence_id'],
]

const filled = (row, cols) => cols.filter(c => row[c] != null && row[c] !== '').length

async function run() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const rows = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await sb.from('organizations').select('*')
      .eq('type', 'company').order('name').order('id').range(from, from + 499)
    if (error) { console.error('read failed:', error.message); process.exit(1) }
    rows.push(...data)
    if (data.length < 500) break
  }

  const byCore = new Map()
  for (const r of rows) {
    const k = core(r.name)
    if (!k) continue
    if (!byCore.has(k)) byCore.set(k, [])
    byCore.get(k).push(r)
  }
  const dupes = [...byCore.values()].filter(g => g.length > 1)
  const allCols = GROUPS.flat()

  console.log(`${rows.length} companies; ${dupes.length} names appear more than once\n`)

  const report = []
  const patches = []
  for (const group of dupes) {
    const ranked = [...group].sort((a, b) =>
      filled(b, allCols) - filled(a, allCols) || (b.rank_score || 0) - (a.rank_score || 0))
    const [keeper, ...rest] = ranked
    const patch = {}
    const rescued = []
    for (const cols of GROUPS) {
      if (cols.some(c => keeper[c] != null && keeper[c] !== '')) continue
      // Take the whole group from the first duplicate that has it, so a value
      // never arrives without the source that justifies it.
      const donor = rest.find(d => cols.some(c => d[c] != null && d[c] !== ''))
      if (!donor) continue
      for (const c of cols) patch[c] = donor[c]
      rescued.push(cols[0])
    }
    report.push({
      name: keeper.name,
      keep: { id: keeper.id, name: keeper.name, fields: filled(keeper, allCols) },
      duplicates: rest.map(d => ({ id: d.id, name: d.name, fields: filled(d, allCols) })),
      rescued,
    })
    if (Object.keys(patch).length) patches.push({ id: keeper.id, name: keeper.name, patch, rescued })
    console.log(`${keeper.name}`)
    console.log(`  keep      ${keeper.id}  (${filled(keeper, allCols)} fields)`)
    for (const d of rest) console.log(`  duplicate ${d.id}  (${filled(d, allCols)} fields)  "${d.name}"`)
    if (rescued.length) console.log(`  rescue    ${rescued.join(', ')}`)
  }

  try { mkdirSync('scratch', { recursive: true }) } catch { /* exists */ }
  writeFileSync('scratch/duplicate-orgs.json', JSON.stringify(report, null, 1))
  console.log(`\nfull report: scratch/duplicate-orgs.json`)
  console.log(`${patches.length} keepers would gain a field from their duplicate.`)

  if (!MERGE) {
    console.log('\nReport only. Re-run with --merge to copy those fields onto the keepers.')
    console.log('Nothing is ever deleted: which /company/:id stops working is a decision for a person.')
    return
  }
  let written = 0
  for (const p of patches) {
    const { error } = await sb.from('organizations').update(p.patch).eq('id', p.id)
    if (error) console.error(`  ! ${p.name}: ${error.message}`)
    else written++
  }
  console.log(`\nMerged ${written} of ${patches.length}. No rows were deleted.`)
}

run().catch(e => { console.error(e); process.exit(1) })
