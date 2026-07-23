/**
 * proto-matcher.js — prototype of the PROPOSED matcher, graded against the
 * same 439-item gold set used to score the live system.
 *
 * Three changes vs. the live matcher:
 *   1. reads named content fields only (never the whole flattened record, so
 *      author names, journals, URLs and ids can't trigger a match)
 *   2. matches at word starts with an allowed suffix (`electrophysiolog` still
 *      catches "electrophysiological"; `ecog` no longer catches "recognition")
 *   3. a repaired keyword list — bare stems that were semantically wrong are
 *      replaced with phrases, and the spelled-out synonyms the old list missed
 *      are added
 * Patents additionally keep their CPC-derived tags, the one place stored tags
 * beat text matching.
 *
 *   node --env-file=.env scripts/proto-matcher.js
 */
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { DEVICE_CLASSES } from '../src/lib/taxonomy.js'
import { cpcTags } from './backfill-patents.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const IDS = DEVICE_CLASSES.map(c => c.id)

// ── Proposed vocabulary ─────────────────────────────────────────────────────
// `stems`  match at a word start and may carry any suffix.
// `words`  match as whole words only, no suffix (short, ambiguous tokens).
// `phrases` match as bounded phrases.
const SPEC = {
  recording: {
    stems: ['eeg', 'ecog', 'electrocorticograph', 'electrophysiolog', 'intracortical', 'microelectrode', 'electromyograph', 'electrocortical'],
    words: ['lfp', 'lfps', 'emg'],
    phrases: ['single-unit', 'multi-unit', 'neural recording', 'utah array', 'recording array', 'local field potential', 'evoked potential', 'spike sorting', 'neural signal acquisition'],
  },
  stimulation: {
    stems: ['neurostimulat', 'neuromodulat', 'transcranial', 'stimulator', 'defibrillat'],
    words: ['dbs', 'tms', 'rtms', 'tdcs', 'tacs', 'tens', 'vns', 'scs'],
    phrases: ['deep brain stimulation', 'spinal cord stimulation', 'vagus nerve stimulation', 'vagal nerve stimulation',
      'functional electrical stimulation', 'transcutaneous electrical nerve', 'transcutaneous direct current',
      'direct current stimulation', 'magnetic stimulation', 'epidural stimulation', 'cortical stimulation',
      'peripheral nerve stimulation', 'sacral nerve stimulation', 'phrenic nerve', 'electrical stimulation',
      'focused ultrasound', 'optogenetic stimulation'],
  },
  interface: {
    stems: ['decod', 'neuroprosthetic control'],
    words: ['bci', 'bcis', 'bmi'],
    phrases: ['brain-computer', 'brain computer', 'brain-machine', 'brain machine', 'neural interface',
      'neural decoding', 'speech decoding', 'motor decoding', 'neural bypass', 'braingate', 'neuralink',
      'stentrode', 'intention decoding', 'neural control'],
  },
  sensory: {
    stems: ['cochlear', 'somatosensory'],
    phrases: ['bionic eye', 'visual prosthes', 'auditory prosthes', 'sensory restoration', 'artificial vision',
      'hearing loss', 'hearing restoration', 'hearing preservation', 'hearing aid', 'retinal implant',
      'retinal prosthes', 'sensory feedback', 'tactile feedback', 'auditory brainstem'],
  },
  motor: {
    stems: ['neuroprosthes', 'neuroprosthet', 'exoskeleton', 'prosthes', 'tetrapleg', 'quadripleg', 'hemipares'],
    words: ['fes'],
    phrases: ['prosthetic limb', 'robotic arm', 'reach and grasp', 'motor restoration', 'gait training',
      'spinal cord injury', 'upper limb rehabilitation', 'functional electrical stimulation', 'locomotor recovery'],
  },
  'closed-loop': {
    phrases: ['closed-loop', 'closed loop', 'responsive neurostim', 'bidirectional', 'real-time feedback',
      'adaptive dbs', 'adaptive stimulation', 'adaptive deep brain', 'sense and stimulate'],
  },
  cognitive: {
    phrases: ['cognitive prosthes', 'memory prosthes', 'hippocampal prosthes', 'memory enhancement',
      'cognitive neuroprosthet', 'working memory', 'memory encoding', 'cognitive training', 'cognitive enhancement',
      'attention monitoring', 'memory restoration', 'cognitive rehabilitation', 'cognitive assessment'],
  },
  imaging: {
    stems: ['fmri', 'fnirs', 'meg', 'magnetoencephalograph', 'neuroimaging', 'tomograph'],
    phrases: ['functional near-infrared', 'calcium imaging', 'two-photon', 'functional imaging',
      'functional ultrasound', 'diffusion tensor', 'positron emission', 'magnetic resonance imaging'],
  },
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const COMPILED = Object.fromEntries(Object.entries(SPEC).map(([id, s]) => [id, [
  ...(s.stems || []).map(t => new RegExp(`\\b${esc(t)}[a-z]*`, 'i')),
  ...(s.words || []).map(t => new RegExp(`\\b${esc(t)}\\b`, 'i')),
  ...(s.phrases || []).map(t => new RegExp(`\\b${esc(t)}`, 'i')),
]]))

/** Named content fields only — never the whole record. */
function contentOf(row, type) {
  const m = row.metadata || {}
  const pick = {
    papers: [row.title, row.abstract],
    patents: [row.title, row.abstract],
    devices: [row.name, row.description],
    trials: [row.title, row.summary, (m.conditions || []).join(' '), (m.interventions || []).join(' ')],
    news: [row.title, row.summary],
    organizations: [row.name, row.description, (row.focus_areas || []).join(' ')],
    researchers: [row.name, row.bio, row.role, (row.expertise || []).join(' ')],
  }[type] || []
  return pick.filter(Boolean).join(' \n ')
}

export function proposedClasses(row, type) {
  const text = contentOf(row, type)
  const out = new Set()
  for (const [id, res] of Object.entries(COMPILED)) if (res.some(re => re.test(text))) out.add(id)
  // Patents: CPC codes are authoritative and cover rows with no abstract.
  if (type === 'patents') cpcTags(row.cpc_codes).forEach(t => out.add(t))
  return [...out]
}

// ── Grade all three matchers against the gold set ───────────────────────────
const legacy = e => {
  const h = JSON.stringify(e || {}).toLowerCase()
  return DEVICE_CLASSES.filter(c => c.match.some(m => h.includes(m))).map(c => c.id)
}
const NORM = {
  papers: p => ({ title: p.title, authors: p.authors || [], journal: p.journal, year: p.year, doi: p.doi, url: p.url, abstract: p.abstract, tags: p.tags || [], pubmedId: p.pubmed_id, arxivId: p.arxiv_id, source: p.source }),
  devices: d => ({ name: d.name, manufacturer: d.manufacturer, type: d.type, year: d.year, status: d.status, signalType: d.signal_type, channels: d.channels, description: d.description, modality: d.modality || [], tags: d.tags || [], url: d.url }),
  organizations: o => ({ name: o.name, type: o.type, location: o.location, founded: o.founded, description: o.description, focusAreas: o.focus_areas || [], website: o.website, founders: o.founders || [] }),
  researchers: r => ({ name: r.name, affiliation: r.affiliation, role: r.role, bio: r.bio, expertise: r.expertise || [], notableWork: r.notable_work || [] }),
}
const TABLES = {
  papers: { table: 'papers', tag: 'tags', cols: '*' }, patents: { table: 'patents', tag: 'tags', cols: '*' },
  devices: { table: 'devices', tag: 'tags', cols: '*' }, trials: { table: 'news_feed', tag: 'topics', cols: '*' },
  news: { table: 'news_feed', tag: 'topics', cols: '*' }, organizations: { table: 'organizations', tag: 'focus_areas', cols: '*' },
  researchers: { table: 'researchers', tag: 'expertise', cols: '*' },
}

const gold = JSON.parse(readFileSync(join(HERE, '../gold-set.json'), 'utf8'))
const items = gold.items.filter(i => gold.labels[i.id])
const rows = {}
for (const [type, cfg] of Object.entries(TABLES)) {
  const ids = items.filter(i => i._type === type).map(i => i.id)
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await sb.from(cfg.table).select(cfg.cols).in('id', ids.slice(i, i + 100))
    ;(data || []).forEach(r => { rows[r.id] = r })
  }
}

