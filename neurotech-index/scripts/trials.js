/**
 * trials.js — ingest ALL neurotech clinical trials from ClinicalTrials.gov
 * (free API v2, paginated) into news_feed as entry_type='trial'. Importable by
 * refresh.js and runnable standalone: `node --env-file=.env scripts/trials.js`.
 */
import { createClient } from '@supabase/supabase-js'
import { DEVICE_CLASSES } from '../src/lib/taxonomy.js'
import { classify } from '../src/lib/classify.js'
import { trialDesign } from './lib/trial-design.js'
import { onTopicTrial } from './lib/trial-gate.js'

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
          sponsorClass: p.sponsorCollaboratorsModule?.leadSponsor?.class || '',
          enrollment: p.designModule?.enrollmentInfo?.count ?? null,
          hasResults: !!s.hasResults,
          conditions, interventions,
          summary: (p.descriptionModule?.briefSummary || '').replace(/\s+/g, ' ').trim(),
          // Endpoints, arm types and masking. Potential-impact scoring reads
          // these for METH 3/4 and for the design-quality grade; nothing else
          // in the app uses them yet. See scripts/lib/trial-design.js.
          design: trialDesign(s),
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

// ── Trial ranking ────────────────────────────────────────────────────────────
// Native trial signals (unlike papers, trials have no citations): how far along
// (phase), whether it's live (status), how large (enrollment), who runs it
// (sponsor), whether results are in, and recency. All normalized 0–1.
const clamp01 = x => Math.max(0, Math.min(1, x))

const PHASE_SCORE = { 'Phase 4': 1.0, 'Phase 3': 0.85, 'Phase 2': 0.6, 'Phase 1': 0.4, 'Early Phase 1': 0.3 }
function phaseNorm(phase) {
  if (!phase) return 0.25
  // A trial may span phases ("Phase 2 / Phase 3") — take the highest.
  return Math.max(0.25, ...phase.split('/').map(p => PHASE_SCORE[p.trim()] || 0.25))
}

const STATUS_SCORE = {
  RECRUITING: 1.0, ENROLLING_BY_INVITATION: 0.95, NOT_YET_RECRUITING: 0.75,
  ACTIVE_NOT_RECRUITING: 0.8, COMPLETED: 0.6, SUSPENDED: 0.3,
  TERMINATED: 0.2, WITHDRAWN: 0.15, UNKNOWN: 0.4,
}
const statusNorm = s => STATUS_SCORE[(s || '').toUpperCase()] ?? 0.4

function trialScore(t) {
  const phase = phaseNorm(t.phase)
  const status = statusNorm(t.status)
  const enroll = clamp01(Math.log10(1 + (t.enrollment || 0)) / 3) // ~1000 participants → 1
  const sponsor = t.sponsorClass === 'INDUSTRY' ? 0.85 : t.sponsorClass === 'NIH' ? 0.8 : 0.55
  const results = t.hasResults ? 1 : 0
  const days = t.startDate ? Math.max(0, (Date.now() - new Date(t.startDate).getTime()) / 864e5) : 700
  const recency = Math.exp(-days * Math.LN2 / 730) // 2-year half-life (trials are long-lived)
  // Topical fit: a device-class tag means the trial is squarely neurotech (vs a
  // drug trial that matched a broad term like "stroke") — down-rank the latter.
  const topical = t.tags?.length ? 1 : 0.4

  return 0.28 * phase + 0.18 * status + 0.14 * enroll + 0.08 * sponsor + 0.05 * results + 0.17 * recency + 0.10 * topical
}

export function trialToRow(t) {
  const score = trialScore(t)
  const row = {
    title: t.title,
    // The registry's brief summary, whole. It used to be cut at 500 characters,
    // which landed mid-sentence on 4,956 of the 8,366 trials — "About this
    // trial" on the detail page renders this text in full, so the reader saw the
    // sentence stop dead. Nothing needs the cap: `summary` is an unbounded text
    // column, and every card that shows a summary clamps it with CSS
    // (line-clamp), which cuts by rendered line and not mid-word in the store.
    summary: t.summary || '',
    source: 'clinicaltrials',
    source_id: t.nctId,
    source_url: t.url,
    pipeline_version: 'trials-2026-07',
    url: t.url,
    published_at: t.startDate,
    topics: t.tags || [],
    // Store the 0–1 score scaled into the indexed relevance_score column so the
    // /trials list can order by importance (phase 3 recruiting first), not date.
    relevance_score: Math.round(score * 10),
    entry_type: 'trial',
    metadata: {
      nctId: t.nctId, phase: t.phase, status: t.status, sponsor: t.sponsor,
      enrollment: t.enrollment, hasResults: t.hasResults,
      conditions: t.conditions, interventions: t.interventions,
      rankScore: score,
      ...(t.design ? { design: t.design } : {}),
    },
  }
  return { ...row, ...classify(row, 'trials') }   // facet_* + in_scope + classifier_version
}

// Fields whose change between syncs is worth logging to trial_changes.
const TRACKED = ['status', 'phase', 'enrollment']

/**
 * Compare the freshly fetched rows against what is stored, keyed by NCT id, and
 * record a dated change event for each tracked field that moved. Mutates rows in
 * place to carry metadata.lastChanged (the change time for changed trials, or
 * the prior value for unchanged ones, so "sort by recently changed" is stable).
 * Returns the change events to insert. Fails soft: if the trial_changes table is
 * absent (migration not yet run) the caller just skips the insert.
 */
