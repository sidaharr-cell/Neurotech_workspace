/**
 * mine-frontier-proposals.js — surface candidate capability-axis records from
 * the indexed papers, as PROPOSALS for human review.
 *
 *   node --env-file=.env scripts/mine-frontier-proposals.js                  # dry run
 *   node --env-file=.env scripts/mine-frontier-proposals.js --write          # write the JSON
 *   node --env-file=.env scripts/mine-frontier-proposals.js --subfield DBS --limit 8
 *
 * WHAT THIS IS AND IS NOT. Phase 2 needs at least three records per subfield on
 * the capability axes (performance, longevity, scale, and the rest). Those
 * values exist nowhere in this database: no column holds a channel count or a
 * decoding rate. Writing them from memory is fabrication, so this instead reads
 * what indexed abstracts actually report and files each as a PENDING proposal.
 *
 * Nothing here becomes a frontier record. A human promotes a proposal by moving
 * it into scripts/data/frontier-records.json. That gate is the point: a wrong
 * frontier record does not produce a wrong-looking score, it produces a
 * normal-looking score for every item in its subfield.
 *
 * EXTRACTION, NOT SCORING. The prompt asks only what the abstract states. It
 * never asks whether a result is important, impressive, or novel. Spec section 2
 * forbids unanchored importance questions, and this pass is upstream of scoring
 * entirely. Superlatives are captured into rhetorical_markers for monitoring
 * (spec section 13) and are explicitly not evidence.
 *
 * ABSTRACT-ONLY, AND THAT IS A REAL CEILING. Only abstracts are indexed, so a
 * value whose units or conditions live in the methods section will be missed or
 * partial. This is why the output is proposals rather than records. It also
 * touches open decision 1 (scorer input granularity), which is still open; this
 * pass does not resolve it and does not depend on it, because it produces no
 * scores.
 *
 * The two manual-only subfields (FOCUSED_ULTRASOUND, INTERFACE_MATERIALS) cannot
 * be derived from facets, so no paper resolves to them and this pass will never
 * propose anything for them. They need hand entry.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { subfieldFor, SUBFIELD_IDS, MANUAL_ONLY_SUBFIELDS } from '../src/lib/subfields.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WRITE = process.argv.includes('--write')
const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const ONLY = argOf('--subfield', null)
const LIMIT = Number(argOf('--limit', 16))
const MODEL = 'claude-sonnet-5'
const RUBRIC_VERSION = '1.0'

const AXIS_TYPES = ['performance', 'longevity', 'invasiveness', 'scale',
  'regulatory', 'manufacturability', 'cost']

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Forced tool call rather than "return JSON only" prose. Asking for bare JSON
 * produced a leading "Here is the JSON:" on a meaningful fraction of abstracts,
 * and this model does not support assistant prefill. A forced tool validates the
 * shape and the axis_type enum at the API layer, before any of our code runs.
 */
const EXTRACTION_TOOL = {
  name: 'record_quantitative_results',
  description: 'Record the quantitative results the abstract explicitly states.',
  input_schema: {
    type: 'object',
    properties: {
      quantitative_results: {
        type: 'array',
        description: 'Empty is correct and expected when the abstract reports no usable value.',
        items: {
          type: 'object',
          properties: {
            metric: { type: 'string', description: 'What was measured.' },
            value: { type: 'string', description: 'The number exactly as reported.' },
            units: { type: 'string', description: 'The units exactly as reported.' },
            conditions: { type: 'string', description: 'Population, duration, setting, if stated.' },
            axis_type: { type: 'string', enum: AXIS_TYPES },
          },
          required: ['metric', 'value', 'units', 'axis_type'],
        },
      },
      methods_disclosed: { type: 'boolean' },
      rhetorical_markers: {
        type: 'array', items: { type: 'string' },
        description: 'Superlative or novelty terms used. Recorded for monitoring; never evidence.',
      },
    },
    required: ['quantitative_results', 'methods_disclosed', 'rhetorical_markers'],
  },
}

