/**
 * rollup-labs.js — classify labs and researchers from what they publish.
 *
 * A lab's stored description is one arbitrary NIH project title, which is why
 * major groups are unclassifiable today — Krishna Shenoy's lab reads
 * "Focus: Data Science Core". Their papers say what they actually work on.
 *
 * `organizations.founders[0]` holds the principal investigator's full name in
 * the same format as the `papers.authors` array, so this is a name join. Names
 * are written inconsistently across sources, so both sides are normalized to
 * "lastname firstinitial" and additionally checked on the full surname.
 *
 *   node --env-file=.env scripts/rollup-labs.js --dry
 *   node --env-file=.env scripts/rollup-labs.js
 *
 * A facet is adopted when it appears in >= MIN_SHARE of the person's papers,
 * so a single collaboration doesn't retag a lab.
 */
import { createClient } from '@supabase/supabase-js'
import { classify, CLASSIFIER_VERSION } from '../src/lib/classify.js'
import { normalizeFacets } from '../src/lib/facets.js'

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const DRY = process.argv.includes('--dry')
const MIN_SHARE = 0.15
const MIN_PAPERS = 2

// ── Name normalization ──────────────────────────────────────────────────────
// "Krishna V Shenoy", "Krishna V. Shenoy" and "K. V. Shenoy" are one person.
const clean = s => String(s || '')
  .toLowerCase()
  .replace(/\b(jr|sr|ii|iii|phd|md|dr)\b\.?/g, '')
  .replace(/[.,]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

/** Split a name into { last, first, middle } for compatibility comparison. */
function parseName(full) {
  const parts = clean(full).split(' ').filter(Boolean)
  if (parts.length < 2) return null
  const last = parts[parts.length - 1]
  if (last.length < 3) return null            // guard against parsing failures
  return { last, first: parts[0], middle: parts.length > 2 ? parts[1] : '' }
}

/**
 * Are these plausibly the same person?
 *
 * Surname must match. First names must match in full when both are spelled out
 * — matching on the initial alone merges "Lee-Way Jin" with every other J. Jin
 * in PubMed, which produced labs tagged with all four functions at once. Middle
 * initials are compared only when both sides have one, so "Krishna V Shenoy"
 * still matches "Krishna Shenoy".
 */
function sameName(a, b) {
  if (!a || !b || a.last !== b.last) return false
  const aInit = a.first.length === 1, bInit = b.first.length === 1
  if (aInit || bInit) {
    if (a.first[0] !== b.first[0]) return false
  } else if (a.first !== b.first) return false
  if (a.middle && b.middle && a.middle[0] !== b.middle[0]) return false
  return true
}

// ── Load papers and index them by author ────────────────────────────────────
console.log('loading papers…')
const byAuthor = new Map()
let papers = 0
// Keyset pagination — a deep OFFSET into 83k papers trips the statement
// timeout, which silently truncated the author index to 53,000 papers on an
// earlier run and cost ~8% of lab matches.
let cursor = '00000000-0000-0000-0000-000000000000'
for (;;) {
  const { data, error } = await sb.from('papers')
    .select('id,title,abstract,mesh,authors').gt('id', cursor).order('id').limit(1000)
  if (error) { console.error(`\n${error.message} — author index incomplete`); process.exitCode = 1; break }
  if (!data?.length) break
  cursor = data[data.length - 1].id
  for (const p of data) {
    papers++
    const facets = classify(p, 'papers')
    if (!facets.in_scope) continue
    // Bucket by surname; the full compatibility check happens at lookup, so a
    // shared surname alone never merges two people.
    for (const a of p.authors || []) {
      const n = parseName(a)
      if (!n) continue
      if (!byAuthor.has(n.last)) byAuthor.set(n.last, [])
      byAuthor.get(n.last).push({ n, facets })
    }
  }
  process.stdout.write(`\r  ${papers.toLocaleString()} papers · ${byAuthor.size.toLocaleString()} distinct authors`)
  if (data.length < 1000) break
}
console.log('')

// ── Roll up ─────────────────────────────────────────────────────────────────
/** Facets appearing in at least MIN_SHARE of this person's in-scope papers. */
function rollupFor(name) {
  const target = parseName(name)
  if (!target) return null
  const bucket = byAuthor.get(target.last)
  if (!bucket) return null
  const list = bucket.filter(e => sameName(target, e.n)).map(e => e.facets)
  if (list.length < MIN_PAPERS) return null
  const count = (field, value) => list.filter(f => f[field].includes(value)).length
  const keep = field => [...new Set(list.flatMap(f => f[field]))]
    .filter(v => count(field, v) / list.length >= MIN_SHARE)
  return {
    facets: normalizeFacets({
      function: keep('facet_function'),
      access: keep('facet_access'),
      application: keep('facet_application'),
    }),
    papers: list.length,
  }
}

for (const [type, table, nameOf] of [
  ['labs', 'organizations', r => (r.founders || [])[0] || r.name.replace(/\s+lab$/i, '')],
  ['researchers', 'researchers', r => r.name],
]) {
  const rows = []
  let cur = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    let q = sb.from(table).select('*').gt('id', cur).order('id').limit(1000)
    if (table === 'organizations') q = q.eq('type', 'lab')
    const { data, error } = await q
    if (error) { console.error(error.message); process.exitCode = 1; break }
    if (!data?.length) break
    cur = data[data.length - 1].id
    rows.push(...data)
    if (data.length < 1000) break
  }

  let matched = 0, written = 0, improved = 0
  const examples = []
  for (const row of rows) {
    const roll = rollupFor(nameOf(row))
    // Text-only classification of the row itself, for comparison.
    const own = classify(row, type === 'labs' ? 'organizations' : 'researchers')
    if (!roll) continue
    matched++
    const merged = classify(row, type === 'labs' ? 'organizations' : 'researchers', { rollup: roll.facets })
    if (!own.facet_function.length && merged.facet_function.length) improved++
    if (examples.length < 6 && merged.facet_function.length) {
      examples.push(`${row.name.slice(0, 40).padEnd(41)} ${roll.papers} papers → ${merged.facet_function.join('+')} | ${merged.facet_application.slice(0, 3).join(',')}`)
    }
    if (!DRY) {
      const { id, ...fields } = { id: row.id, ...merged }
      const { error } = await sb.from(table).update(fields).eq('id', id)
      if (!error) written++
    }
  }
  console.log(`\n${type}: ${rows.length} rows · ${matched} matched to an author (${(100 * matched / rows.length).toFixed(0)}%) · ${improved} newly classifiable`)
  if (!DRY) console.log(`  wrote ${written}`)
  examples.forEach(e => console.log(`  ${e}`))
}

console.log(`\n${DRY ? 'dry run — nothing written' : `✓ roll-up complete (${CLASSIFIER_VERSION})`}`)
