/**
 * backfill-frontier-records.js — apply scripts/data/frontier-records.json.
 *
 *   node --env-file=.env scripts/backfill-frontier-records.js            # dry run
 *   node --env-file=.env scripts/backfill-frontier-records.js --commit
 *
 * Requires migration 011.
 *
 * The frontier records are what potential-impact scoring compares items against.
 * A wrong record does not produce a wrong-looking score, it produces a normal-
 * looking score for every item in that subfield, so this script validates hard
 * and refuses the whole run rather than writing a partial set.
 *
 * Nothing here deletes. Superseding a record sets a forward pointer and leaves
 * the old row untouched, because historical scores were computed against it. See
 * the write invariant in CLAUDE.md and docs/funding-data-loss-2026-07-29.md.
 *
 * Identity comes from the JSON key, via a deterministic UUIDv5, the same way
 * company ids are derived. Editing an entry revises the record it already owns;
 * renaming a key creates a second record rather than renaming the first.
 */
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { uuidv5 } from './lib/uuid.js'
import { SUBFIELD_IDS, PARTITION_VERSION } from '../src/lib/subfields.js'
import { INDICATION_IDS, INDICATION_VERSION } from '../src/lib/indications.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const COMMIT = process.argv.includes('--commit')
const PIPELINE = 'frontier-phase1'
const CHANGED_BY = 'backfill-frontier-records.js'

const AXIS_TYPES = ['performance', 'longevity', 'invasiveness', 'scale',
  'regulatory', 'manufacturability', 'cost', 'evidence']
const CONFIDENCE = ['replicated', 'single-group', 'claimed-only']
const ITEM_TYPES = ['papers', 'devices', 'organizations', 'researchers', 'news_feed', 'patents']

// Fields compared between the file and the stored row to decide whether a
// record has been revised. Provenance and version columns are excluded: they are
// written BY a revision, so including them would make every run look changed.
const TRACKED = ['subfield', 'axis', 'axis_type', 'indication', 'current_value',
  'held_by_type', 'held_by_id', 'established_date', 'confidence', 'notes', 'source_url']

/** The record id for a file key. Stable forever; see the header. */
export const recordId = key => uuidv5(`frontier:${key}`)

/**
 * Spec 3.1 requires units inside current_value, because the axes are too
 * heterogeneous (words/minute, months, channels, microns, dollars, n) for a
 * units column to be honest. Heuristic, and deliberately a loose one: a number
 * and at least one word alongside it. It catches the failure that matters, a
 * bare "62" that means nothing six months later without its axis.
 */
const hasUnits = v => {
  const s = String(v)
  if (!/\d/.test(s)) return false
  // Cohort size is the unit on the evidence axis, and it is a single letter.
  if (/\bn\s*=\s*\d/i.test(s)) return true
  return /[a-z]{2,}/i.test(s.replace(/\d+/g, ' '))
}

