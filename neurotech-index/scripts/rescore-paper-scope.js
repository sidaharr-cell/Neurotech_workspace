/**
 * rescore-paper-scope.js — re-run the classifier over existing papers after a
 * precision change (classifier v1.1: incidental method keywords no longer put a
 * paper in scope). Updates in_scope and the facet columns where they changed.
 *   node --env-file=.env scripts/rescore-paper-scope.js --dry   # count changes, no write
 *   node --env-file=.env scripts/rescore-paper-scope.js         # apply
 *
 * Keyset-paginates the primary key; writes only rows whose classification
 * actually changed, in small retrying chunks. Idempotent.
 */
import { createClient } from '@supabase/supabase-js'
import { classify } from '../src/lib/classify.js'

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const DRY = process.argv.includes('--dry')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const eqArr = (a, b) => { const A = a || [], B = b || []; return A.length === B.length && A.every(x => B.includes(x)) }

async function upsertChunk(rows) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const { error } = await sb.from('papers').upsert(rows, { onConflict: 'id' })
    if (!error) return true
    if (!/timeout/i.test(error.message) || attempt === 4) { console.warn('\n  upsert error:', error.message); return false }
    await sleep(500 * attempt)
  }
  return false
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY (run with --env-file=.env).'); process.exit(1)
  }
  let scanned = 0, inToOut = 0, outToIn = 0, facetOnly = 0, wrote = 0, deferred = 0
  let last = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    const { data, error } = await sb.from('papers')
      .select('id,title,abstract,mesh,in_scope,facet_function,facet_access,facet_application')
      .gt('id', last).order('id').limit(500)
    if (error) { console.warn('\n  read error:', error.message); break }
    if (!data?.length) break
    last = data[data.length - 1].id
    scanned += data.length

    const changed = []
    for (const p of data) {
      const r = classify(p, 'papers')
      const scopeChanged = !!r.in_scope !== !!p.in_scope
      const facetChanged = !eqArr(r.facet_function, p.facet_function) || !eqArr(r.facet_access, p.facet_access) || !eqArr(r.facet_application, p.facet_application)
      if (!scopeChanged && !facetChanged) continue
      if (scopeChanged) (r.in_scope ? outToIn++ : inToOut++); else facetOnly++
      changed.push({ id: p.id, title: p.title, in_scope: r.in_scope, facet_function: r.facet_function, facet_access: r.facet_access, facet_application: r.facet_application, classifier_version: r.classifier_version })
    }
    if (!DRY) {
      for (let i = 0; i < changed.length; i += 50) {
        if (await upsertChunk(changed.slice(i, i + 50))) wrote += Math.min(50, changed.length - i)
        else deferred += Math.min(50, changed.length - i)
      }
    }
    process.stdout.write(`\r  scanned ${scanned} | in->out ${inToOut}, out->in ${outToIn}, facet-only ${facetOnly}${DRY ? '' : ` | wrote ${wrote}`}`)
  }
  process.stdout.write('\n')
  if (deferred) console.warn(`  ${deferred} deferred by timeout; re-run to finish.`)
  console.log(`${DRY ? 'DRY RUN' : 'Done'}: of ${scanned} papers, ${inToOut} would drop out of scope, ${outToIn} would enter scope, ${facetOnly} facet-only changes.`)
}

main().catch(err => { console.error(err); process.exit(1) })
