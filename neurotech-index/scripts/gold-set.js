/**
 * gold-set.js — build the labeled benchmark for the classification audit.
 *
 * Draws a stratified RANDOM sample across every content type, then labels each
 * item with Claude against docs/taxonomy-rubric.md: scope, the current 8
 * classes, and the proposed facets (function / access / target / application).
 *
 *   node --env-file=.env scripts/gold-set.js [--pilot] [--n=400]
 *
 * --pilot  draws a small sample (40) for rubric validation before the full run.
 * Writes gold-set.json (and gold-set.pilot.json for pilots). Re-running with
 * the same file present skips already-labeled ids, so it is resumable.
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))
const RUBRIC = readFileSync(join(HERE, '../docs/taxonomy-rubric.md'), 'utf8')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PILOT = process.argv.includes('--pilot')
const N = Number(process.argv.find(a => a.startsWith('--n='))?.slice(4)) || (PILOT ? 40 : 400)
const OUT = join(HERE, PILOT ? '../gold-set.pilot.json' : '../gold-set.json')

// ── Strata ──────────────────────────────────────────────────────────────────
// Proportions are deliberately NOT population-weighted: papers and patents
// would swamp everything. Each type gets enough items to measure it.
const STRATA = [
  { key: 'papers',        table: 'papers',        share: 0.25, cols: 'id,title,abstract,journal,year,tags' },
  { key: 'patents',       table: 'patents',       share: 0.20, cols: 'id,title,abstract,assignee,cpc_codes,tags' },
  { key: 'devices',       table: 'devices',       share: 0.15, cols: 'id,name,manufacturer,type,status,description,tags' },
  { key: 'trials',        table: 'news_feed',     share: 0.15, cols: 'id,title,summary,topics,metadata', eq: ['entry_type', 'trial'] },
  { key: 'organizations', table: 'organizations', share: 0.15, cols: 'id,name,type,location,description,focus_areas' },
  { key: 'news',          table: 'news_feed',     share: 0.05, cols: 'id,title,summary,source,topics', neq: ['entry_type', 'trial'] },
  { key: 'researchers',   table: 'researchers',   share: 0.05, cols: 'id,name,affiliation,role,bio,expertise' },
]

const countOf = s => {
  let b = sb.from(s.table).select('*', { count: 'exact', head: true })
  if (s.eq) b = b.eq(...s.eq); if (s.neq) b = b.neq(...s.neq)
  return b
}

/**
 * Seek to the first row whose uuid sorts after a random uuid. Uniform enough
 * for sampling and index-seekable — a plain OFFSET into 83k papers takes ~7s
 * and times out under concurrency, this takes ~200ms.
 */
const seek = (s, after) => {
  let b = sb.from(s.table).select(s.cols).gt('id', after).order('id').limit(1)
  if (s.eq) b = b.eq(...s.eq); if (s.neq) b = b.neq(...s.neq)
  return b
}
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

async function drawSample() {
  const out = []
  for (const s of STRATA) {
    const { count } = await countOf(s)
    if (!count) continue
    const want = Math.min(Math.round(N * s.share), count)
    process.stdout.write(`  ${s.key}: sampling ${want} of ${count.toLocaleString()}`)
    const seen = new Set()
    // Cap attempts so a small table (researchers has 12 rows) can't spin.
    for (let tries = 0; seen.size < want && tries < want * 20; tries++) {
      let { data } = await seek(s, crypto.randomUUID())
      // Random uuid landed past the last row — wrap around to the start.
      if (!data?.length) ({ data } = await seek(s, ZERO_UUID))
      const row = data?.[0]
      if (!row || seen.has(row.id)) continue
      seen.add(row.id)
      out.push({ _type: s.key, ...row })
    }
    console.log(` → ${seen.size}`)
  }
  return out
}

// ── Prompt shaping ──────────────────────────────────────────────────────────
const clip = (s, n) => (s == null ? '' : String(s).slice(0, n))
function render(item) {
  const f = []
  const push = (k, v) => { if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) f.push(`${k}: ${Array.isArray(v) ? v.join(', ') : v}`) }
  switch (item._type) {
    case 'papers':  push('Title', item.title); push('Journal', item.journal); push('Year', item.year); push('Abstract', clip(item.abstract, 1200)); break
    // CPC codes are deliberately NOT shown. The patent tagger derives its tags
    // from CPC, so showing them to the labeler would make the label depend on
    // the same signal being graded — the tagger would score against itself.
    // Patents with no abstract will come back low-confidence; that is a real
    // finding about the corpus, not a labeling failure.
    case 'patents': push('Title', item.title); push('Assignee', item.assignee); push('Abstract', clip(item.abstract, 1200)); break
    case 'devices': push('Device name', item.name); push('Manufacturer', item.manufacturer); push('FDA class', item.type); push('Status', item.status); push('Description', item.description); break
    case 'trials':  push('Trial title', item.title); push('Summary', clip(item.summary, 900))
                    push('Conditions', item.metadata?.conditions); push('Interventions', item.metadata?.interventions); push('Phase', item.metadata?.phase); break
    case 'news':    push('Headline', item.title); push('Source', item.source); push('Summary', clip(item.summary, 900)); break
    case 'organizations': push('Name', item.name); push('Kind', item.type); push('Location', item.location); push('Description', clip(item.description, 900)); break
    case 'researchers':   push('Name', item.name); push('Affiliation', item.affiliation); push('Role', item.role); push('Bio', clip(item.bio, 900)); break
  }
  return `<item id="${item.id}" content_type="${item._type}">\n${f.join('\n')}\n</item>`
}

