/**
 * backfill-derive-edges.js — derive the remaining safely-inferable Phase 1 edges.
 * Requires migration 003. Idempotent (upsert on the edge unique index).
 *   node --env-file=.env scripts/backfill-derive-edges.js
 *
 * Conservative by design (a wrong edge is worse than a missing one):
 *   affiliated_with  researcher -> org   : EXACT normalized affiliation == org name.
 *   studies          trial -> device     : EXACT normalized intervention == device name.
 *
 * NOT derived here:
 *   evaluates (paper -> device): attempted via device-name-as-title-phrase, but
 *     openFDA device "names" include generic descriptors ("Carbon Electrode",
 *     "Ring Electrode") that match many unrelated papers, producing false edges.
 *     A safe version needs a curated list of DISTINCTIVE branded device names,
 *     not raw openFDA names, so it is left empty rather than shipped wrong.
 *   authored_by / replicates / contradicts: no safe source (author name-matching
 *     risks false attributions; replication/contradiction needs claim analysis).
 */
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const edge = (st, si, p, ot, oi, note) => ({ subject_type: st, subject_id: si, predicate: p,
  object_type: ot, object_id: oi, confidence: 0.85, source: 'derived', pipeline_version: 'derive-edges', note })

async function loadAll(table, cols, filter) {
  const out = []; let last = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    let q = sb.from(table).select(cols).gt('id', last).order('id').limit(1000)
    if (filter) q = filter(q)
    const { data, error } = await q
    if (error) { console.warn(`${table} read:`, error.message); break }
    if (!data?.length) break
    out.push(...data); last = data[data.length - 1].id
    if (data.length < 1000) break
  }
  return out
}
async function writeEdges(edges) {
  let ok = 0
  for (let i = 0; i < edges.length; i += 500) {
    const { error } = await sb.from('relationships').upsert(edges.slice(i, i + 500),
      { onConflict: 'subject_type,subject_id,predicate,object_type,object_id', ignoreDuplicates: true })
    if (error) { console.warn('edge insert:', error.message); break }
    ok += Math.min(500, edges.length - i)
  }
  return ok
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY (run with --env-file=.env).'); process.exit(1)
  }

  // Device name indexes.
  console.log('Loading devices and organizations...')
  const devices = await loadAll('devices', 'id,name')
  const exactDevice = new Map()          // normName -> id | 'AMBIGUOUS'
  for (const d of devices) {
    const k = norm(d.name); if (!k) continue
    const cur = exactDevice.get(k)
    exactDevice.set(k, cur && cur !== d.id ? 'AMBIGUOUS' : d.id)
  }
  const matchDevice = name => { const h = exactDevice.get(norm(name)); return h && h !== 'AMBIGUOUS' ? h : null }

  const orgs = await loadAll('organizations', 'id,name,type')
  const orgByName = new Map()
  for (const o of orgs) { const k = norm(o.name); if (!k) continue; const cur = orgByName.get(k); orgByName.set(k, cur && cur !== o.id ? 'AMBIGUOUS' : o.id) }
  const matchOrg = name => { const h = orgByName.get(norm(name)); return h && h !== 'AMBIGUOUS' ? h : null }

  const edges = []

  // ── affiliated_with: researcher -> org ────────────────────────────────────
  const researchers = await loadAll('researchers', 'id,name,affiliation')
  let aff = 0
  for (const r of researchers) {
    const orgId = matchOrg(r.affiliation)
    if (orgId) { edges.push(edge('researchers', r.id, 'affiliated_with', 'organizations', orgId, `affiliation "${r.affiliation}"`)); aff++ }
  }
  console.log(`affiliated_with: ${aff} (of ${researchers.length} researchers)`)

  // ── studies: trial -> device (exact intervention == device name) ──────────
  const trials = await loadAll('news_feed', 'id,metadata', q => q.eq('entry_type', 'trial'))
  let stud = 0
  for (const t of trials) {
    const seen = new Set()
    for (const iv of t.metadata?.interventions || []) {
      const devId = matchDevice(iv)
      if (devId && !seen.has(devId)) { edges.push(edge('news_feed', t.id, 'studies', 'devices', devId, `intervention "${iv}"`)); seen.add(devId); stud++ }
    }
  }
  console.log(`studies: ${stud} (of ${trials.length} trials)`)

  console.log(`Upserting ${edges.length} edges...`)
  const wrote = await writeEdges(edges)
  console.log(`Done. ${wrote} edges written (affiliated_with=${aff} studies=${stud}).`)
}

main().catch(err => { console.error(err); process.exit(1) })