/** Validate one entry. Returns an array of problem strings, empty when clean. */
export function validateEntry(key, e, allKeys = []) {
  const errs = []
  const need = (cond, msg) => { if (!cond) errs.push(msg) }

  need(/^[a-z0-9][a-z0-9-]*$/.test(key), `key "${key}" must be a lowercase slug`)
  // A capability axis belongs to a subfield. An evidence axis is keyed by
  // indication instead, and may omit one rather than inventing it.
  if (e.subfield == null) {
    need(e.axis_type === 'evidence', 'subfield is required on every axis type except evidence')
  } else {
    need(SUBFIELD_IDS.includes(e.subfield), `subfield "${e.subfield}" is not in SUBFIELD_IDS`)
  }
  need(typeof e.axis === 'string' && e.axis.trim().length > 3, 'axis is missing or too short')
  need(AXIS_TYPES.includes(e.axis_type), `axis_type "${e.axis_type}" is not one of ${AXIS_TYPES.join(', ')}`)
  need(CONFIDENCE.includes(e.confidence), `confidence "${e.confidence}" is not one of ${CONFIDENCE.join(', ')}`)

  need(typeof e.current_value === 'string' && e.current_value.trim().length > 0, 'current_value is missing')
  if (e.current_value) {
    need(hasUnits(e.current_value), `current_value "${e.current_value}" carries no units; spec 3.1 requires them in the string`)
  }

  // An evidence record is per-indication by definition; nothing else is.
  if (e.axis_type === 'evidence') {
    need(!!e.indication, 'axis_type "evidence" requires an indication')
    if (e.indication) {
      need(INDICATION_IDS.includes(e.indication), `indication "${e.indication}" is not in INDICATION_IDS`)
    }
  } else {
    need(!e.indication, `indication is only valid on an evidence record, not on axis_type "${e.axis_type}"`)
  }

  // Every user-facing fact must be traceable. This is the check that enforces it.
  need(/^https?:\/\//.test(e.source_url || ''), 'source_url is missing or is not a link')
  need(/^\d{4}-\d{2}-\d{2}$/.test(e.established_date || ''), 'established_date must be YYYY-MM-DD')

  if (e.held_by) {
    need(ITEM_TYPES.includes(e.held_by.type), `held_by.type "${e.held_by?.type}" is not a known table`)
    need(typeof e.held_by.id === 'string' && e.held_by.id.length > 0, 'held_by.id is missing')
  }
  if (e.supersedes) {
    need(e.supersedes !== key, 'a record cannot supersede itself')
    need(allKeys.includes(e.supersedes), `supersedes "${e.supersedes}" names no entry in this file`)
  }
  return errs
}

/** The row shape written to frontier_records for an entry. */
function rowFor(key, e) {
  return {
    id: recordId(key),
    subfield: e.subfield || null,
    partition_version: e.subfield ? PARTITION_VERSION : null,
    axis: e.axis.trim(),
    axis_type: e.axis_type,
    indication: e.indication || null,
    indication_version: e.indication ? INDICATION_VERSION : null,
    current_value: e.current_value.trim(),
    held_by_type: e.held_by?.type || null,
    held_by_id: e.held_by?.id || null,
    established_date: e.established_date,
    confidence: e.confidence,
    notes: e.notes || null,
    source: e.source || 'manual',
    source_url: e.source_url,
    pipeline_version: PIPELINE,
  }
}

/** Fields that differ between a stored row and the desired row. */
export function diffFields(stored, desired) {
  return TRACKED.filter(f => (stored[f] ?? null) !== (desired[f] ?? null))
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  const file = JSON.parse(readFileSync(join(__dirname, 'data/frontier-records.json'), 'utf8'))
  const entries = Object.entries(file.records || {}).filter(([k]) => !k.startsWith('_'))
  if (!entries.length) {
    console.log('No records in scripts/data/frontier-records.json.')
    console.log('Populating it is Phase 2 (record bootstrap), which is manual domain work.')
    // Proposals are a separate file and can still be loaded.
    if (COMMIT) await loadProposals(sb)
    return
  }
  const allKeys = entries.map(([k]) => k)

  // ── Validate everything before writing anything ───────────────────────────
  const problems = []
  for (const [key, e] of entries) {
    for (const msg of validateEntry(key, e, allKeys)) problems.push(`${key}: ${msg}`)
  }

  // One live record per axis. Not enforceable as a unique index without breaking
  // the supersede sequence; see the note in migration 011.
  const liveByAxis = new Map()
  for (const [key, e] of entries) {
    if (!e.axis) continue
    const supersededInFile = entries.some(([, o]) => o.supersedes === key)
    if (supersededInFile) continue
    const k = `${e.subfield || '-'} ${e.axis.trim()}`
    if (liveByAxis.has(k)) {
      problems.push(`${key}: a second live record on the same axis as "${liveByAxis.get(k)}" (${e.subfield || 'no subfield'} / ${e.axis})`)
    } else liveByAxis.set(k, key)
  }

  if (problems.length) {
    console.error(`${problems.length} problem(s) in scripts/data/frontier-records.json:\n`)
    for (const p of problems) console.error(`  ✗ ${p}`)
    console.error('\nNothing written. A wrong frontier record silently mis-scores every item in its subfield.')
    process.exit(1)
  }

  // ── Read what is already stored ───────────────────────────────────────────
  const ids = allKeys.map(recordId)
  const stored = {}
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from('frontier_records').select('*').in('id', ids.slice(i, i + 200))
    if (error) {
      console.error('read failed:', error.message)
      // PostgREST says "Could not find the table ... in the schema cache" when
      // the migration has not been applied, not "does not exist".
      if (/does not exist|schema cache/i.test(error.message)) {
        console.error('Apply supabase/migrations/011-frontier-records.sql in the Supabase SQL editor first.')
      }
      process.exit(1)
    }
    for (const r of data) stored[r.id] = r
  }

  // ── Plan ──────────────────────────────────────────────────────────────────
  const creates = [], revisions = [], changeRows = [], supersedes = []
  for (const [key, e] of entries) {
    const desired = rowFor(key, e)
    const prev = stored[desired.id]

    if (!prev) {
      creates.push(desired)
      changeRows.push({
        record_id: desired.id, record_version: 1, field: 'created',
        old_value: null, new_value: `${desired.axis} = ${desired.current_value}`,
        reason: e.reason || null, changed_by: CHANGED_BY,
      })
      console.log(`  + ${key} [${desired.subfield} / ${desired.axis_type}] ${desired.current_value}`)
      continue
    }

    const changed = diffFields(prev, desired)
    if (changed.length) {
      const version = (prev.record_version || 1) + 1
      revisions.push({ ...desired, record_version: version, last_updated: new Date().toISOString() })
      for (const f of changed) {
        changeRows.push({
          record_id: desired.id, record_version: version, field: f,
          old_value: prev[f] == null ? null : String(prev[f]),
          new_value: desired[f] == null ? null : String(desired[f]),
          reason: e.reason || null, changed_by: CHANGED_BY,
        })
      }
      console.log(`  ~ ${key} → v${version}: ${changed.join(', ')}`)
    }
  }

  // Supersedes are applied after the superseding rows exist, so the foreign key
  // on superseded_by always resolves.
  for (const [key, e] of entries) {
    if (!e.supersedes) continue
    const oldId = recordId(e.supersedes)
    const newId = recordId(key)
    if (stored[oldId]?.superseded_by === newId) continue
    supersedes.push({ oldId, newId, oldKey: e.supersedes, newKey: key })
    changeRows.push({
      record_id: oldId, record_version: (stored[oldId]?.record_version || 1),
      field: 'superseded', old_value: null, new_value: newId,
      reason: `superseded by ${key}`, changed_by: CHANGED_BY,
    })
    console.log(`  → ${e.supersedes} superseded by ${key}`)
  }

  console.log(`\n${creates.length} new, ${revisions.length} revised, ${supersedes.length} superseded, ` +
    `${entries.length - creates.length - revisions.length} unchanged.`)

  if (!COMMIT) {
    const pending = proposalsInFile()
    if (pending) console.log(`${pending} mined proposal(s) waiting in scripts/data/frontier-proposals.json.`)
    console.log('\nDry run. Nothing written. Re-run with --commit to apply.')
    return
  }

  // ── Write ─────────────────────────────────────────────────────────────────
  const toWrite = [...creates, ...revisions]
  for (let i = 0; i < toWrite.length; i += 100) {
    const { error } = await sb.from('frontier_records').upsert(toWrite.slice(i, i + 100), { onConflict: 'id' })
    if (error) { console.error('upsert failed:', error.message); process.exit(1) }
  }
  for (const s of supersedes) {
    const { error } = await sb.from('frontier_records')
      .update({ superseded_by: s.newId, last_updated: new Date().toISOString() }).eq('id', s.oldId)
    if (error) { console.error(`supersede ${s.oldKey} failed:`, error.message); process.exit(1) }
  }
  for (let i = 0; i < changeRows.length; i += 100) {
    const { error } = await sb.from('frontier_record_changes').insert(changeRows.slice(i, i + 100))
    if (error) { console.error('change log insert failed:', error.message); process.exit(1) }
  }
  console.log(`✓ wrote ${toWrite.length} record(s), ${supersedes.length} supersede(s), ${changeRows.length} change log row(s).`)

  await loadProposals(sb)
}

