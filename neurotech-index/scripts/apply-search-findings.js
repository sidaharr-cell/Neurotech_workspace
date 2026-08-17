/**
 * apply-search-findings.js — write founding years gathered by web search.
 *
 *   node --env-file=.env scripts/apply-search-findings.js            # dry run
 *   node --env-file=.env scripts/apply-search-findings.js --commit
 *
 * Reads scripts/data/founding-findings.json, which is written incrementally as
 * searches are done. It lives in scripts/data and is COMMITTED, alongside
 * class-images.json and card-images.json, because it is the same kind of thing:
 * judgement a pipeline cannot make, gathered by hand, and expensive to redo. It
 * spent its first day in scratch/, which is gitignored, where twenty-one
 * researched years were one `rm -rf` from being lost.
 *
 * Needs migrations 019, 020 and 021.
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
import { core, stripInvisible } from './lib/funding.js'
import { findingError } from './lib/findings.js'

const COMMIT = process.argv.includes('--commit')
const FILE = 'scripts/data/founding-findings.json'

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
      .select('id,name,founded_year,founded_source_kind,founded_source_url,founded_evidence,'
        + 'founded_conflict,incorporated_year,incorporated_before_year,inclusion_decision')
      .eq('type', 'company').order('name').order('id').range(from, from + 499)
    if (error) { console.error('read failed:', error.message); process.exit(1) }
    orgs.push(...data)
    if (data.length < 500) break
  }
  const byCore = new Map()
  for (const o of orgs) {
    // A row ruled out of the index is not a candidate for a name match. Without
    // this, "Precision Neuroscience" matched both itself and the duplicate row
    // "PrecisionNeuroscience" and its finding was refused for eleven rounds as
    // "matches 2 rows in the database" — correctly, since guessing between two
    // rows is exactly what this rule exists to prevent. Resolving the duplicate
    // is what makes the match unambiguous; the exclusion is how that resolution
    // is recorded, so it has to be read here too.
    if (o.inclusion_decision === 'exclude') continue
    const k = core(o.name)
    if (!k) continue
    if (!byCore.has(k)) byCore.set(k, [])
    byCore.get(k).push(o)
  }

  const now = new Date().toISOString()
  const writes = []
  const skipped = []
  const unchanged = []

  for (const f of findings) {
    const rows = byCore.get(core(stripInvisible(f.name))) || []
    const err = findingError(f, rows.length, new Date().getFullYear())
    if (err) { skipped.push(`${f.name}: ${err}`); continue }
    const o = rows[0]
    // A caveat goes in the evidence, not in founded_conflict. The UI renders a
    // conflict as a dagger meaning "sources disagree"; thin evidence is not a
    // disagreement, and filing it as one would invent a dispute that nobody had.
    const evidence = [f.evidence, f.caveat && `Caveat: ${f.caveat}`]
      .filter(Boolean).join(' ')
    const cols = {
      founded_year: f.year,
      founded_source_kind: f.kind,
      founded_source_url: f.url || null,
      founded_evidence: evidence.slice(0, 500),
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
    // Skip a write that would change nothing. The file is cumulative — every
    // round re-applies every finding ever recorded — so by the 226th finding
    // that was 200-odd round-trips rewriting rows to the values they already
    // held, and the run had gone from seconds to over two minutes.
    //
    // founded_retrieved_at is deliberately NOT compared. It is "when we last
    // looked", and if nothing else changed we did not look again; bumping it
    // would make every row report a fresh retrieval that never happened.
    const same = o.founded_year === cols.founded_year
      && o.founded_source_kind === cols.founded_source_kind
      && (o.founded_source_url || null) === cols.founded_source_url
      && (o.founded_evidence || null) === (cols.founded_evidence || null)
      && (o.founded_conflict || null) === cols.founded_conflict
      && !cols.incorporated_year
    if (same) { unchanged.push(f.name); continue }
    writes.push({ id: o.id, name: o.name, overwrites: !!o.founded_year, cols })
  }

  const byKind = {}
  for (const w of writes) byKind[w.cols.founded_source_kind] = (byKind[w.cols.founded_source_kind] || 0) + 1
  console.log(`${findings.length} findings; ${writes.length} write, ${unchanged.length} already current, ${skipped.length} skipped`)
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
