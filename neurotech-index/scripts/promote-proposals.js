/**
 * promote-proposals.js — turn mined proposals into candidate frontier records.
 *
 *   node --env-file=.env scripts/promote-proposals.js                   # dry run
 *   node --env-file=.env scripts/promote-proposals.js --write           # update the JSON
 *   node --env-file=.env scripts/promote-proposals.js --subfield DBS
 *
 * THE PROBLEM THIS SOLVES. The mining pass extracts faithfully but over-broadly.
 * Of 706 proposals, most are properties of a STUDY rather than of the
 * TECHNOLOGY: "mean age, 60 years", "p-value < 0.001", "number of patients, 12",
 * "histology assessment timepoint, 30 days". Every one of those values is really
 * in its abstract. None of them is a frontier. A frontier axis is something the
 * field pushes on; a study parameter is something a study happened to choose.
 *
 * TWO STEPS, AND ONLY ONE IS JUDGEMENT.
 *
 *   1. Grouping (model). Per subfield, sort the proposals into canonical axes
 *      and discard study parameters. This is a named, checkable property, not an
 *      importance ranking: "is this a property of the technology or of the
 *      study" can be argued with by pointing at the axis. Spec section 2 forbids
 *      unanchored importance questions and this is not one.
 *
 *   2. Selection (code). Within an axis, the record is the extreme value in the
 *      stated direction. That is arithmetic, not judgement, and it runs here
 *      rather than in the model so the winner can never be a popularity pick.
 *
 * The output is written to frontier-records.json for review as a diff. It is
 * still a human decision to keep it. Nothing here writes to the database.
 */
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { SUBFIELD_IDS } from '../src/lib/subfields.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WRITE = process.argv.includes('--write')
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d }
const ONLY = argOf('--subfield', null)
const AXES_PER_SUBFIELD = Number(argOf('--axes', 5))
const MODEL = 'claude-sonnet-5'
// Restrict promotion to proposals whose SOURCE paper predates a year. Phase 5's
// 2016 baseline must be built only from pre-2016 evidence: without this the
// winning value on an axis can come from a 2023 paper, which then carries a 2023
// established_date and is filtered straight back out of the baseline.
const SOURCE_YEAR_MAX = argOf('--source-year-max', null) ? Number(argOf('--source-year-max', null)) : null
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── Value parsing ───────────────────────────────────────────────────────────
// Frontier values arrive as "2.20 ± 0.67 kΩ", "550 d", "<3 min", "≥ 75 V/m",
// "8-30 Hz", "2,512 S cm". Comparison needs the leading magnitude and a unit
// that can be normalised. Anything unparseable is reported, never guessed.

/** Time units are the ones that actually collide across a cluster. */
const TIME_TO_DAYS = {
  s: 1 / 86400, sec: 1 / 86400, second: 1 / 86400, seconds: 1 / 86400,
  min: 1 / 1440, minute: 1 / 1440, minutes: 1 / 1440,
  h: 1 / 24, hr: 1 / 24, hour: 1 / 24, hours: 1 / 24,
  d: 1, day: 1, days: 1,
  wk: 7, week: 7, weeks: 7,
  mo: 30.44, month: 30.44, months: 30.44,
  y: 365.25, yr: 365.25, year: 365.25, years: 365.25,
}

export function parseValue(raw) {
  // Normalise ONCE, then do all offset work on the normalised string. Matching
  // on a de-comma'd copy but slicing the original silently mangles the unit of
  // every thousands-separated value ("2,512 S cm" yielded unit "12 s cm").
  const s = String(raw ?? '').replace(/,(?=\d{3}\b)/g, '').trim()
  const m = s.match(/(-?\d+(?:\.\d+)?)/)
  if (!m) return null
  const number = Number(m[1])
  if (!Number.isFinite(number)) return null
  // Strip a ± tolerance so it is never mistaken for the upper end of a range.
  const after = s.slice(m.index + m[1].length).replace(/±\s*\d+(?:\.\d+)?/g, '').trim()
  // "64 to 128 electrodes" and "8-30 Hz" are ranges, not single values. Keep the
  // upper bound: on a higher-is-better axis the record is the top of the range,
  // and taking the first number silently understated every one of them.
  const range = after.match(/^(?:to|[-–—])\s*(-?\d+(?:\.\d+)?)/)
  const high = range ? Number(range[1]) : null
  const unit = (range ? after.slice(range[0].length) : after).trim().toLowerCase() || null
  return { number, high: Number.isFinite(high) ? high : null, unit }
}