async function detectTrialChanges(supabase, rows) {
  // Snapshot the stored trials: nct id -> tracked fields + prior lastChanged.
  const prevByNct = new Map()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('news_feed')
      .select('id,metadata').eq('entry_type', 'trial').order('id').range(from, from + 999)
    if (error || !data?.length) break
    for (const r of data) {
      const nct = r.metadata?.nctId
      if (nct) prevByNct.set(nct, { id: r.id, m: r.metadata || {} })
    }
    if (data.length < 1000) break
  }

  const now = new Date().toISOString()
  const changes = []
  for (const row of rows) {
    const nct = row.metadata?.nctId
    const prev = nct && prevByNct.get(nct)
    if (!prev) continue                               // first-seen trial: not a change
    const diffs = TRACKED.filter(f => String(prev.m[f] ?? '') !== String(row.metadata[f] ?? ''))
    if (diffs.length) {
      row.metadata.lastChanged = now
      for (const f of diffs) {
        changes.push({ nct_id: nct, trial_id: prev.id, field: f,
          old_value: prev.m[f] == null ? null : String(prev.m[f]),
          new_value: row.metadata[f] == null ? null : String(row.metadata[f]),
          changed_at: now })
      }
    } else if (prev.m.lastChanged) {
      row.metadata.lastChanged = prev.m.lastChanged   // unchanged: keep prior stamp
    }
  }
  return changes
}

export async function syncTrials(supabase) {
  const trials = await fetchTrials()
  // Gate BEFORE anything else. ClinicalTrials.gov's `query.term` is a full-text
  // search with synonym expansion, so the 16 neurotech terms also return
  // intravitreal eye implants, obstetric anesthesia and dental work — 18% of
  // what used to be stored. The gate is deterministic regex over the registry's
  // own fields: no model call, no API, nothing to pay for.
  //
  // It has to happen here rather than at the upsert, because the prune below
  // deletes any stored trial missing from `rows`. Gating here therefore also
  // clears out anything off topic that a previous run stored, which is what
  // makes scripts/purge-offtopic-trials.js a one-off rather than a fixture.
  const kept = trials.filter(t => onTopicTrial(t))
  const rejected = trials.length - kept.length
  if (rejected) console.log(`      gate rejected ${rejected} off-topic trials of ${trials.length}`)
  const rows = kept.map(trialToRow)

  // Detect and log status/phase/enrollment changes BEFORE the upsert overwrites
  // the stored rows. The trials view and Phase 8 read this change log.
  let changes = []
  try { changes = await detectTrialChanges(supabase, rows) } catch (e) { console.warn('trial change detection skipped:', e.message) }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('news_feed').upsert(rows.slice(i, i + 500), { onConflict: 'url', ignoreDuplicates: false })
    if (error && !error.message.includes('duplicate')) console.warn('trial upsert error:', error.message)
  }

  if (changes.length) {
    for (let i = 0; i < changes.length; i += 500) {
      const { error } = await supabase.from('trial_changes').insert(changes.slice(i, i + 500))
      if (error) { console.warn('trial_changes insert skipped:', error.message); break }
    }
    console.log(`      logged ${changes.length} trial status/phase/enrollment changes`)
  }

  // Prune trials no longer in the current fetch so the table (and the displayed
  // count) reflects ClinicalTrials.gov's live results instead of accumulating
  // every trial ever seen. Guarded: only prune when the fetch looks healthy, so
  // a partial/failed pull never wipes the table.
  if (rows.length > 3000) {
    const fetched = new Set(rows.map(r => r.url))
    const existing = []
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from('news_feed').select('id,url').eq('entry_type', 'trial').order('id').range(from, from + 999)
      if (!data?.length) break
      existing.push(...data)
      if (data.length < 1000) break
    }
    const staleIds = existing.filter(e => !fetched.has(e.url)).map(e => e.id)
    // Proportional brake. The `rows.length > 3000` guard above was calibrated
    // when `rows` was everything the registry returned; now the gate removes a
    // fifth of it, so a gate bug is a second way for this prune to empty the
    // table and would still clear that floor. A day's genuine churn is dozens of
    // trials, and the one-off gate cleanup is ~18%, so a prune reaching a
    // quarter of the table means something upstream broke, not that the registry
    // changed its mind. Refuse it and say so rather than delete on a guess.
    const share = existing.length ? staleIds.length / existing.length : 0
    if (share > 0.25) {
      console.warn(`::warning::trial prune refused: ${staleIds.length} of ${existing.length} stored trials (${(share * 100).toFixed(1)}%) missing from the fetch`)
    } else {
      for (let i = 0; i < staleIds.length; i += 200)
        await supabase.from('news_feed').delete().in('id', staleIds.slice(i, i + 200))
      if (staleIds.length) console.log(`      pruned ${staleIds.length} stale trials no longer in results`)
    }
  }
  return rows.length
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  syncTrials(supabase).then(n => { console.log(`✓ Synced ${n.toLocaleString()} clinical trials`); process.exit(0) })
    .catch(e => { console.error(e); process.exit(1) })
}