const PROMPT = `You are extracting quantitative results from a neurotechnology
paper abstract for a factual record layer. Do not evaluate importance. Do not
summarize persuasively. Do not infer, convert, or estimate any value.

Return JSON only. No prose, no code fences.

{
  "quantitative_results": [
    {
      "metric": "what was measured",
      "value": "the number exactly as reported",
      "units": "the units exactly as reported",
      "conditions": "population, duration, and setting, if stated",
      "axis_type": one of ${AXIS_TYPES.map(a => `"${a}"`).join(' | ')}
    }
  ],
  "methods_disclosed": true or false,
  "rhetorical_markers": ["superlative or novelty terms used, if any"]
}

Rules:
- Only values the abstract explicitly reports. If it reports none, return an
  empty array. An empty array is a correct and expected answer.
- units must be the units the abstract states. If a number is reported with no
  units, omit that result entirely.
- axis_type: which axis the value sits on. performance is rate, accuracy, or
  selectivity. longevity is chronic viability or device lifetime. invasiveness
  is surgical burden. scale is channel count, coverage, or cohort size.
  manufacturability is yield or fabrication. cost is price or reimbursement.
  regulatory is approval class or designation. If none fit, omit the result.
- methods_disclosed: are methods described in enough detail for an independent
  group to assess the reported values.
- rhetorical_markers records the promotional language present. It is recorded
  for monitoring only and is never evidence of anything.

Abstract:
---
{abstract}
---`

const shape = o => ({
  quantitative_results: Array.isArray(o.quantitative_results) ? o.quantitative_results : [],
  methods_disclosed: !!o.methods_disclosed,
  rhetorical_markers: Array.isArray(o.rhetorical_markers) ? o.rhetorical_markers : [],
})

/**
 * Parse the model's reply. The call prefills the assistant turn with "{" so the
 * reply is structurally forced to be JSON, but this stays tolerant anyway:
 * asking for "JSON only" still produced a leading "Here is the JSON:" on a
 * meaningful fraction of abstracts, and a silent parse failure would look
 * exactly like an abstract that reported nothing.
 */
export function parseExtraction(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const candidates = [
    raw,
    raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim(),
  ]
  // Last resort: the outermost braces anywhere in the reply.
  const first = raw.indexOf('{'), last = raw.lastIndexOf('}')
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1))

  for (const c of candidates) {
    try { return shape(JSON.parse(c)) } catch { /* try the next shape */ }
  }
  return null
}

/**
 * Keep only results usable as a frontier value: a real number, stated units, and
 * a recognised axis. This is the deterministic gate on the model's output, in
 * the same spirit as the section 8 validators.
 */
export function usableResults(extraction) {
  return (extraction?.quantitative_results || []).filter(r =>
    r && typeof r.metric === 'string' && r.metric.trim().length > 2
    && /\d/.test(String(r.value ?? ''))
    && typeof r.units === 'string' && r.units.trim().length > 0
    && AXIS_TYPES.includes(r.axis_type))
}

/** The value string a promoted record would carry. Units live in the string. */
export const valueString = r =>
  `${String(r.value).trim()} ${r.units.trim()}`.replace(/\s+/g, ' ').trim()

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)

/**
 * One definition of the proposal key, so a re-run updates an entry rather than
 * duplicating it. The subfield is part of the key because the two keyword-pooled
 * subfields can legitimately mine the same paper as its derived subfield does,
 * and those are two candidates rather than one.
 */
export const proposalKey = (itemId, subfield, axisType, metric) =>
  `${itemId}:${subfield}:${axisType}:${slug(metric)}`

/**
 * Rewrite entries stored under an older key scheme. Each proposal carries every
 * field the key derives from, so this is lossless, and it stops a key-format
 * change from silently doubling the file on the next run.
 */
export function normalizeProposalKeys(proposals = {}) {
  const out = {}
  for (const [k, p] of Object.entries(proposals)) {
    if (k.startsWith('_')) { out[k] = p; continue }
    if (!p?.item_id || !p?.subfield || !p?.axis_type) { out[k] = p; continue }
    out[proposalKey(p.item_id, p.subfield, p.axis_type, String(p.axis || '').split(',')[0])] = p
  }
  return out
}

/** Abstracts with no numbers cannot yield a frontier value; skip them early. */
const looksQuantitative = a => /\d/.test(a) && a.length > 300

/**
 * Candidate pools for the two subfields facets cannot express. Without these,
 * mining would leave them permanently empty: no paper derives to them, so they
 * would never receive a proposal and could never reach Phase 2's three records.
 *
 * This does NOT reintroduce keyword classification. Items still get their
 * subfield from facets everywhere in the pipeline. This selects reading material
 * for an extraction pass whose output a human reviews before anything becomes a
 * record, which is a different and much lower-stakes job.
 */