function wilson(k, n, z = 1.96) {
  if (!n) return null
  const p = k / n, d = 1 + z * z / n
  const c = (p + z * z / (2 * n)) / d
  const h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h), n }
}
const f = w => (w ? `${(100 * w.p).toFixed(0)}% [${(100 * w.lo).toFixed(0)}-${(100 * w.hi).toFixed(0)}]` : '—')

for (const it of items) {
  const r = rows[it.id]; if (!r) continue
  it.A = (r[TABLES[it._type].tag] || []).filter(t => IDS.includes(t))
  it.B = legacy(NORM[it._type] ? NORM[it._type](r) : r)
  it.P = proposedClasses(r, it._type)
}
const ok = items.filter(i => i.A)
const rand = ok.filter(i => i._draw !== 'supplement')
const G = id => gold.labels[id]

const L = []
L.push('# Proposed matcher vs. live matcher\n')
L.push(`Graded on the same ${ok.length} gold-set items. 95% Wilson intervals.\n`)
L.push('| class | precision A (stored) | precision B (live regex) | precision PROPOSED | recall A | recall B | recall PROPOSED |')
L.push('|---|---|---|---|---|---|---|')
const agg = { A: [0, 0], B: [0, 0], P: [0, 0] }, aggR = { A: [0, 0], B: [0, 0], P: [0, 0] }
for (const c of IDS) {
  const cells = []
  for (const k of ['A', 'B', 'P']) {
    const pred = ok.filter(i => i[k].includes(c))
    const tp = pred.filter(i => G(i.id).current_classes.includes(c))
    agg[k][0] += tp.length; agg[k][1] += pred.length
    cells.push(f(wilson(tp.length, pred.length)))
  }
  for (const k of ['A', 'B', 'P']) {
    const act = rand.filter(i => G(i.id).current_classes.includes(c))
    const found = act.filter(i => i[k].includes(c))
    aggR[k][0] += found.length; aggR[k][1] += act.length
    cells.push(f(wilson(found.length, act.length)))
  }
  L.push(`| ${c} | ${cells.join(' | ')} |`)
}
L.push(`| **all classes** | **${f(wilson(...agg.A))}** | **${f(wilson(...agg.B))}** | **${f(wilson(...agg.P))}** | **${f(wilson(...aggR.A))}** | **${f(wilson(...aggR.B))}** | **${f(wilson(...aggR.P))}** |`)

const inScope = rand.filter(i => G(i.id).in_scope)
L.push('\n## Coverage of in-scope items\n')
L.push(`- stored tags (A): ${f(wilson(inScope.filter(i => i.A.length).length, inScope.length))}`)
L.push(`- live regex (B): ${f(wilson(inScope.filter(i => i.B.length).length, inScope.length))}`)
L.push(`- proposed: ${f(wilson(inScope.filter(i => i.P.length).length, inScope.length))}`)

const outScope = rand.filter(i => !G(i.id).in_scope)
L.push('\n## False alarms on rows that are not neurotech at all\n')
L.push(`- stored tags (A): ${f(wilson(outScope.filter(i => i.A.length).length, outScope.length))} get a category anyway`)
L.push(`- live regex (B): ${f(wilson(outScope.filter(i => i.B.length).length, outScope.length))}`)
L.push(`- proposed: ${f(wilson(outScope.filter(i => i.P.length).length, outScope.length))}`)

writeFileSync(join(HERE, '../proto-scorecard.md'), L.join('\n') + '\n')
console.log(L.join('\n'))
