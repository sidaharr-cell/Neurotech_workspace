/**
 * backfill-graph.js — derive the entity-graph edges that are safely inferable
 * from data already in the database, and materialize regulatory records from
 * openFDA-sourced device rows. One-time / re-runnable (idempotent upserts).
 *   node --env-file=.env scripts/backfill-graph.js
 *
 * Requires migration 003-entity-graph.sql to have been applied first.
 *
 * What it derives (and, deliberately, what it does NOT):
 *   device  made_by      organization   — from devices.manufacturer, EXACT
 *                                          normalized-name match to an org row.
 *   trial   sponsored_by organization   — from the trial's metadata.sponsor,
 *                                          EXACT normalized-name match.
 *   device  cleared_via  regulatory_rec — one regulatory_record per FDA device,
 *                                          built from the row's own fields.
 *
 * It does NOT guess the harder edges (paper->device evaluates, trial->device
 * studies, paper->paper cites/replicates/contradicts, paper->person authored_by,
 * person->org affiliated_with). Those need signals we do not have confidently
 * yet, and a wrong edge is worse than a missing one. They are left empty; the
 * schema is ready for them when a reliable source exists.
 *
 * Matching is EXACT on a normalized name only. No fuzzy "contains" matching:
 * "Neuro" must not attach to "Neuralink". Ambiguous names (the same normalized
 * form on more than one org) are skipped rather than guessed.
 */
import { createClient } from '@supabase/supabase-js'

