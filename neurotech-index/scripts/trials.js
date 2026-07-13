/**
 * trials.js — ingest neurotech clinical trials from ClinicalTrials.gov (free
 * API v2) into the news_feed table as entry_type='trial'. Importable by
 * refresh.js and runnable standalone: `node --env-file=.env scripts/trials.js`.
 */
import { createClient } from '@supabase/supabase-js'

const UA = 'Mozilla/5.0 (compatible; NeuroBaseBot/1.0; +https://neurobase.app)'

const TERMS = [
  'brain computer interface', 'brain machine interface', 'neural implant',
  'deep brain stimulation', 'spinal cord stimulation', 'vagus nerve stimulation',
  'retinal implant', 'cochlear implant', 'neuroprosthesis', 'motor cortex decoding',
  'responsive neurostimulation', 'transcranial stimulation', 'neural interface',
]

const toIso = d => { if (!d) return null; const t = new Date(d).getTime(); return Number.isNaN(t) ? null : new Date(t).toISOString() }

const PHASE_MAP = { EARLY_PHASE1: 'Early Phase 1', PHASE1: 'Phase 1', PHASE2: 'Phase 2', PHASE3: 'Phase 3', PHASE4: 'Phase 4' }
const fmtPhases = phases => (phases || []).filter(x => x && x !== 'NA').map(x => PHASE_MAP[x] || x).join(' / ')

export async function fetchTrials() {
  const out = []
  const seen = new Set()
  for (const term of TERMS) {
    try {
      const url = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(term)}&pageSize=30&sort=StartDate:desc&format=json`
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) continue
      const data = await res.json()
      for (const s of data.studies || []) {
        const p = s.protocolSection || {}
        const nctId = p.identificationModule?.nctId
        const title = p.identificationModule?.briefTitle || p.identificationModule?.officialTitle
        if (!nctId || !title || seen.has(nctId)) continue
        seen.add(nctId)
        out.push({
          nctId,
          title,
          status: p.statusModule?.overallStatus || '',
          phase: fmtPhases(p.designModule?.phases),
          sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name || '',
          conditions: p.conditionsModule?.conditions || [],
          interventions: (p.armsInterventionsModule?.interventions || []).map(i => i.name).filter(Boolean),
          summary: (p.descriptionModule?.briefSummary || '').replace(/\s+/g, ' ').trim(),
          startDate: toIso(p.statusModule?.startDateStruct?.date),
          url: `https://clinicaltrials.gov/study/${nctId}`,
        })
      }
    } catch { /* skip term */ }
  }
  const cutoff = Date.now() - 4 * 365 * 24 * 3600 * 1000 // last ~4 years
  return out
    .filter(t => !t.startDate || new Date(t.startDate).getTime() >= cutoff)
    .sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0))
    .slice(0, 90)
}

export function trialToRow(t) {
  const days = t.startDate ? Math.max(0, (Date.now() - new Date(t.startDate).getTime()) / 864e5) : 400
  return {
    title: t.title,
    summary: t.summary ? t.summary.slice(0, 400) : '',
    source: t.sponsor || 'ClinicalTrials.gov',
    url: t.url,
    published_at: t.startDate,
    topics: [],
    relevance_score: 5,
    entry_type: 'trial',
    metadata: {
      nctId: t.nctId, phase: t.phase, status: t.status, sponsor: t.sponsor,
      conditions: t.conditions, interventions: t.interventions,
      rankScore: Math.exp(-days / 900), // slow recency decay so trials sort newest-first
    },
  }
}

export async function syncTrials(supabase) {
  const trials = await fetchTrials()
  for (const t of trials) {
    const { error } = await supabase.from('news_feed').upsert(trialToRow(t), { onConflict: 'url', ignoreDuplicates: false })
    if (error && !error.message.includes('duplicate')) console.warn('trial upsert error:', error.message)
  }
  return trials.length
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  syncTrials(supabase).then(n => { console.log(`✓ Synced ${n} clinical trials`); process.exit(0) })
    .catch(e => { console.error(e); process.exit(1) })
}