// ── Structured output schema ────────────────────────────────────────────────
export const CLASSES = ['recording', 'stimulation', 'interface', 'sensory', 'motor', 'closed-loop', 'cognitive', 'imaging']
const FUNCTIONS = ['records', 'stimulates', 'images', 'decodes', 'none']
const ACCESS = ['non_invasive', 'minimally_invasive', 'implanted_non_penetrating', 'implanted_penetrating', 'not_applicable']
const TARGET = ['brain', 'spinal_cord', 'peripheral_nerve', 'neuromuscular', 'autonomic', 'not_applicable']
const APPS = ['movement_restoration', 'communication_speech', 'sensory_restoration', 'epilepsy', 'movement_disorders',
  'psychiatric', 'pain', 'cognition_memory', 'autonomic_organ', 'rehabilitation', 'diagnostics', 'research_tool', 'consumer_wellness']
const OOS = ['in_scope', 'basic_neuroscience', 'drug_or_biologic', 'surgical_hardware_consumable', 'non_nervous_system', 'other']

const SCHEMA = {
  type: 'object',
  properties: {
    labels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          in_scope: { type: 'boolean' },
          out_of_scope_category: { type: 'string', enum: OOS },
          scope_reason: { type: 'string' },
          current_classes: { type: 'array', items: { type: 'string', enum: CLASSES } },
          function: { type: 'array', items: { type: 'string', enum: FUNCTIONS } },
          access: { type: 'array', items: { type: 'string', enum: ACCESS } },
          target: { type: 'array', items: { type: 'string', enum: TARGET } },
          application: { type: 'array', items: { type: 'string', enum: APPS } },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['id', 'in_scope', 'out_of_scope_category', 'scope_reason', 'current_classes',
          'function', 'access', 'target', 'application', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['labels'],
  additionalProperties: false,
}

/** The schema can't express "this value is exclusive" — enforce it after. */
function normalize(l) {
  const excl = (arr, v) => (arr.includes(v) && arr.length > 1 ? [v] : arr)
  l.function = excl(l.function, 'none')
  l.access = excl(l.access, 'not_applicable')
  l.target = excl(l.target, 'not_applicable')
  if (l.in_scope) l.out_of_scope_category = 'in_scope'
  else if (l.out_of_scope_category === 'in_scope') l.out_of_scope_category = 'other'
  return l
}

const SYSTEM = `You are labeling records for NeuroBase, a neurotechnology index, to build a gold-standard benchmark.

Apply the rubric below exactly. It is the sole authority — do not substitute your own idea of what "neurotech" should mean, and in particular do not exclude peripheral/autonomic neuromodulation or rehabilitation/EMG systems, which the site owner has ruled IN scope.

Label each item independently. Records are often sparse (a device name and an FDA product code, a one-line lab description) — label what the evidence supports and set confidence to low rather than inventing detail. For an out-of-scope item, return an empty current_classes list, function ["none"], access "not_applicable", target "not_applicable", and an empty application list.

Return one label object per item, with the id echoed exactly.

<rubric>
${RUBRIC}
</rubric>`

async function labelBatch(items) {
  const res = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Label these ${items.length} items:\n\n${items.map(render).join('\n\n')}` }],
  })
  if (res.stop_reason === 'max_tokens') throw new Error('max_tokens')
  if (res.stop_reason === 'refusal') throw new Error('refusal')
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('')
  return JSON.parse(text).labels.map(normalize)
}

/**
 * Per-class precision supplement.
 *
 * A 400-item random sample cannot measure a class the corpus barely contains —
 * `cognitive` is 0.06% of patents, so it would appear zero times. Sampling on
 * the *prediction* fixes that: draw items the live matcher tagged with each
 * class, and the labels tell you how often that tag is right. Precision comes
 * from this draw; recall and prevalence must come from the random draw only.
 */
const SUPP_TABLES = [
  { key: 'papers', table: 'papers', field: 'tags', cols: 'id,title,abstract,journal,year' },
  { key: 'patents', table: 'patents', field: 'tags', cols: 'id,title,abstract,assignee' },
  { key: 'devices', table: 'devices', field: 'tags', cols: 'id,name,manufacturer,type,status,description' },
  { key: 'trials', table: 'news_feed', field: 'topics', cols: 'id,title,summary,metadata', eq: ['entry_type', 'trial'] },
]

async function drawSupplement(perClass = 6) {
  const out = []
  const seen = new Set()
  for (const cls of CLASSES) {
    let got = 0
    for (const s of SUPP_TABLES) {
      if (got >= perClass) break
      let q = sb.from(s.table).select(s.cols).contains(s.field, JSON.stringify([cls])).limit(perClass * 3)
      if (s.eq) q = q.eq(...s.eq)
      const { data, error } = await q
      if (error || !data?.length) continue
      // Shuffle so we don't always take the oldest rows for a class.
      for (const row of data.sort(() => Math.random() - 0.5)) {
        if (got >= perClass || seen.has(row.id)) continue
        seen.add(row.id); got++
        out.push({ _type: s.key, _draw: 'supplement', _predicted: cls, ...row })
      }
    }
    process.stdout.write(`\r  supplement: ${out.length} items`)
  }
  console.log('')
  return out
}

// ── Run ─────────────────────────────────────────────────────────────────────
console.log(`Building ${PILOT ? 'PILOT ' : ''}gold set (target n=${N})...`)
const store = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { rubric: 'v2', items: [], labels: {} }

if (!store.items.length) {
  const random = (await drawSample()).map(r => ({ ...r, _draw: 'random' }))
  const supplement = await drawSupplement(PILOT ? 2 : 6)
  // Drop supplement rows the random draw already picked up.
  const ids = new Set(random.map(r => r.id))
  store.items = [...random, ...supplement.filter(r => !ids.has(r.id))]
  writeFileSync(OUT, JSON.stringify(store, null, 2))
}
const nRandom = store.items.filter(i => i._draw === 'random').length
console.log(`sample: ${store.items.length} items (${nRandom} random + ${store.items.length - nRandom} precision supplement); already labeled: ${Object.keys(store.labels).length}`)

const todo = store.items.filter(i => !store.labels[i.id])
const BATCH = 5
const batches = []
for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH))

let done = 0
for (let i = 0; i < batches.length; i += 3) {
  const group = batches.slice(i, i + 3)
  await Promise.all(group.map(async b => {
    let labels
    try { labels = await labelBatch(b) }
    catch (e) {
      // Retry one-at-a-time so a single bad record can't sink the batch.
      labels = []
      for (const one of b) {
        try { labels.push(...await labelBatch([one])) }
        catch (e2) { console.warn(`\n  skip ${one._type} ${one.id}: ${e2.message}`) }
      }
    }
    for (const l of labels) if (store.labels[l.id] === undefined) store.labels[l.id] = l
    done += b.length
    process.stdout.write(`\r  labeled ${Math.min(done, todo.length)}/${todo.length}`)
  }))
  writeFileSync(OUT, JSON.stringify(store, null, 2))
}

console.log(`\n✓ ${Object.keys(store.labels).length} labels → ${OUT}`)

/**
 * Replicate pass — label a subset a second time, independently, to measure how
 * far the labeler agrees with itself. This sets the benchmark's ceiling: if
 * self-agreement on scope is 88%, a matcher scoring 88% is already at the
 * noise floor and "improving" it further is unmeasurable. Batches are rebuilt
 * from a reshuffle so items sit next to different neighbours than the first
 * pass, which also surfaces any batch-level anchoring.
 */
const REP = Number(process.argv.find(a => a.startsWith('--replicate='))?.slice(12)) || (PILOT ? 10 : 60)
if (REP > 0 && !store.replicates) {
  console.log(`\nReplicate pass on ${REP} items (labeler self-agreement)...`)
  store.replicates = {}
  const pool = store.items.filter(i => store.labels[i.id]).sort(() => Math.random() - 0.5).slice(0, REP)
  const rb = []
  for (let i = 0; i < pool.length; i += BATCH) rb.push(pool.slice(i, i + BATCH))
  for (let i = 0; i < rb.length; i += 3) {
    await Promise.all(rb.slice(i, i + 3).map(async b => {
      try { (await labelBatch(b)).forEach(l => { store.replicates[l.id] = l }) } catch { /* skip */ }
    }))
    writeFileSync(OUT, JSON.stringify(store, null, 2))
  }
  const ids = Object.keys(store.replicates)
  const same = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort())
  const agree = f => ids.filter(id => (f === 'in_scope'
    ? store.labels[id].in_scope === store.replicates[id].in_scope
    : same(store.labels[id][f], store.replicates[id][f]))).length
  console.log(`\nSelf-agreement over ${ids.length} items:`)
  for (const f of ['in_scope', 'current_classes', 'function', 'access', 'target', 'application'])
    console.log(`  ${f.padEnd(16)} ${((100 * agree(f)) / ids.length).toFixed(0)}%`)
  writeFileSync(OUT, JSON.stringify(store, null, 2))
}