/**
 * Canonical (low, high, unit) for comparison, converting time to days.
 * `high` equals `low` unless the value was written as a range.
 */
export function comparable(raw) {
  const p = parseValue(raw)
  if (!p) return null
  const key = (p.unit || '').replace(/[^a-zω°µμ%/ ]/gi, '').trim()
  const firstWord = key.split(/[\s/]/)[0]
  const hi = p.high ?? p.number
  if (TIME_TO_DAYS[firstWord] !== undefined) {
    const f = TIME_TO_DAYS[firstWord]
    return { number: p.number * f, high: hi * f, unit: 'days', original: p.unit }
  }
  return { number: p.number, high: hi, unit: key || null, original: p.unit }
}

/**
 * The record on an axis: the extreme value in the stated direction, among
 * members whose units agree after normalisation. Members whose units cannot be
 * reconciled are returned as `unreconciled` rather than silently dropped or
 * silently compared.
 */
export function pickRecord(members, direction) {
  const parsed = members.map(m => ({ m, c: comparable(m.proposed_value) })).filter(x => x.c)
  if (!parsed.length) return { winner: null, unreconciled: members, unitGroups: 0 }
  const groups = new Map()
  for (const x of parsed) {
    const k = x.c.unit || '(none)'
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(x)
  }
  // The largest unit group wins the axis; the rest are flagged, not compared.
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
  const [, main] = sorted[0]
  // Compare the end of the range that the axis direction actually cares about.
  const at = x => (direction === 'lower' ? x.c.number : x.c.high)
  const best = main.reduce((a, b) =>
    (direction === 'lower' ? at(b) < at(a) : at(b) > at(a)) ? b : a)
  return {
    winner: best.m,
    unreconciled: sorted.slice(1).flatMap(([, g]) => g.map(x => x.m)),
    unitGroups: sorted.length,
    considered: main.length,
  }
}

// ── Deterministic rejection ─────────────────────────────────────────────────
// The grouping step is model-assisted and it lets things through. These checks
// are code, for the same reason the section 8 validators are code: they are the
// check ON the model. Each one exists because it caught a real bad record in the
// first promotion run, and each rejects rather than repairs.

/** Axis names that describe a study outcome or a review, never a frontier. */
const NOT_A_FRONTIER_AXIS = [
  /adverse event/i, /wound complication/i, /serious adverse/i,
  /number of studies/i, /studies (reviewed|included)/i,
  /satisfaction/i, /willingness/i, /quality of life/i,
  /follow-?up duration/i, /monitoring duration per patient/i,
  /normali[sz]ation time/i, /operative time/i,
]

/**
 * A record value must be ONE measurement. Comparisons, enumerations and
 * anatomical labels are not values, and reducing them to their first number is
 * how "S1-S3 root levels" became a cohort size of 1 and
 * "20.94 [9.09] vs 24.72 [10.28]" became 20.94.
 */
export function looksLikeRecordValue(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return false
  if (/\bvs\.?\b|\bversus\b/i.test(s)) return false          // a comparison, not a value
  if (/\[.*\]/.test(s)) return false                          // bracketed dispersion pairs
  if (/\bunitless\b/i.test(s)) return false                   // no unit by its own admission
  if (/^[A-Za-z]+\d/.test(s)) return false                    // "S1-S3", anatomical labels
  const p = parseValue(s)
  if (!p) return false
  if (!p.unit) return false                                   // a bare number is not a record
  // The number must lead. "up to 1.0 ..." and "exceeding 0.95 ..." are hedges,
  // not measurements, and they read as records once the hedge is dropped.
  if (/^(up to|exceeding|approx|around|about|roughly)\b/i.test(s)) return false
  return true
}

/** True when a candidate axis should never become a record. */
export function rejectAxis(axisName) {
  return NOT_A_FRONTIER_AXIS.some(re => re.test(String(axisName || '')))
}

// ── Grouping (the model step) ───────────────────────────────────────────────

