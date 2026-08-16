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
 * THREE SIGNALS, because the first was missing the interesting half.
 *
 * `core` name equality finds a company entered twice under punctuation variants.
 * It found exactly one pair: "Precision Neuroscience" against
 * "PrecisionNeuroscience".
 *
 * A shared WEBSITE finds a company that RENAMED, which no string comparison
 * reaches. Phobious became Psious became Amelia Virtual Care; the first two
 * names normalise differently and both rows point at the same site. This signal
 * found four more pairs on its first run, including Cerebrotech Medical Systems
 * against Cerebro Medical Systems, both in Pleasanton.
 *
 * The domain signal needs `websiteKey` rather than a bare hostname, and that is
 * the whole difficulty. Five rows in this index record `linkedin.com` as their
 * website, three record the literal string "n/a", and two each record
 * `crunchbase.com` and `f6s.com`. Those rows have no website at all, and
 * matching on the aggregator's host would merge unrelated companies in Moscow,
 * Berlin, Montreal, Cape Town and Chennai into a single "duplicate". So
 * `websiteKey` returns null for aggregators, parking pages and placeholders, and
 * a null never groups.
 *
 * A shared BRAND — the same distinctive label under two top-level domains —
 * catches what exact host equality still misses. Incereb of Tallaght is here
 * twice, as "Incereb" at incereb.com and as "Eegapps Medical" at incereb.ie.
 * `brandKey` is deliberately timid about this: at least five characters, and
 * never a word half of neurotechnology uses, because neuro.com and neuro.io are
 * not evidence of anything. A loose version of this signal invents duplicates,
 * which is worse than missing them.
 *
 * STILL NOT FOUND: a rename where the site moved too. G-Therapeutics SA of
 * Lausanne became GTX Medical and then ONWARD Medical of Eindhoven; the rows
 * share neither name nor domain, and that pair surfaced only because a person
 * read Onward's history. Catching those needs an alias list — the same shape as
 * scripts/data/company-aliases.json, which the funding pipeline already keeps.
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
import { websiteKey, brandKey } from './lib/founding.js'

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

  // Group on each signal separately so the report can say WHICH one found a
  // pair, then merge groups that overlap: a pair caught by both should be
  // reported once, not twice.
  const groupBy = (keyOf) => {
    const m = new Map()
    for (const r of rows) {
      const k = keyOf(r)
      if (!k) continue
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(r)
    }
    return [...m.values()].filter(g => g.length > 1)
  }
  const byName = groupBy(r => core(r.name))
  const byDomain = groupBy(r => websiteKey(r.website))
  // Weaker: the same brand under two TLDs, which exact host equality misses.
  const byBrand = groupBy(r => brandKey(r.website))

  const signals = new Map()   // id of a member -> Set of signal names
  const merged = []
  for (const [signal, groups] of [['name', byName], ['website', byDomain], ['brand', byBrand]]) {
    for (const g of groups) {
      const existing = merged.find(m => m.some(r => g.some(x => x.id === r.id)))
      const target = existing || (merged.push([]), merged[merged.length - 1])
      for (const r of g) if (!target.some(x => x.id === r.id)) target.push(r)
      for (const r of g) {
        if (!signals.has(r.id)) signals.set(r.id, new Set())
        signals.get(r.id).add(signal)
      }
    }
  }
  const dupes = merged
  const allCols = GROUPS.flat()

  console.log(`${rows.length} companies; ${dupes.length} appear more than once`)
  console.log(`  ${byName.length} by name, ${byDomain.length} by shared website, ${byBrand.length} by brand across TLDs\n`)

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
    const found = [...new Set(group.flatMap(r => [...(signals.get(r.id) || [])]))].sort()
    report.push({
      name: keeper.name,
      foundBy: found,
      keep: { id: keeper.id, name: keeper.name, fields: filled(keeper, allCols) },
      duplicates: rest.map(d => ({ id: d.id, name: d.name, fields: filled(d, allCols) })),
      rescued,
    })
    if (Object.keys(patch).length) patches.push({ id: keeper.id, name: keeper.name, patch, rescued })
    console.log(`${keeper.name}   (by ${found.join(' and ')})`)
    console.log(`  keep      ${keeper.id}  (${filled(keeper, allCols)} fields)`)
    for (const d of rest) console.log(`  duplicate ${d.id}  (${filled(d, allCols)} fields)  "${d.name}"`)
    if (rescued.length) console.log(`  rescue    ${rescued.join(', ')}`)
    // Say so when the keeper was not actually chosen on evidence. Both rows
    // carrying the same number of fields means the tie fell to rank_score, which
    // is not a statement about which name is right: it picked "MDDT inc" over
    // "Movement Disorders Diagnostic Technologies (MDDT)".
    if (rest.some(d => filled(d, allCols) === filled(keeper, allCols))) {
      console.log(`  ! tie on field count; the keeper here is arbitrary, check the names`)
    }
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
