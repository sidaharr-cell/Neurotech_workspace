/**
 * backfill-patents.js — comprehensive neurotech patent index from the USPTO
 * PatentsView Search API, defined by CPC classification (mutually exclusive,
 * exhaustive by class). Requires a free API key (https://patentsview.org/apis).
 *
 *   PATENTSVIEW_API_KEY must be set (in .env and as a GitHub Actions secret).
 *   node --env-file=.env scripts/backfill-patents.js [maxPerClass]
 *
 * Deduplicates by patent number, derives device-class tags, upserts into the
 * `patents` table. Runs the same way in the daily cron (recent grants only).
 */
import { createClient } from '@supabase/supabase-js'
import { DEVICE_CLASSES } from '../src/lib/taxonomy.js'

const API = 'https://search.patentsview.org/api/v1/patent/'
const KEY = process.env.PATENTSVIEW_API_KEY
const sleep = ms => new Promise(r => setTimeout(r, ms))

// Neurotechnology CPC subgroups — the classification-based definition of the
// field. Each is matched as a prefix, so deeper subgroups are included too.
export const NEUROTECH_CPC = [
  'A61N1/05',   // electrodes for implantation (neural electrodes)
  'A61N1/36',   // electrical stimulation of nerves/brain (DBS, VNS, SCS, cochlear)
  'A61N1/372',  // implantable neurostimulator control/telemetry
  'A61N1/375',  // implantable stimulator construction
  'A61N1/378',  // implantable stimulator power supply
  'A61N2/00',   // magnetotherapy (transcranial magnetic stimulation)
  'A61B5/369',  // electroencephalography (EEG)
  'A61B5/372',  // magnetoencephalography (MEG)
  'A61B5/377',  // evoked potentials
  'A61B5/378',  // event-related potentials
  'A61B5/388',  // electromyography for neural control
  'A61B5/389',  // electromyography detail
  'A61B5/291',  // EEG electrode arrangements
  'A61B5/293',  // EEG signal detection detail
  'G06F3/015',  // input using bio-electric signals (brain-computer interface)
  'A61F2/72',   // bioelectrically controlled prostheses (neuroprosthetics)
]

const deriveTags = text => {
  const h = (text || '').toLowerCase()
  return DEVICE_CLASSES.filter(c => c.match.some(m => h.includes(m))).map(c => c.id)
}

const FIELDS = [
  'patent_id', 'patent_title', 'patent_abstract', 'patent_date',
  'assignees.assignee_organization', 'cpc_current.cpc_subgroup_id',
]

async function fetchJson(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { headers: { 'X-Api-Key': KEY, 'Accept': 'application/json' } })
      if (res.status === 429) { await sleep(3000 * (i + 1)); continue }
      if (!res.ok) { console.warn(`  PatentsView ${res.status}`); return null }
      return await res.json()
    } catch (e) { await sleep(1500); }
  }
  return null
}

/** Page through all patents whose CPC subgroup begins with `cpc`. */
async function fetchClass(cpc, maxPer, sinceDate) {
  const out = []
  let after = null
  for (;;) {
    const q = { _and: [{ _begins: { 'cpc_current.cpc_subgroup_id': cpc } } ] }
    if (sinceDate) q._and.push({ _gte: { patent_date: sinceDate } })
    const o = { size: 1000 }
    if (after) o.after = after
    const params = new URLSearchParams({
      q: JSON.stringify(q._and.length === 1 ? { _begins: { 'cpc_current.cpc_subgroup_id': cpc } } : q),
      f: JSON.stringify(FIELDS),
      s: JSON.stringify([{ patent_id: 'asc' }]),
      o: JSON.stringify(o),
    })
    const data = await fetchJson(`${API}?${params}`)
    const rows = data?.patents || []
    if (!rows.length) break
    out.push(...rows)
    after = rows[rows.length - 1].patent_id
    process.stdout.write(`\r  ${cpc}: ${out.length}`)
    if (rows.length < 1000 || out.length >= maxPer) break
    await sleep(400)
  }
  console.log('')
  return out
}

function toRow(p) {
  const num = p.patent_id
  const assignee = p.assignees?.[0]?.assignee_organization || null
  const cpc = (p.cpc_current || []).map(c => c.cpc_subgroup_id).filter(Boolean)
  return {
    patent_number: num,
    title: p.patent_title || '(untitled)',
    abstract: p.patent_abstract || null,
    assignee,
    grant_date: p.patent_date || null,
    cpc_codes: [...new Set(cpc)],
    tags: deriveTags(`${p.patent_title} ${p.patent_abstract}`),
    url: `https://patents.google.com/patent/${num}`,
    source: 'patentsview',
  }
}

async function main() {
  if (!KEY) { console.error('PATENTSVIEW_API_KEY must be set.'); process.exit(1) }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const maxPer = process.argv[2] ? Number(process.argv[2]) : Infinity
  // In the daily cron, only pull recent grants; a full backfill pulls everything.
  const sinceDate = process.env.PATENTS_SINCE || null

  const seen = new Set()
  const rows = []
  for (const cpc of NEUROTECH_CPC) {
    const patents = await fetchClass(cpc, maxPer, sinceDate)
    for (const p of patents) {
      if (!p.patent_id || seen.has(p.patent_id)) continue
      seen.add(p.patent_id)
      rows.push(toRow(p))
    }
    console.log(`  ${cpc} → running unique total: ${rows.length}`)
  }

  console.log(`Upserting ${rows.length} unique neurotech patents...`)
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('patents').upsert(rows.slice(i, i + 500), { onConflict: 'patent_number', ignoreDuplicates: false })
    if (error && !error.message.includes('duplicate')) console.warn('patent upsert error:', error.message)
  }
  console.log(`✓ Patents backfill complete — ${rows.length} patents.`)
}

import { realpathSync } from 'fs'
import { fileURLToPath } from 'url'
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main().catch(e => { console.error(e); process.exit(1) })
}