export const GROUPING_TOOL = {
  name: 'group_into_frontier_axes',
  description: 'Sort candidate measurements into frontier axes, discarding study parameters.',
  input_schema: {
    type: 'object',
    properties: {
      axes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            axis: { type: 'string', description: 'Canonical axis name, including the conditions that make values comparable.' },
            axis_type: {
              type: 'string',
              enum: ['performance', 'longevity', 'invasiveness', 'scale', 'regulatory', 'manufacturability', 'cost'],
            },
            direction: {
              type: 'string', enum: ['higher', 'lower'],
              description: 'Which direction is a better result on this axis.',
            },
            member_ids: {
              type: 'array', items: { type: 'integer' },
              description: 'Ids of the candidates that measure this same axis.',
            },
          },
          required: ['axis', 'axis_type', 'direction', 'member_ids'],
        },
      },
      discarded_ids: {
        type: 'array', items: { type: 'integer' },
        description: 'Ids that are study parameters rather than frontier axes.',
      },
    },
    required: ['axes', 'discarded_ids'],
  },
}

export const GROUPING_PROMPT = `You are organising candidate measurements from
neurotechnology papers into FRONTIER AXES for a technical record layer.

A FRONTIER AXIS is a property of the technology or the capability that the field
pushes on over time. Examples: channel count, chronic recording lifetime,
electrode impedance, array thickness, decoding rate, spatial resolution,
fabrication yield, coating time, largest cohort a capability has been
demonstrated in.

A STUDY PARAMETER is a property of one particular study. Discard these.
Examples: participant demographics such as mean age or disease duration, the
number of subjects in this one experiment when the point is not scale, the
timepoints at which assessments happened, statistical outputs such as p-values
and confidence intervals, effect sizes for one task, reagent concentrations, the
number of studies in a review.

Rules:
- Do NOT judge importance, novelty, or quality. Sort by what the measurement IS.
- Group candidates that measure THE SAME THING under one axis, even when they
  are worded differently. Values on one axis must be genuinely comparable: do
  not group two accuracies from different tasks.
- The axis name must carry the conditions that make its values comparable, for
  example "chronic recording lifetime, in vivo, rodent".
- direction says which way is better. Impedance, thickness, and cost are lower.
  Channel count, lifetime, and accuracy are higher.
- Discard anything you are unsure about. A missing axis is cheap; a wrong one
  silently mis-scores every item in this subfield.
- Return at most ${AXES_PER_SUBFIELD} axes, the ones with the most solid and
  comparable candidates. Prefer an axis with several comparable members.
- SPREAD ACROSS AXIS TYPES. A subfield described by five performance axes is
  much less useful than one described by performance, longevity, scale and
  invasiveness, because an absence on a type we never cover carries no
  information at all. Whenever the candidates support a longevity,
  invasiveness, manufacturability or cost axis, include it, even if its
  candidates are fewer than yet another performance axis would have.

Subfield: {subfield}

Candidates:
{candidates}`

/** 529 overloaded and 429 are transient; a whole subfield should not be lost to one. */
async function withRetry(fn, label, attempts = 4) {
  let last
  for (let i = 0; i < attempts; i++) {
    try { return await fn() } catch (err) {
      last = err
      const transient = [429, 500, 502, 503, 529].includes(err.status)
      if (!transient || i === attempts - 1) throw err
      const wait = 1500 * 2 ** i
      process.stdout.write(`(${err.status} on ${label}, retrying in ${wait}ms) `)
      await sleep(wait)
    }
  }
  throw last
}

async function groupSubfield(anthropic, subfield, proposals) {
  const listing = proposals.map((p, i) =>
    `${i}. [${p.axis_type}] ${p.axis} = ${p.proposed_value}`).join('\n')
  const resp = await withRetry(() => anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    tools: [GROUPING_TOOL],
    tool_choice: { type: 'tool', name: GROUPING_TOOL.name },
    messages: [{
      role: 'user',
      content: GROUPING_PROMPT.replace('{subfield}', subfield).replace('{candidates}', listing),
    }],
  }), subfield)
  const block = resp.content?.find(c => c.type === 'tool_use')
  if (!block) return null
  // A tool call truncated by max_tokens arrives with a partial or wrongly typed
  // input. Reject it loudly: treated as data it produced 770 "axes" from 35
  // candidates, because `.length` was being read off a string.
  if (resp.stop_reason === 'max_tokens') {
    throw new Error(`grouping hit max_tokens for ${subfield}; raise max_tokens or lower --axes`)
  }
  const inp = block.input || {}
  const axes = coerceArray(inp.axes)
  if (!axes) throw new Error(`grouping returned axes as ${typeof inp.axes}, expected an array`)
  return { axes, discarded_ids: coerceArray(inp.discarded_ids) || [] }
}

