/**
 * score-taxonomy.js — grade the live classifier against the labeled gold set.
 *
 * Re-fetches the FULL row for every gold item so both classifier paths are
 * reproduced exactly as the site runs them:
 *   Path A — stored tags, what the section pages filter on server-side.
 *   Path B — regex over JSON.stringify(entity), what Feed/Search/Companies use.
 *
 * Sampling discipline:
 *   recall + prevalence  → random draw ONLY (population-representative)
 *   precision            → random + precision supplement (class-conditional)
 * Mixing them would bias prevalence toward the rare classes the supplement
 * deliberately oversamples, so the two draws are never pooled for recall.
 *
 *   node --env-file=.env scripts/score-taxonomy.js [--pilot]
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { DEVICE_CLASSES } from '../src/lib/taxonomy.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PILOT = process.argv.includes('--pilot')
const GOLD = join(HERE, PILOT ? '../gold-set.pilot.json' : '../gold-set.json')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const IDS = DEVICE_CLASSES.map(c => c.id)

const TABLES = {
  papers: { table: 'papers', tagField: 'tags', cols: 'id,title,authors,journal,year,doi,url,abstract,tags,pubmed_id,arxiv_id,source' },
  patents: { table: 'patents', tagField: 'tags', cols: 'id,patent_number,title,abstract,assignee,grant_date,cpc_codes,tags,url' },
  devices: { table: 'devices', tagField: 'tags', cols: 'id,name,manufacturer,type,year,status,signal_type,channels,description,modality,tags,url' },
  trials: { table: 'news_feed', tagField: 'topics', cols: 'id,title,summary,source,url,published_at,topics,relevance_score,entry_type,metadata' },
  news: { table: 'news_feed', tagField: 'topics', cols: 'id,title,summary,source,url,published_at,topics,relevance_score,entry_type,metadata' },
  organizations: { table: 'organizations', tagField: 'focus_areas', cols: 'id,name,type,location,founded,description,focus_areas,website,founders' },
  researchers: { table: 'researchers', tagField: 'expertise', cols: 'id,name,affiliation,role,bio,expertise,notable_work' },
}

const NORMALIZE = {
  papers: p => ({ title: p.title, authors: p.authors || [], journal: p.journal, year: p.year, doi: p.doi, url: p.url, abstract: p.abstract, tags: p.tags || [], pubmedId: p.pubmed_id, arxivId: p.arxiv_id, source: p.source }),
  devices: d => ({ name: d.name, manufacturer: d.manufacturer, type: d.type, year: d.year, status: d.status, signalType: d.signal_type, channels: d.channels, description: d.description, modality: d.modality || [], tags: d.tags || [], url: d.url }),
  organizations: o => ({ name: o.name, type: o.type, location: o.location, founded: o.founded, description: o.description, focusAreas: o.focus_areas || [], website: o.website, founders: o.founders || [] }),
  researchers: r => ({ name: r.name, affiliation: r.affiliation, role: r.role, bio: r.bio, expertise: r.expertise || [], notableWork: r.notable_work || [] }),
}

const regexClasses = e => {
  const h = JSON.stringify(e || {}).toLowerCase()
  return DEVICE_CLASSES.filter(c => c.match.some(m => h.includes(m))).map(c => c.id)
}

/** Wilson score interval — honest error bars on small samples. */
function wilson(k, n, z = 1.96) {
  if (!n) return null
  const p = k / n, d = 1 + z * z / n
  const c = (p + z * z / (2 * n)) / d
  const half = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d
  return { p, lo: Math.max(0, c - half), hi: Math.min(1, c + half), n, k }
}
const fmt = w => (w ? `${(100 * w.p).toFixed(0)}% [${(100 * w.lo).toFixed(0)}–${(100 * w.hi).toFixed(0)}] n=${w.n}` : '—')

// ── Load gold set and re-fetch full rows ────────────────────────────────────
const gold = JSON.parse(readFileSync(GOLD, 'utf8'))
const labeled = gold.items.filter(i => gold.labels[i.id])
console.log(`gold set: ${labeled.length} labeled items`)

