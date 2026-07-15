/**
 * trials.js — ingest ALL neurotech clinical trials from ClinicalTrials.gov
 * (free API v2, paginated) into news_feed as entry_type='trial'. Importable by
 * refresh.js and runnable standalone: `node --env-file=.env scripts/trials.js`.
 */
import { createClient } from '@supabase/supabase-js'
import { DEVICE_CLASSES } from '../src/lib/taxonomy.js'

const UA = 'Mozilla/5.0 (compatible; NeuroBaseBot/1.0; +https://neurobase.app)'

const TERMS = [
  'brain computer interface', 'brain machine interface', 'neural implant', 'neural interface',
  'deep brain stimulation', 'neurostimulation', 'neuroprosthesis', 'spinal cord stimulation',
  'vagus nerve stimulation', 'cochlear implant', 'retinal implant', 'responsive neurostimulation',
  'transcranial magnetic stimulation', 'neurotechnology', 'electrocorticography', 'neuromodulation device',
]

const toIso = d => { if (!d) return null; const t = new Date(d).getTime(); return Number.isNaN(t) ? null : new Date(t).toISOString() }
const PHASE_MAP = { EARLY_PHASE1: 'Early Phase 1', PHASE1: 'Phase 1', PHASE2: 'Phase 2', PHASE3: 'Phase 3', PHASE4: 'Phase 4' }
const fmtPhases = phases => (phases || []).filter(x => x && x !== 'NA').map(x => PHASE_MAP[x] || x).join(' / ')
const sleep = ms => new Promise(r => setTimeout(r, ms))

function deriveTags(text) {
  const h = (text || '').toLowerCase()
  return DEVICE_CLASSES.filter(c => c.match.some(m => h.includes(m))).map(c => c.id)
}

export async function fetchTrials(maxPerTerm = 1600) {
  const out = []
  const seen = new Set()
  for (const term of TERMS) {
    let pageToken = null
    let got = 0
    do {
      const url = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(term)}&pageSize=200&format=json` + (pageToken ? `&pageToken=${pageToken}` : '')
      let data
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA } })
        if (!res.ok) break
        data = await res.json()
      } catch { break }
      for (const s of data.studies || []) {
        const p = s.protocolSection || {}
        const nctId = p.identificationModule?.nctId
        const title = p.identificationModule?.briefTitle || p.identificationModule?.officialTitle
        got++
        if (!nctId || !title || seen.has(nctId)) continue
        seen.add(nctId)
        const conditions = p.conditionsModule?.conditions || []
        const interventions = (p.armsInterventionsModule?.interventions || []).map(i => i.name).filter(Boolean)
        out.push({
          nctId, title,
          status: p.statusModule?.overallStatus || '',
          phase: fmtPhases(p.designModule?.phases),
          sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name || '',
          conditions, interventions,
          summary: (p.descriptionModule?.briefSummary || '').replace(/\s+/g, ' ').trim(),
          startDate: toIso(p.statusModule?.startDateStruct?.date),
          url: `https://clinicaltrials.gov/study/${nctId}`,
          tags: deriveTags(`${title} ${conditions.join(' ')} ${interventions.join(' ')} ${p.descriptionModule?.briefSummary || ''}`),
        })
      }
      pageToken = data.nextPageToken
      await sleep(120)
    } while (pageToken && got < maxPerTerm)
  }
  return out.sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0))
}

export function trialToRow(t) {
  const days = t.startDate ? Math.max(0, (Date.now() - new Date(t.startDate).getTime()) / 864e5) : 400
  return {
    title: t.title,
    summary: t.summary ? t.summary.slice(0, 500) : '',
    source: t.sponsor || 'ClinicalTrials.gov',
    url: t.url,
    published_at: t.startDate,
    topics: t.tags || [],
    relevance_score: 5,
    entry_type: 'trial',
    metadata: {
      nctId: t.nctId, phase: t.phase, status: t.status, sponsor: t.sponsor,
      conditions: t.conditions, interventions: t.interventions,
      rankScore: Math.exp(-days / 900),
    },
  }
}

export async function syncTrials(supabase) {
  const trials = await fetchTrials()
  const rows = trials.map(trialToRow)
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('news_feed').upsert(rows.slice(i, i + 500), { onConflict: 'url', ignoreDuplicates: false })
    if (error && !error.message.includes('duplicate')) console.warn('trial upsert error:', error.message)
  }
  return rows.length
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  syncTrials(supabase).then(n => { console.log(`✓ Synced ${n.toLocaleString()} clinical trials`); process.exit(0) })
    .catch(e => { console.error(e); process.exit(1) })
}
