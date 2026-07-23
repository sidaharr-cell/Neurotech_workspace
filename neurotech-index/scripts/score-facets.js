/**
 * score-facets.js — grade the NEW facet classifier against the gold set.
 *
 * The gold set already carries hand-written facet labels (function / access /
 * application) alongside the old eight-class labels, so the new classifier can
 * be measured on exactly the same 439 items as the old one.
 *
 * Recall and scope use the random draw only; precision pools both draws.
 *
 *   node --env-file=.env scripts/score-facets.js
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { classify } from '../src/lib/classify.js'
import { FUNCTION, ACCESS, APPLICATION } from '../src/lib/facets.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const TABLES = {
  papers: 'papers', patents: 'patents', devices: 'devices', trials: 'news_feed',
  news: 'news_feed', organizations: 'organizations', researchers: 'researchers',
}

const gold = JSON.parse(readFileSync(join(HERE, '../gold-set.json'), 'utf8'))
const items = gold.items.filter(i => gold.labels[i.id])

// Re-fetch full rows so the classifier sees exactly what production sees.
// Rows the database no longer returns (e.g. after the Step 2 purge of
// out-of-scope devices) fall back to the gold-set snapshot, so deletions can't
// silently drop items from the benchmark.
const rows = {}
for (const [type, table] of Object.entries(TABLES)) {
  const ids = items.filter(i => i._type === type).map(i => i.id)
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await sb.from(table).select('*').in('id', ids.slice(i, i + 100))
    ;(data || []).forEach(r => { rows[r.id] = r })
  }
}
for (const it of items) if (!rows[it.id]) rows[it.id] = it

for (const it of items) {
  const r = rows[it.id]
  if (!r) continue
  it.pred = classify(r, it._type)
}
const ok = items.filter(i => i.pred)
const rand = ok.filter(i => i._draw !== 'supplement')
const G = id => gold.labels[id]

function wilson(k, n, z = 1.96) {
  if (!n) return null
  const p = k / n, d = 1 + z * z / n
  const c = (p + z * z / (2 * n)) / d
  const h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h), n }
}
const f = w => (w ? `${(100 * w.p).toFixed(0)}% [${(100 * w.lo).toFixed(0)}-${(100 * w.hi).toFixed(0)}] n=${w.n}` : '—')

const L = []
L.push('# New facet classifier — scored against the gold set\n')
L.push(`${ok.length} items (${rand.length} random draw). 95% Wilson intervals.\n`)

// ── Scope ───────────────────────────────────────────────────────────────────
const scopeRight = rand.filter(i => i.pred.in_scope === G(i.id).in_scope).length
L.push('## Scope agreement\n')
L.push(`Classifier agrees with the label on **${f(wilson(scopeRight, rand.length))}** of rows.\n`)
const truePos = rand.filter(i => G(i.id).in_scope)
const predPos = rand.filter(i => i.pred.in_scope)
L.push(`- scope precision (predicted in-scope that really are): ${f(wilson(predPos.filter(i => G(i.id).in_scope).length, predPos.length))}`)
L.push(`- scope recall (real in-scope that we keep): ${f(wilson(truePos.filter(i => i.pred.in_scope).length, truePos.length))}`)

L.push('\n| content | scope agreement |')
L.push('|---|---|')
for (const t of Object.keys(TABLES)) {
  const g = rand.filter(i => i._type === t)
  if (!g.length) continue
  L.push(`| ${t} | ${f(wilson(g.filter(i => i.pred.in_scope === G(i.id).in_scope).length, g.length))} |`)
}

// ── Per-facet accuracy, over items both sides call in-scope ─────────────────
const FACETS = [
  ['function', 'facet_function', FUNCTION.filter(v => v !== 'none')],
  ['access', 'facet_access', ACCESS.filter(v => v !== 'not_applicable')],
  ['application', 'facet_application', APPLICATION],
]

for (const [label, col, values] of FACETS) {
  L.push(`\n## ${label}\n`)
  L.push('| value | precision | recall | prevalence |')
  L.push('|---|---|---|---|')
  let tpAll = 0, predAll = 0, foundAll = 0, actAll = 0
  for (const v of values) {
    const pred = ok.filter(i => (i.pred[col] || []).includes(v))
    const tp = pred.filter(i => (G(i.id)[label] || []).includes(v))
    const act = rand.filter(i => (G(i.id)[label] || []).includes(v))
    const found = act.filter(i => (i.pred[col] || []).includes(v))
    tpAll += tp.length; predAll += pred.length; foundAll += found.length; actAll += act.length
    if (!pred.length && !act.length) continue
    L.push(`| ${v} | ${f(wilson(tp.length, pred.length))} | ${f(wilson(found.length, act.length))} | ${f(wilson(act.length, rand.length))} |`)
  }
  L.push(`| **all ${label}** | **${f(wilson(tpAll, predAll))}** | **${f(wilson(foundAll, actAll))}** | |`)
}

// ── Abstention ──────────────────────────────────────────────────────────────
const inScopeBoth = rand.filter(i => G(i.id).in_scope && i.pred.in_scope)
const blank = inScopeBoth.filter(i => !i.pred.facet_function.length)
L.push('\n## Abstention\n')
L.push(`Of in-scope items, ${f(wilson(blank.length, inScopeBoth.length))} received no function value — the classifier declined to guess rather than guessing wrong.`)

const out = join(HERE, '../facet-scorecard.md')
writeFileSync(out, L.join('\n') + '\n')
console.log(L.join('\n'))
console.log(`\n✓ wrote ${out}`)