const rows = {}
for (const [type, cfg] of Object.entries(TABLES)) {
  const ids = labeled.filter(i => i._type === type).map(i => i.id)
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb.from(cfg.table).select(cfg.cols).in('id', ids.slice(i, i + 100))
    if (error) { console.error(type, error.message); continue }
    data.forEach(r => { rows[r.id] = { ...r, _type: type } })
  }
}
// Fall back to the snapshot stored in the gold set for any row the database no
// longer returns. Without this, the Step 2 purge of out-of-scope rows would
// make those items silently vanish from the scorer — and since ~40% of the
// gold set is out of scope, the next scorecard would misreport near-100%
// in-scope. The gold set carries the same columns the classifier reads.
let recovered = 0
for (const it of labeled) {
  if (rows[it.id]) continue
  rows[it.id] = { ...it, _type: it._type }
  recovered++
}
console.log(`re-fetched ${Object.keys(rows).length - recovered} rows; recovered ${recovered} from the gold-set snapshot`)

// ── Predict both paths ──────────────────────────────────────────────────────
for (const it of labeled) {
  const row = rows[it.id]
  if (!row) continue
  const cfg = TABLES[it._type]
  it._pathA = (row[cfg.tagField] || []).filter(t => IDS.includes(t))
  it._pathB = regexClasses(NORMALIZE[it._type] ? NORMALIZE[it._type](row) : row)
}

const usable = labeled.filter(i => i._pathA)
const random = usable.filter(i => i._draw !== 'supplement')
const G = id => gold.labels[id]

// ── Report ──────────────────────────────────────────────────────────────────
const L = []
const pushTable = (head, sep, lines) => { L.push(head, sep, ...lines) }
L.push('# Classifier scorecard vs. gold set\n')
L.push(`Generated ${new Date().toISOString().slice(0, 10)} · rubric ${gold.rubric || 'v2'} · ${usable.length} labeled items (${random.length} random draw, ${usable.length - random.length} precision supplement).`)
L.push('\nAll figures carry 95% Wilson intervals. **Recall and prevalence use the random draw only**; precision pools both draws, which is a class-conditional sample and not population-weighted.\n')

// 1. Scope
L.push('## 1. Scope — is the index full of things that belong in it?\n')
const inScope = random.filter(i => G(i.id).in_scope)
L.push(`Of the random draw, **${fmt(wilson(inScope.length, random.length))}** of rows are in-scope neurotech under the rubric.\n`)
L.push('| Content type | in scope | tagged by section pages | tagged by feed/search |')
L.push('|---|---|---|---|')
for (const t of Object.keys(TABLES)) {
  const g = random.filter(i => i._type === t)
  if (!g.length) continue
  const ins = g.filter(i => G(i.id).in_scope)
  L.push(`| ${t} | ${fmt(wilson(ins.length, g.length))} | ${fmt(wilson(g.filter(i => i._pathA.length).length, g.length))} | ${fmt(wilson(g.filter(i => i._pathB.length).length, g.length))} |`)
}

L.push('\n### Why out-of-scope rows are in the index\n')
const oos = random.filter(i => !G(i.id).in_scope)
const cat = {}
oos.forEach(i => { const c = G(i.id).out_of_scope_category; cat[c] = (cat[c] || 0) + 1 })
L.push('| reason | rows | share of all out-of-scope |')
L.push('|---|---:|---:|')
Object.entries(cat).sort((a, b) => b[1] - a[1]).forEach(([c, n]) =>
  L.push(`| ${c} | ${n} | ${(100 * n / oos.length).toFixed(0)}% |`))

// 2. Coverage of in-scope items — the honest denominator
L.push('\n## 2. Coverage — of items that DO belong, how many are reachable by a pill?\n')
L.push('| Content type | section pages | feed/search |')
L.push('|---|---|---|')
for (const t of Object.keys(TABLES)) {
  const g = random.filter(i => i._type === t && G(i.id).in_scope)
  if (!g.length) continue
  L.push(`| ${t} | ${fmt(wilson(g.filter(i => i._pathA.length).length, g.length))} | ${fmt(wilson(g.filter(i => i._pathB.length).length, g.length))} |`)
}
const allIn = random.filter(i => G(i.id).in_scope)
L.push(`| **all** | **${fmt(wilson(allIn.filter(i => i._pathA.length).length, allIn.length))}** | **${fmt(wilson(allIn.filter(i => i._pathB.length).length, allIn.length))}** |`)