/**
 * Pull the first balanced JSON array out of a string, respecting quoting and
 * escapes. Needed because the model sometimes serialises the REMAINDER OF THE
 * WHOLE OBJECT into one array field, producing
 *     [ {...}, {...} ], "discarded_ids": [0,1,2] }
 * which is not parseable as-is. The leading array is still perfectly good.
 */
export function firstJsonArray(s) {
  const start = s.indexOf('[')
  if (start < 0) return null
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)) } catch { return null }
      }
    }
  }
  return null
}

/**
 * Tool inputs sometimes arrive with an array field JSON-encoded as a string
 * under a nested schema. Reading `.length` off that string is how a 35-candidate
 * subfield reported 770 axes, so coerce explicitly rather than duck-type.
 */
export function coerceArray(v) {
  if (Array.isArray(v)) return v
  if (typeof v !== 'string') return null
  try { const p = JSON.parse(v); if (Array.isArray(p)) return p } catch { /* fall through */ }
  const salvaged = firstJsonArray(v)
  return Array.isArray(salvaged) ? salvaged : null
}

// ── Run ─────────────────────────────────────────────────────────────────────

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.ANTHROPIC_API_KEY) {
    console.error('SUPABASE_URL, SUPABASE_SERVICE_KEY and ANTHROPIC_API_KEY are required.')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // PAGINATED. PostgREST caps an unpaginated select at 1000 rows, so the first
  // retro run silently saw 1000 of 1242 proposals and four subfields reported
  // zero candidates because theirs sat past the cutoff.
  const pending = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('frontier_record_proposals')
      .select('id,subfield,axis,axis_type,proposed_value,item_type,item_id,evidence_grade,rationale,source_url')
      .eq('status', 'pending').range(from, from + 999)
    if (error) { console.error('read failed:', error.message); process.exit(1) }
    if (!data.length) break
    pending.push(...data)
    if (data.length < 1000) break
  }
  console.log(`${pending.length} pending proposal(s).`)

  const targets = (ONLY ? [ONLY] : SUBFIELD_IDS).filter(s => pending.some(p => p.subfield === s))
  if (ONLY && !SUBFIELD_IDS.includes(ONLY)) { console.error(`--subfield ${ONLY} unknown.`); process.exit(1) }

  // Publication years for the items the proposals point at. papers stores only a
  // year, so established_date can only ever be year-accurate; that is recorded
  // in the note rather than dressed up as a precise date.
  const paperIds = [...new Set(pending.filter(p => p.item_type === 'papers').map(p => p.item_id))]
  const yearById = {}
  for (let i = 0; i < paperIds.length; i += 200) {
    const { data } = await sb.from('papers').select('id,year').in('id', paperIds.slice(i, i + 200))
    for (const r of data || []) yearById[r.id] = r.year
  }

  if (SOURCE_YEAR_MAX) {
    const before = pending.length
    for (let i = pending.length - 1; i >= 0; i--) {
      const y = yearById[pending[i].item_id]
      if (!y || y > SOURCE_YEAR_MAX) pending.splice(i, 1)
    }
    console.log(`restricted to sources from ${SOURCE_YEAR_MAX} or earlier: ${pending.length} of ${before} proposal(s)`)
  }

  const records = {}
  const summary = []
  for (const subfield of targets) {
    const mine = pending.filter(p => p.subfield === subfield)
    process.stdout.write(`\n${subfield}: ${mine.length} candidate(s) ... `)
    let grouped = null
    try { grouped = await groupSubfield(anthropic, subfield, mine) }
    catch (err) { console.log(`grouping failed: ${err.message}`); continue }
    if (!grouped?.axes?.length) { console.log('no axes returned'); continue }

    let kept = 0
    const rejected = []
    const used = new Set()
    for (const ax of grouped.axes) {
      const members = coerceArray(ax.member_ids) || []
      for (const i of members) used.add(i)
    }
    for (const ax of grouped.axes) {
      const members = (coerceArray(ax.member_ids) || []).map(i => mine[i]).filter(Boolean)
      if (!members.length) continue
      if (rejectAxis(ax.axis)) { rejected.push(`${ax.axis} (axis is a study outcome)`); continue }
      // Reject unusable values BEFORE picking, so a comparison string cannot win
      // an axis just by parsing to a large first number.
      const usable = members.filter(m => looksLikeRecordValue(m.proposed_value))
      if (!usable.length) { rejected.push(`${ax.axis} (no member had a single usable value)`); continue }
      const { winner, unreconciled, considered } = pickRecord(usable, ax.direction)
      if (!winner) continue
      const year = yearById[winner.item_id]
      const key = `${subfield.toLowerCase().replace(/_/g, '-')}-${ax.axis_type}-` +
        `${ax.axis.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`.replace(/-+$/, '')
      records[key] = {
        subfield,
        axis: ax.axis,
        axis_type: ax.axis_type,
        current_value: winner.proposed_value,
        held_by: { type: winner.item_type, id: winner.item_id },
        established_date: year ? `${year}-01-01` : null,
        confidence: winner.evidence_grade === 'demonstrated' ? 'single-group' : 'claimed-only',
        source: 'derived',
        source_url: winner.source_url,
        notes: `Promoted from a mined proposal. Best of ${considered} comparable ` +
          `candidate(s) on this axis, ${ax.direction} is better. ` +
          (unreconciled.length ? `${unreconciled.length} candidate(s) had units that could not be reconciled and were excluded. ` : '') +
          `Grouping was model-assisted; the winning value was selected arithmetically. ` +
          (year ? `established_date is the source paper's publication YEAR (${year}); ` +
            `only the year is indexed, so the month and day are not meaningful. ` : '') +
          `${winner.rationale || ''}`.trim(),
        _proposal_id: winner.id,
      }
      kept++
    }
    // Derived, not taken from the model's discarded_ids: that field is lost
    // whenever the whole object gets serialized into `axes`, and reporting 0
    // discarded out of 60 candidates read as though nothing had been filtered.
    const dropped = mine.length - used.size
    summary.push([subfield, mine.length, grouped.axes.length, dropped, kept])
    console.log(`${grouped.axes.length} axis/axes, ${dropped} not used, ${kept} record(s)` +
      (rejected.length ? `, ${rejected.length} axis/axes rejected` : ''))
    for (const r of rejected) console.log(`      rejected: ${r}`)
    await sleep(200)
  }

  console.log('\nsubfield                          cands  axes  discarded  records')
  for (const [s, c, a, d, k] of summary) {
    console.log(`  ${s.padEnd(30)} ${String(c).padStart(5)} ${String(a).padStart(5)} ` +
      `${String(d).padStart(10)} ${String(k).padStart(8)}`)
  }
  const total = Object.keys(records).length
  const perSf = {}
  for (const r of Object.values(records)) perSf[r.subfield] = (perSf[r.subfield] || 0) + 1
  const short = SUBFIELD_IDS.filter(s => (perSf[s] || 0) < 3)
  console.log(`\n${total} candidate record(s) across ${Object.keys(perSf).length} subfield(s).`)
  console.log(short.length
    ? `${short.length} subfield(s) still under three records: ${short.join(', ')}`
    : 'Every subfield has at least three. Phase 2 records criterion would be met.')

  if (!WRITE) {
    console.log('\nDry run. Nothing written. Re-run with --write.')
    for (const [k, r] of Object.entries(records).slice(0, 6)) {
      console.log(`\n  ${k}\n    ${r.axis}\n    ${r.current_value}\n    ${r.source_url}`)
    }
    return
  }
  const path = join(__dirname, 'data/frontier-records.json')
  const file = JSON.parse(readFileSync(path, 'utf8'))
  file.records = { ...file.records, ...records }
  writeFileSync(path, JSON.stringify(file, null, 2) + '\n')
  console.log(`\n✓ wrote ${total} candidate record(s) into scripts/data/frontier-records.json`)
  console.log('  Each still needs established_date before the backfill will accept it.')
  console.log('  Review the diff: these are candidates, not decisions.')
}

if (process.argv[1] && process.argv[1].endsWith('promote-proposals.js')) {
  run().catch(e => { console.error(e); process.exit(1) })
}
