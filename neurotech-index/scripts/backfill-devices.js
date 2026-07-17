/**
 * backfill-devices.js — ingest FDA-cleared/approved neuro devices from openFDA
 * (510(k) + PMA) into the `devices` table. One-time / re-runnable.
 *   node --env-file=.env scripts/backfill-devices.js
 */
import { createClient } from '@supabase/supabase-js'
import { DEVICE_CLASSES } from '../src/lib/taxonomy.js'

const UA = 'Mozilla/5.0 (compatible; NeuroBaseBot/1.0)'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const yearOf = d => (d && /\d{4}/.test(d) ? d.slice(0, 4) : '')

function deriveTags(text) {
  const h = (text || '').toLowerCase()
  return DEVICE_CLASSES.filter(c => c.match.some(m => h.includes(m))).map(c => c.id)
}

async function fetchAll(endpoint, mapFn) {
  const rows = []
  const search = 'openfda.medical_specialty_description:Neurology'
  for (let skip = 0; skip < 26000; skip += 1000) {
    const url = `https://api.fda.gov/device/${endpoint}.json?search=${encodeURIComponent(search)}&limit=1000&skip=${skip}`
    let data
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) break
      data = await res.json()
    } catch { break }
    const results = data.results || []
    for (const r of results) { const m = mapFn(r); if (m) rows.push(m) }
    if (results.length < 1000) break
    await sleep(200)
  }
  return rows
}

const map510k = r => {
  const name = r.device_name
  if (!name) return null
  const desc = `${r.decision_description || 'Cleared'} · 510(k) ${r.k_number || ''} · product code ${r.product_code || '—'}`
  return {
    name, manufacturer: r.applicant || '', type: `Class ${r.openfda?.device_class || '—'}`,
    year: yearOf(r.decision_date), status: 'FDA-cleared (510k)',
    description: desc, modality: [], tags: deriveTags(`${name} ${desc}`),
    url: r.k_number ? `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfPMN/pmn.cfm?ID=${r.k_number}` : null,
  }
}

const mapPma = r => {
  const name = r.trade_name || r.device_name
  if (!name) return null
  const desc = `PMA ${r.pma_number || ''} · ${r.advisory_committee_description || 'Neurology'} · product code ${r.product_code || '—'}`
  return {
    name, manufacturer: r.applicant || '', type: 'PMA (Class III)',
    year: yearOf(r.decision_date), status: 'FDA-approved (PMA)',
    description: desc, modality: [], tags: deriveTags(`${name} ${desc}`),
    url: r.pma_number ? `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfPMA/pma.cfm?id=${r.pma_number}` : null,
  }
}

async function run() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  console.log('Fetching FDA neuro devices (openFDA)…')
  const k = await fetchAll('510k', map510k)
  const pma = await fetchAll('pma', mapPma)
  // Dedupe by name+year, prefer keeping first.
  const seen = new Set()
  const all = [...pma, ...k].filter(d => { const key = `${d.name}|${d.year}`.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true })
  console.log(`   ${k.length} 510(k) + ${pma.length} PMA -> ${all.length} unique devices`)

  // Clear previously-ingested FDA devices (keeps hand-curated seed devices).
  await sb.from('devices').delete().or('status.ilike.FDA-cleared%,status.ilike.FDA-approved%')

  let ok = 0
  for (let i = 0; i < all.length; i += 500) {
    const { error } = await sb.from('devices').insert(all.slice(i, i + 500))
    if (error) console.warn('device insert error:', error.message)
    else ok += Math.min(500, all.length - i)
  }
  console.log(`✓ Devices backfill complete — ${ok.toLocaleString()} FDA devices`)
}

run().catch(e => { console.error(e); process.exit(1) })