// 3. Per-class precision / recall
L.push('\n## 3. Per-class accuracy of the current eight classes\n')
for (const [path, key] of [['Section pages (stored tags)', '_pathA'], ['Feed / Search (regex)', '_pathB']]) {
  L.push(`\n**${path}**\n`)
  L.push('| class | precision | recall | gold prevalence |')
  L.push('|---|---|---|---|')
  for (const c of IDS) {
    const predicted = usable.filter(i => i[key].includes(c))
    const pTrue = predicted.filter(i => G(i.id).current_classes.includes(c))
    const actual = random.filter(i => G(i.id).current_classes.includes(c))
    const rTrue = actual.filter(i => i[key].includes(c))
    L.push(`| ${c} | ${fmt(wilson(pTrue.length, predicted.length))} | ${fmt(wilson(rTrue.length, actual.length))} | ${fmt(wilson(actual.length, random.length))} |`)
  }
}

// 4. Divergence between the two paths
L.push('\n## 4. Do the two paths agree with each other?\n')
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
L.push(`The two classifiers return identical class sets on **${fmt(wilson(usable.filter(i => same(i._pathA, i._pathB)).length, usable.length))}** of gold items.\n`)

// 5. Confidence + ceiling
L.push('## 5. How much of this is measurable?\n')
const conf = {}
usable.forEach(i => { const c = G(i.id).confidence; conf[c] = (conf[c] || 0) + 1 })
L.push(`Label confidence: ${Object.entries(conf).map(([k, v]) => `${k} ${v}`).join(' · ')}.\n`)
if (gold.replicates && Object.keys(gold.replicates).length) {
  const rid = Object.keys(gold.replicates).filter(id => gold.labels[id])
  const eq = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort())
  L.push('Labeler self-agreement on an independent second pass — the ceiling any classifier can be measured against:\n')
  L.push('| field | agreement |')
  L.push('|---|---|')
  for (const f of ['in_scope', 'current_classes', 'function', 'access', 'target', 'application']) {
    const k = rid.filter(id => f === 'in_scope'
      ? gold.labels[id].in_scope === gold.replicates[id].in_scope
      : eq(gold.labels[id][f], gold.replicates[id][f])).length
    L.push(`| ${f} | ${fmt(wilson(k, rid.length))} |`)
  }
}

// 6. Proposed facets — what the data would look like
L.push('\n## 6. The proposed facets, over in-scope items\n')
const facet = f => {
  const m = {}
  allIn.forEach(i => (G(i.id)[f] || []).forEach(v => { m[v] = (m[v] || 0) + 1 }))
  return Object.entries(m).sort((a, b) => b[1] - a[1])
}
for (const f of ['function', 'access', 'target', 'application']) {
  L.push(`\n**${f}** — ${facet(f).map(([v, n]) => `${v} ${(100 * n / allIn.length).toFixed(0)}%`).join(' · ')}`)
}
const multi = allIn.filter(i => G(i.id).current_classes.length > 1).length
L.push(`\n\nNon-exclusivity of the **current** scheme, measured on labels rather than keywords: **${fmt(wilson(multi, allIn.length))}** of in-scope items genuinely belong to two or more of the eight classes.`)
const bci = allIn.filter(i => { const fn = G(i.id).function; return fn.includes('records') && fn.includes('decodes') }).length
const cl = allIn.filter(i => { const fn = G(i.id).function; return fn.includes('records') && fn.includes('stimulates') }).length
L.push(`\nDerived badges under the proposed scheme: **BCI** (records+decodes) ${fmt(wilson(bci, allIn.length))} · **closed-loop** (records+stimulates) ${fmt(wilson(cl, allIn.length))}.`)

const out = join(HERE, PILOT ? '../scorecard.pilot.md' : '../scorecard.md')
writeFileSync(out, L.join('\n') + '\n')
console.log(L.join('\n'))
console.log(`\n✓ wrote ${out}`)