/**
 * Load the mined candidates in scripts/data/frontier-proposals.json into
 * frontier_record_proposals as PENDING rows.
 *
 * Only ever inserts. A proposal a human has already reviewed keeps its verdict:
 * re-running the miner must not resurrect something that was rejected, which an
 * upsert would do silently.
 */
const PROPOSALS_PATH = () => join(__dirname, 'data/frontier-proposals.json')

/** How many mined proposals are sitting in the file, for the dry-run report. */
export function proposalsInFile() {
  const path = PROPOSALS_PATH()
  if (!existsSync(path)) return 0
  try {
    const file = JSON.parse(readFileSync(path, 'utf8'))
    return Object.keys(file.proposals || {}).filter(k => !k.startsWith('_')).length
  } catch { return 0 }
}

export async function loadProposals(sb) {
  const path = PROPOSALS_PATH()
  if (!existsSync(path)) return
  const file = JSON.parse(readFileSync(path, 'utf8'))
  const entries = Object.entries(file.proposals || {}).filter(([k]) => !k.startsWith('_'))
  if (!entries.length) return

  const rows = []
  const rejected = []
  for (const [key, p] of entries) {
    if (!SUBFIELD_IDS.includes(p.subfield)) { rejected.push(`${key}: subfield "${p.subfield}"`); continue }
    if (!p.proposed_value || !p.axis || !p.axis_type) { rejected.push(`${key}: incomplete`); continue }
    rows.push({
      id: uuidv5(`proposal:${key}`),
      subfield: p.subfield,
      axis: p.axis,
      axis_type: p.axis_type,
      indication: p.indication || null,
      proposed_value: p.proposed_value,
      item_type: p.item_type || null,
      item_id: p.item_id || null,
      source_url: p.source_url || null,
      evidence_grade: p.evidence_grade || null,
      rubric_version: p.rubric_version || null,
      rationale: p.rationale || null,
      status: 'pending',
    })
  }
  if (rejected.length) {
    console.log(`\n${rejected.length} proposal(s) skipped as malformed:`)
    for (const r of rejected.slice(0, 10)) console.log(`  ✗ ${r}`)
  }

  // Anything already in the table keeps whatever verdict it has.
  const known = new Set()
  const ids = rows.map(r => r.id)
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from('frontier_record_proposals')
      .select('id').in('id', ids.slice(i, i + 200))
    if (error) { console.error('proposal read failed:', error.message); return }
    for (const r of data) known.add(r.id)
  }
  const fresh = rows.filter(r => !known.has(r.id))
  if (!fresh.length) {
    console.log(`\n${rows.length} proposal(s) in the file, all already loaded.`)
    return
  }
  for (let i = 0; i < fresh.length; i += 100) {
    const { error } = await sb.from('frontier_record_proposals').insert(fresh.slice(i, i + 100))
    if (error) { console.error('proposal insert failed:', error.message); return }
  }
  console.log(`✓ loaded ${fresh.length} new pending proposal(s) (${known.size} already present).`)
}

// Importable for tests; only runs the pipeline when invoked directly.
if (process.argv[1] && process.argv[1].endsWith('backfill-frontier-records.js')) {
  run().catch(e => { console.error(e); process.exit(1) })
}
