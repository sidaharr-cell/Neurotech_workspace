/**
 * apply-search-findings.js — write founding years gathered by web search.
 *
 *   node --env-file=.env scripts/apply-search-findings.js            # dry run
 *   node --env-file=.env scripts/apply-search-findings.js --commit
 *
 * Reads scratch/search-findings.json, which is written incrementally as
 * searches are done, so a long run cannot lose what it has established. Needs
 * migrations 019, 020 and 021.
 *
 * Each finding carries: name, year, kind, url, evidence, confidence, and
 * optionally `conflict` (another credible year) and `incorporatedYear` (where
 * the same source states incorporation separately, as Axonics' SEC prospectus
 * does).
 *
 * Two rules this enforces, because a JSON file assembled by hand is exactly
 * where a wrong year slips in:
 *
 *   A company is matched by `core` name equality against the database, never by
 *   a substring. If the name matches nothing, or matches more than one row, the
 *   finding is REPORTED AND SKIPPED rather than guessed at. This is the same
 *   rule the funding pipeline and the UK register matcher use, and it exists
 *   because "Aura" once matched "Aura Group" and took $205M with it.
 *
 *   A finding whose confidence is `low` is never written unless it carries a
 *   `conflict` string explaining the disagreement, so a shaky year always
 *   arrives with the reason it is shaky attached.
 *
 * The write invariant: UPDATE scoped by id, touching only founded_* and, where
 * the source states it, incorporated_*. Never inserts, never deletes.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { core } from './lib/funding.js'

const COMMIT = process.argv.includes('--commit')
const FILE = 'scratch/search-findings.json'
const VALID_KINDS = new Set([
  'company_site', 'wikidata', 'wikipedia', 'record_description',
  'companies_house', 'press', 'aggregator',
])

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  let findings
  try { findings = JSON.parse(readFileSync(FILE, 'utf8')) }
  catch (e) { console.error(`cannot read ${FILE}: ${e.message}`); process.exit(1) }

  const orgs = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await sb.from('organizations')
      .select('id,name,founded_year,incorporated_year,incorporated_before_year')
      .eq('type', 'company').order('name').order('id').range(from, from + 499)
    if (error) { console.error('read failed:', error.message); process.exit(1) }
    orgs.push(...data)
    if (data.length < 500) break
  }
  const byCore = new Map()
  for (const o of orgs) {
    const k = core(o.name)
    if (!k) continue
    if (!byCore.has(k)) byCore.set(k, [])
    byCore.get(k).push(o)
  }

  const now = new Date().toISOString()
  const writes = []
  const skipped = []

  for (const f of findings) {
    const rows = byCore.get(core(f.name)) || []
    if (rows.length !== 1) {
      skipped.push(`${f.name}: matches ${rows.length} rows in the database`)
      continue
    }
    if (!VALID_KINDS.has(f.kind)) { skipped.push(`${f.name}: unknown source kind "${f.kind}"`); continue }
    if (f.kind !== 'record_description' && !f.url) { skipped.push(`${f.name}: no source URL`); continue }
    if (!(f.year >= 1900 && f.year <= new Date().getFullYear())) {
      skipped.push(`${f.name}: implausible year ${f.year}`); continue
    }
    if (f.confidence === 'low' && !f.conflict) {
      skipped.push(`${f.name}: low confidence with no conflict recorded`); continue
    }
    const o = rows[0]
    const cols = {
      founded_year: f.year,
      founded_source_kind: f.kind,
      founded_source_url: f.url || null,
      founded_evidence: String(f.evidence || '').slice(0, 500),
      founded_retrieved_at: now,
      founded_conflict: f.conflict || null,
    }
    // Only where the SAME source states incorporation separately, and only when
    // nothing better is already recorded from a filing.
    if (f.incorporatedYear && !o.incorporated_year && !o.incorporated_before_year) {
      cols.incorporated_year = f.incorporatedYear
      cols.incorporated_before_year = null
      cols.incorporated_source_url = f.url
      cols.incorporated_retrieved_at = now
    }
    writes.push({ id: o.id, name: o.name, overwrites: !!o.founded_year, cols })
  }

  const byKind = {}
  for (const w of writes) byKind[w.cols.founded_source_kind] = (byKind[w.cols.founded_source_kind] || 0) + 1
  console.log(`${findings.length} findings; ${writes.length} write, ${skipped.length} skipped`)
  console.log(`by source: ${JSON.stringify(byKind)}`)
  console.log(`already had a founding year (will be replaced): ${writes.filter(w => w.overwrites).length}`)
  console.log(`with a recorded conflict: ${writes.filter(w => w.cols.founded_conflict).length}`)
  console.log(`also setting an incorporation year: ${writes.filter(w => w.cols.incorporated_year).length}`)
  if (skipped.length) console.log(`\nskipped:\n${skipped.map(s => `  ${s}`).join('\n')}`)

  if (!COMMIT) { console.log('\nDry run. Re-run with --commit.'); return }

  let written = 0
  const failures = []
  for (const w of writes) {
    const { error } = await sb.from('organizations').update(w.cols).eq('id', w.id)
    if (error) failures.push(`${w.name}: ${error.message}`)
    else written++
  }
  console.log(`\nWrote ${written} of ${writes.length}.`)
  if (failures.length) {
    console.error(failures.map(f => `  ${f}`).join('\n'))
    process.exit(1)
  }
}

run().catch(e => { console.error(e); process.exit(1) })