const MANUAL_SUBFIELD_KEYWORDS = {
  FOCUSED_ULTRASOUND: /focused ultrasound|\bhifu\b|\blifu\b|transcranial ultrasound|sonicat|histotripsy|ultrasound neuromodulation|acoustic neuromodulation/i,
  INTERFACE_MATERIALS: /electrode coating|electrode material|\bpedot\b|conducting polymer|encapsulation|foreign body response|glial scar|iridium oxide|parylene|hydrogel electrode|flexible substrate|electrode impedance|biocompatib/i,
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is required for the extraction pass.')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const targets = ONLY ? [ONLY] : SUBFIELD_IDS
  if (ONLY && !SUBFIELD_IDS.includes(ONLY)) {
    console.error(`--subfield ${ONLY} is not in SUBFIELD_IDS.`); process.exit(1)
  }
  console.log(`mining ${targets.length} subfield(s), up to ${LIMIT} paper(s) each, model ${MODEL}.`)
  console.log(`(${MANUAL_ONLY_SUBFIELDS.join(' and ')} draw their candidates by keyword, ` +
    `since no facet combination resolves to them.)`)

  // ── 1. Candidate papers per subfield ──────────────────────────────────────
  // Ordering and the empty-abstract filter are done in JS on purpose. Asking
  // Postgres to sort a multi-thousand-row scan while also testing a large text
  // column for emptiness exceeded the statement timeout; the same work is
  // trivial once the rows are here.
  const papers = []
  for (let from = 0; from < 60000; from += 1000) {
    const { data, error } = await sb.from('papers')
      .select('id,title,abstract,year,doi,url,source_url,journal,facet_function,facet_access,facet_application')
      .eq('in_scope', true).gte('year', 2018).range(from, from + 999)
    if (error) { console.error('read failed:', error.message); process.exit(1) }
    if (!data.length) break
    papers.push(...data)
    if (data.length < 1000) break
  }
  papers.sort((a, b) => (b.year || 0) - (a.year || 0))

  const bySubfield = new Map(targets.map(s => [s, []]))
  for (const p of papers) {
    if (!looksQuantitative(p.abstract || '')) continue
    const s = subfieldFor(p)
    if (s && bySubfield.has(s)) bySubfield.get(s).push(p)
    // The two facet-invisible subfields draw from a keyword pool instead. A
    // paper can land in both this and its derived subfield; the proposal key
    // includes the subfield, so that is two candidates, not a duplicate.
    for (const m of MANUAL_ONLY_SUBFIELDS) {
      if (!bySubfield.has(m)) continue
      const re = MANUAL_SUBFIELD_KEYWORDS[m]
      if (re && (re.test(p.title || '') || re.test(p.abstract || ''))) bySubfield.get(m).push(p)
    }
  }

  // ── 2. Extract ────────────────────────────────────────────────────────────
  const proposals = {}
  const stats = {}
  for (const subfield of targets) {
    const pool = (bySubfield.get(subfield) || []).slice(0, LIMIT)
    stats[subfield] = { papers: pool.length, results: 0, proposals: 0, failed: 0 }
    if (!pool.length) { console.log(`\n${subfield}: no candidate papers.`); continue }
    process.stdout.write(`\n${subfield}: ${pool.length} paper(s) `)

    for (const p of pool) {
      let extraction = null
      try {
        const resp = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 1200,
          tools: [EXTRACTION_TOOL],
          tool_choice: { type: 'tool', name: EXTRACTION_TOOL.name },
          messages: [{ role: 'user', content: PROMPT.replace('{abstract}', p.abstract.slice(0, 6000)) }],
        })
        const block = resp.content?.find(c => c.type === 'tool_use')
        extraction = block ? shape(block.input) : parseExtraction(resp.content?.[0]?.text)
      } catch (err) {
        stats[subfield].failed++
        // Keep the first error per subfield. A silent failure count looks
        // identical to "this abstract reported nothing", which is the one
        // confusion that would quietly hollow out the whole pass.
        stats[subfield].error ||= `${err.status || ''} ${err.message || err}`.trim().slice(0, 200)
        process.stdout.write('!')
        await sleep(500)
        continue
      }
      if (!extraction) { stats[subfield].failed++; process.stdout.write('?'); continue }

      const results = usableResults(extraction)
      stats[subfield].results += results.length
      process.stdout.write(results.length ? String(Math.min(results.length, 9)) : '.')

      for (const r of results) {
        // One proposal per (paper, axis, metric). The key is deterministic so a
        // re-run updates rather than duplicates.
        const key = proposalKey(p.id, subfield, r.axis_type, r.metric)
        proposals[key] = {
          subfield,
          axis: `${r.metric.trim()}${r.conditions ? `, ${String(r.conditions).trim()}` : ''}`.slice(0, 300),
          axis_type: r.axis_type,
          proposed_value: valueString(r),
          item_type: 'papers',
          item_id: p.id,
          // From an abstract alone, methods are rarely disclosed well enough to
          // call this `demonstrated`. Recorded honestly so the reviewer sees the
          // difference rather than inheriting a flattering default.
          evidence_grade: extraction.methods_disclosed ? 'demonstrated' : 'partial',
          rubric_version: RUBRIC_VERSION,
          rationale: `Reported in "${p.title}"${p.year ? ` (${p.year}` : ''}` +
            `${p.journal ? `, ${p.journal}` : ''}${p.year ? ')' : ''}. ` +
            `Extracted from the abstract; conditions as stated: ` +
            `${r.conditions ? String(r.conditions).trim() : 'not stated'}. ` +
            (extraction.rhetorical_markers.length
              ? `Promotional language present and disregarded: ${extraction.rhetorical_markers.slice(0, 6).join(', ')}. `
              : '') +
            `Candidate only; not a record until reviewed.`,
          source_url: p.url || p.source_url || (p.doi ? `https://doi.org/${p.doi}` : null),
          status: 'pending',
        }
        stats[subfield].proposals++
      }
      await sleep(120)
    }
  }
  process.stdout.write('\n')

  // ── 3. Report ─────────────────────────────────────────────────────────────
  console.log('\nsubfield                          papers  results  proposals  failed')
  let totalProposals = 0
  const thin = []
  for (const s of targets) {
    const t = stats[s]
    console.log(`  ${s.padEnd(30)} ${String(t.papers).padStart(6)} ${String(t.results).padStart(8)} ` +
      `${String(t.proposals).padStart(10)} ${String(t.failed).padStart(7)}`)
    totalProposals += t.proposals
    if (t.error) console.log(`      first error: ${t.error}`)
    if (t.proposals < 3) thin.push(s)
  }
  console.log(`\n${totalProposals} proposal(s) across ${targets.length} subfield(s).`)

  const grades = {}
  for (const p of Object.values(proposals)) grades[p.evidence_grade] = (grades[p.evidence_grade] || 0) + 1
  console.log('evidence grade:', Object.entries(grades).map(([k, v]) => `${k} ${v}`).join(', ') || 'none')

  if (thin.length) {
    console.log(`\n${thin.length} subfield(s) with fewer than three proposals; Phase 2 needs three ` +
      `RECORDS each, so these need a wider pool or hand entry:`)
    for (const s of thin) console.log(`  ? ${s}`)
  }

  if (!WRITE) {
    console.log('\nDry run. Nothing written. Re-run with --write.')
    const sample = Object.values(proposals).slice(0, 5)
    if (sample.length) {
      console.log('\nSample:')
      for (const p of sample) {
        console.log(`  [${p.subfield} / ${p.axis_type}] ${p.axis}`)
        console.log(`      ${p.proposed_value}   (${p.evidence_grade})`)
      }
    }
    return
  }

  const path = join(__dirname, 'data/frontier-proposals.json')
  const existing = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  const file = {
    _readme: [
      'Candidate capability-axis frontier records, mined from indexed paper',
      'abstracts by scripts/mine-frontier-proposals.js. NOT records.',
      '',
      'Each entry is a value an abstract actually reports, with a link to the',
      'paper. Nothing here is scored, ranked, or trusted. A human promotes an',
      'entry by moving it into scripts/data/frontier-records.json, giving it a',
      'key, and checking the value against the paper itself.',
      '',
      'Loaded into frontier_record_proposals (status pending) by',
      'scripts/backfill-frontier-records.js once migration 011 has been applied.',
      '',
      'evidence_grade is `partial` for most entries because an abstract rarely',
      'discloses methods well enough to call a value demonstrated. That is',
      'recorded rather than smoothed over.',
    ],
    proposals: normalizeProposalKeys({ ...(existing.proposals || {}), ...proposals }),
  }
  writeFileSync(path, JSON.stringify(file, null, 2) + '\n')
  console.log(`\n✓ wrote ${Object.keys(proposals).length} proposal(s) to scripts/data/frontier-proposals.json`)
  console.log(`  (${Object.keys(file.proposals).length} total in the file.)`)
}

if (process.argv[1] && process.argv[1].endsWith('mine-frontier-proposals.js')) {
  run().catch(e => { console.error(e); process.exit(1) })
}
