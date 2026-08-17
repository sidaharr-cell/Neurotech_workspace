/**
 * apply-scope-removals.js — take the rows the founding sweep ruled out of the index.
 *
 *   node --env-file=.env scripts/apply-scope-removals.js            # dry run
 *   node --env-file=.env scripts/apply-scope-removals.js --commit
 *
 * THIS DOES NOT DELETE, and that is not timidity. `funding_rounds` cascades on
 * delete, so removing 200-odd company rows would silently take their funding
 * history with them — which is exactly the shape of the 29 July 2026 data loss
 * (docs/funding-data-loss-2026-07-29.md), where a delete-and-reinsert destroyed
 * 629 rounds and every pipeline still reported success. `relationships` holds
 * 373,870 edges keyed on these ids, and /company/:id is a permanent URL that
 * outside links point at.
 *
 * What removal means here instead: `in_scope = false`, which every read in
 * src/lib/data.js already honours (`applyFacets` gates on it unless a caller
 * passes includeOutOfScope), plus `inclusion_decision = 'exclude'`, which is the
 * human-owned record from migration 010. The row stops appearing anywhere a
 * reader looks, keeps its id, keeps its funding, and can be reinstated by one
 * update if a call was wrong.
 *
 * THE DECISION IS NOT MADE HERE. It is read from founding-unresolved.json,
 * where every entry already carries a verdict from the controlled vocabulary in
 * lib/verdicts.js and a written note with a URL. Two verdicts mean the row does
 * not belong in the index at all:
 *
 *   `scope`          probably not neurotechnology
 *   `not-a-company`  a research project, consortium, society, grant, facility,
 *                    publication or book
 *
 * Deliberately NOT removed, though it might look like they should be:
 *
 *   `product-not-company` and `wrong-entity` are rows pointing at the wrong
 *   thing, not rows that should not exist. Quell is NeuroMetrix; the fix is to
 *   re-point the row, and removing it would lose a real company.
 *
 *   `dead-domain`, `dissolved` and `acquired` describe companies that were
 *   real. An index of a field is allowed to hold its history, and deciding
 *   otherwise is a separate editorial call from deciding what is on topic.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { core, stripInvisible } from './lib/funding.js'
import { normalise } from './lib/verdicts.js'

const COMMIT = process.argv.includes('--commit')
const FILE = 'scripts/data/founding-unresolved.json'
const REMOVE_VERDICTS = new Set(['scope', 'not-a-company'])

async function run() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const register = JSON.parse(readFileSync(FILE, 'utf8'))
  const targets = register.filter(r => REMOVE_VERDICTS.has(normalise(r.verdict)))

  const orgs = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await sb.from('organizations')
      .select('id,name,in_scope,inclusion_decision,inclusion_basis,total_raised_usd')
      .eq('type', 'company').order('id').range(from, from + 499)
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

  const writes = [], already = [], missing = [], ambiguous = []
  for (const r of targets) {
    const rows = byCore.get(core(stripInvisible(r.name))) || []
    if (rows.length === 0) { missing.push(r.name); continue }
    if (rows.length > 1) { ambiguous.push(`${r.name} (${rows.length} rows)`); continue }
    const o = rows[0]
    if (o.in_scope === false && o.inclusion_decision === 'exclude') { already.push(o.name); continue }
    writes.push({ id: o.id, name: o.name, verdict: normalise(r.verdict), raised: o.total_raised_usd })
  }

  const byVerdict = {}
  for (const w of writes) byVerdict[w.verdict] = (byVerdict[w.verdict] || 0) + 1
  console.log(`${targets.length} rows carry a removing verdict`)
  console.log(`  ${writes.length} to remove ${JSON.stringify(byVerdict)}`)
  console.log(`  ${already.length} already out, ${missing.length} not found, ${ambiguous.length} ambiguous`)
  // A removed row that carries a funding total is worth a second look: it means
  // somebody researched money for a company we are now calling off topic.
  const funded = writes.filter(w => w.raised)
  if (funded.length) {
    console.log(`\n${funded.length} of these carry a funding total, which is worth checking:`)
    for (const w of funded) console.log(`  ${w.name}  $${(w.raised / 1e6).toFixed(1)}M`)
  }
  if (missing.length) console.log(`\nnot found:\n${missing.map(m => `  ${m}`).join('\n')}`)
  if (ambiguous.length) console.log(`\nambiguous:\n${ambiguous.map(m => `  ${m}`).join('\n')}`)

  if (!COMMIT) { console.log('\nDry run. Re-run with --commit.'); return }

  let done = 0
  const failures = []
  for (const w of writes) {
    // inclusion_basis must be null for an exclude: migration 010 constrains it,
    // since a basis is what puts a company on the chart.
    const { error } = await sb.from('organizations')
      .update({ in_scope: false, inclusion_decision: 'exclude', inclusion_basis: null })
      .eq('id', w.id)
    if (error) failures.push(`${w.name}: ${error.message}`)
    else done++
  }
  console.log(`\nRemoved ${done} of ${writes.length} from the index. No rows were deleted.`)
  if (failures.length) { console.error(failures.map(f => `  ${f}`).join('\n')); process.exit(1) }
}

run().catch(e => { console.error(e); process.exit(1) })