const PIPELINE_VERSION = 'phase1-graph'
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// ── Name normalization ──────────────────────────────────────────────────────
// Lowercase, drop legal suffixes and punctuation, collapse whitespace. Two names
// that normalize to the same string are treated as the same organization.
const LEGAL = /\b(inc|incorporated|corp|corporation|co|company|llc|l\.?l\.?c|ltd|limited|plc|gmbh|s\.?a|s\.?p\.?a|ag|nv|bv|holdings?|group|the)\b/g
function normOrg(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(LEGAL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Load every row of a table, paginated ────────────────────────────────────
async function loadAll(table, columns, filter) {
  const out = []
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(columns).order('id').range(from, from + 999)
    if (filter) q = filter(q)
    const { data, error } = await q
    if (error) { console.warn(`  ${table} read error:`, error.message); break }
    if (!data?.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

// ── Batched upsert helper ───────────────────────────────────────────────────
async function upsertAll(table, rows, onConflict) {
  let ok = 0
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict, ignoreDuplicates: false })
    if (error) console.warn(`  ${table} upsert error:`, error.message)
    else ok += Math.min(500, rows.length - i)
  }
  return ok
}

const edge = (subject_type, subject_id, predicate, object_type, object_id, { confidence = 1, note = null, source = 'derived' } = {}) =>
  ({ subject_type, subject_id, predicate, object_type, object_id, confidence, note, source, pipeline_version: PIPELINE_VERSION })

// ── FDA pathway + number parsing (from a device row's own fields) ────────────
function pathwayOf(status) {
  const s = (status || '').toLowerCase()
  if (s.includes('510')) return '510(k)'
  if (s.includes('pma')) return 'PMA'
  if (s.includes('de novo') || s.includes('den')) return 'De Novo'
  if (s.includes('hde')) return 'HDE'
  return null
}
function fdaNumber(device) {
  // Prefer the number embedded in the accessdata URL, then the description text.
  const url = device.url || ''
  const fromUrl = url.match(/[?&]ID=([A-Z]?\d+)/i)?.[1] || url.match(/[?&]id=([A-Z]?\d+)/i)?.[1]
  if (fromUrl) return fromUrl
  const d = device.description || ''
  return d.match(/510\(k\)\s*([A-Z]?\d{5,})/i)?.[1] || d.match(/PMA\s*([A-Z]?\d{5,})/i)?.[1] || null
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY (run with --env-file=.env).')
    process.exit(1)
  }

  // ── Organization name index ───────────────────────────────────────────────
  console.log('Loading organizations...')
  const orgs = await loadAll('organizations', 'id,name,type')
  const orgByName = new Map()   // normName -> {id, type} | 'AMBIGUOUS'
  for (const o of orgs) {
    const k = normOrg(o.name)
    if (!k) continue
    const cur = orgByName.get(k)
    if (!cur) { orgByName.set(k, { id: o.id, type: o.type }); continue }
    if (cur === 'AMBIGUOUS') continue
    // Same normalized name on two orgs: prefer a company; if both same tier, ambiguous.
    if (cur.type !== o.type) {
      orgByName.set(k, cur.type === 'company' ? cur : { id: o.id, type: o.type })
    } else {
      orgByName.set(k, 'AMBIGUOUS')
    }
  }
  const matchOrg = name => {
    const hit = orgByName.get(normOrg(name))
    return hit && hit !== 'AMBIGUOUS' ? hit.id : null
  }
  console.log(`  ${orgs.length} orgs, ${orgByName.size} distinct normalized names`)

  const edges = []

  // ── Devices: made_by organization + cleared_via regulatory_record ─────────
  console.log('Loading devices...')
  const devices = await loadAll('devices', 'id,name,manufacturer,year,status,url,description,source')
  const regRows = []
  let madeBy = 0, regCount = 0
  for (const d of devices) {
    const orgId = matchOrg(d.manufacturer)
    if (orgId) {
      edges.push(edge('devices', d.id, 'made_by', 'organizations', orgId, {
        confidence: 0.9, note: `manufacturer "${d.manufacturer}" matched org by normalized name`,
      }))
      madeBy++
    }
    const pathway = pathwayOf(d.status)
    if (pathway) {
      const number = fdaNumber(d)
      regRows.push({
        device_id: d.id, pathway, decision_date: d.year || null, number,
        source: 'openfda', source_url: d.url || null, pipeline_version: PIPELINE_VERSION,
      })
      regCount++
    }
  }
  console.log(`  ${devices.length} devices -> ${madeBy} made_by edges, ${regCount} regulatory records`)

  // Insert regulatory records first so we can link devices to them.
  if (regRows.length) {
    // number can be null; the unique index is (device_id, number) so at most one
    // null-numbered record per device, which is what we want.
    await upsertAll('regulatory_records', regRows, 'device_id,number')
  }
  // Read them back to get their ids for the cleared_via edges.
  const regs = await loadAll('regulatory_records', 'id,device_id,number')
  let clearedVia = 0
  for (const r of regs) {
    edges.push(edge('devices', r.device_id, 'cleared_via', 'regulatory_records', r.id, {
      confidence: 1, source: 'openfda', note: r.number ? `FDA ${r.number}` : 'FDA record',
    }))
    clearedVia++
  }
  console.log(`  ${clearedVia} cleared_via edges`)

  // ── Trials (in news_feed): sponsored_by organization ──────────────────────
  console.log('Loading trials...')
  const trials = await loadAll('news_feed', 'id,metadata', q => q.eq('entry_type', 'trial'))
  let sponsoredBy = 0
  for (const t of trials) {
    const sponsor = t.metadata?.sponsor
    const orgId = matchOrg(sponsor)
    if (orgId) {
      edges.push(edge('news_feed', t.id, 'sponsored_by', 'organizations', orgId, {
        confidence: 0.9, note: `sponsor "${sponsor}" matched org by normalized name`,
      }))
      sponsoredBy++
    }
  }
  console.log(`  ${trials.length} trials -> ${sponsoredBy} sponsored_by edges`)

  // ── Write the edges ───────────────────────────────────────────────────────
  console.log(`Upserting ${edges.length} relationship edges...`)
  const wrote = await upsertAll('relationships', edges, 'subject_type,subject_id,predicate,object_type,object_id')
  console.log(`Done. ${wrote} edges written.`)
  console.log(`  made_by=${madeBy} cleared_via=${clearedVia} sponsored_by=${sponsoredBy}`)
}

main().catch(err => { console.error(err); process.exit(1) })
