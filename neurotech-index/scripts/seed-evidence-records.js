/**
 * seed-evidence-records.js — derive the evidence-axis frontier records.
 *
 *   node --env-file=.env scripts/seed-evidence-records.js            # dry run
 *   node --env-file=.env scripts/seed-evidence-records.js --write    # update the JSON
 *
 * Phase 2 of the potential-impact build accepts when "every indication with more
 * than two indexed trials has at least one evidence record". This produces those
 * records. It does NOT produce the capability-axis records (performance,
 * longevity, scale, and the rest); those need values that exist nowhere in this
 * database and are genuine domain work.
 *
 * WHY THIS CAN BE DERIVED AND THE OTHERS CANNOT. An evidence record states the
 * strongest evidence class that currently exists for an indication (spec 3.1).
 * That is a fact about the trial registry, and the registry is already indexed
 * here. Every value this writes is read from a ClinicalTrials.gov record and
 * carries its NCT link. Nothing is inferred, estimated, or recalled.
 *
 * The stored trial metadata is not enough on its own: refresh keeps phase,
 * status, sponsor and enrollment, but not allocation, masking, or intervention
 * model, and "strongest evidence class" turns on exactly those. So the candidate
 * set comes from Supabase and the design fields are fetched from the registry.
 *
 * KNOWN LIMITATION: PER-INDICATION, NOT PER INTERVENTION CLASS. Spec 5.2.1
 * scores GAP against evidence records "for the indication and intervention
 * class". These records are keyed by indication alone, which is what the Phase 2
 * acceptance criterion asks for and what the schema currently supports. The
 * effect is that a first-in-class intervention in a well-studied indication is
 * compared against the indication's strongest trial rather than against its own
 * class, which will understate GAP for genuinely novel interventions. Fixing it
 * needs an intervention-class vocabulary that does not exist yet; it is a
 * product decision, not a code change, and it is flagged rather than guessed.
 *
 * THE LADDER IS DETERMINISTIC. No model call, no judgment. It is written out in
 * EVIDENCE_TIERS below so a reviewer can disagree with a specific rung rather
 * than with an opaque score. GAP (spec 5.2.1) is scored against these rungs:
 * "only open-label or single-arm evidence exists" is tier 2, "no prior
 * interventional evidence of any kind" is no record at all.
 */
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { indicationsFor, INDICATION_LABEL, INDICATION_IDS } from '../src/lib/indications.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WRITE = process.argv.includes('--write')
const UA = 'Mozilla/5.0 (compatible; NeuroBaseBot/1.0; +https://neurobase.app)'
const sleep = ms => new Promise(r => setTimeout(r, ms))

// How many indexed trials per indication get their design fetched. The ranking
// below is a proxy until the design is known, so the pool has to be wide enough
// that a randomized trial is not missed because its enrollment was modest.
const CANDIDATES_PER_INDICATION = 14
const BATCH = 40

/**
 * The evidence ladder, strongest first. `test` reads only registry fields.
 *
 * Controlled means a comparator arm exists: parallel, crossover, or factorial.
 * A randomized single-group study is not controlled, and lands on the single-arm
 * rung, which is the rung GAP 3 is defined against.
 */
export const EVIDENCE_TIERS = [
  {
    tier: 5,
    id: 'randomized_controlled_late_phase',
    label: 'randomized controlled, Phase 3 or 4',
    test: d => d.randomized && d.controlled && d.latePhase,
  },
  {
    tier: 4,
    id: 'randomized_controlled',
    label: 'randomized controlled',
    test: d => d.randomized && d.controlled,
  },
  {
    tier: 3,
    id: 'nonrandomized_controlled',
    label: 'non-randomized with a comparator',
    test: d => !d.randomized && d.controlled,
  },
  {
    tier: 2,
    id: 'single_arm',
    label: 'single-arm or open-label',
    test: d => d.interventional,
  },
  {
    tier: 1,
    id: 'registered_only',
    label: 'registered, design not specified',
    test: () => true,
  },
]

const CONTROLLED_MODELS = ['PARALLEL', 'CROSSOVER', 'FACTORIAL']
const MASKING_LABEL = {
  NONE: 'open label', SINGLE: 'single masking', DOUBLE: 'double masking',
  TRIPLE: 'triple masking', QUADRUPLE: 'quadruple masking',
}

/** Reduce a registry study to the handful of facts the ladder reads. */
export function designOf(study) {
  const p = study?.protocolSection || {}
  const dm = p.designModule || {}
  const info = dm.designInfo || {}
  const phases = dm.phases || []
  return {
    nctId: p.identificationModule?.nctId || null,
    interventional: dm.studyType === 'INTERVENTIONAL',
    randomized: info.allocation === 'RANDOMIZED',
    controlled: CONTROLLED_MODELS.includes(info.interventionModel),
    latePhase: phases.includes('PHASE3') || phases.includes('PHASE4'),
    phases,
    model: info.interventionModel || null,
    masking: info.maskingInfo?.masking || null,
    enrollment: dm.enrollmentInfo?.count ?? null,
    enrollmentType: dm.enrollmentInfo?.type || null,
    status: p.statusModule?.overallStatus || null,
    completionDate: p.statusModule?.completionDateStruct?.date
      || p.statusModule?.primaryCompletionDateStruct?.date || null,
    startDate: p.statusModule?.startDateStruct?.date || null,
    sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name || null,
    hasResults: !!study?.hasResults,
  }
}

export function tierOf(d) {
  if (!d.interventional) return null
  return EVIDENCE_TIERS.find(t => t.test(d))
}

/**
 * Rank within a tier: demonstrated beats ongoing, bigger beats smaller, recent
 * beats old. Returns a sortable tuple, highest first.
 */
const rankKey = d => [
  d.hasResults ? 1 : 0,
  d.status === 'COMPLETED' ? 1 : 0,
  d.enrollment || 0,
  Number((d.completionDate || d.startDate || '0').slice(0, 4)) || 0,
]
const cmpRank = (a, b) => {
  const ka = rankKey(a), kb = rankKey(b)
  for (let i = 0; i < ka.length; i++) if (kb[i] !== ka[i]) return kb[i] - ka[i]
  return 0
}

/** A full ISO date, padding a partial registry date ("2014-05") to a day. */
function isoDate(raw) {
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`
  if (/^\d{4}$/.test(raw)) return `${raw}-01-01`
  return null
}

/**
 * The date that actually describes the trial's state, and how to say it.
 * A non-completed trial's completionDate is the sponsor's ESTIMATE, so quoting
 * it as if it happened would put a future event in the record. Completed trials
 * report their completion; everything else reports when it started.
 */
export function dateOf(d) {
  if (d.status === 'COMPLETED' && d.completionDate) return { when: d.completionDate, verb: 'completed' }
  if (d.hasResults && d.completionDate) return { when: d.completionDate, verb: 'results posted' }
  const status = (d.status || '').toLowerCase().replace(/_/g, ' ')
  if (d.startDate) return { when: d.startDate, verb: status ? `${status}, started` : 'started' }
  return { when: null, verb: null }
}

/**
 * The human-readable value string. Units live in the string, per spec 3.1.
 * Built from the design facts rather than the tier label, so the phase is not
 * printed twice ("randomized controlled Phase 3 or 4, ..., Phase 4").
 */
export function valueFor(tier, d) {
  const bits = []
  if (d.randomized) bits.push('randomized')
  else if (d.interventional && d.model) bits.push('non-randomized')
  if (d.model) bits.push(d.model.toLowerCase().replace(/_/g, ' ') + ' assignment')
  const phase = (d.phases || []).filter(p => p !== 'NA')
    .map(p => p.replace('EARLY_PHASE1', 'early Phase 1').replace('PHASE', 'Phase '))
  if (phase.length) bits.push(phase.join('/'))
  if (d.masking && MASKING_LABEL[d.masking]) bits.push(MASKING_LABEL[d.masking])
  if (d.enrollment) bits.push(`n = ${d.enrollment}`)
  const { when, verb } = dateOf(d)
  if (when) bits.push(`${verb} ${when}`)
  return bits.length ? bits.join(', ') : tier.label
}

async function fetchDesigns(nctIds) {
  const out = new Map()
  const fields = [
    'protocolSection.identificationModule.nctId',
    'protocolSection.designModule',
    'protocolSection.statusModule',
    'protocolSection.sponsorCollaboratorsModule.leadSponsor',
    'hasResults',
  ].join(',')
  for (let i = 0; i < nctIds.length; i += BATCH) {
    const slice = nctIds.slice(i, i + BATCH)
    const url = `https://clinicaltrials.gov/api/v2/studies?filter.ids=${slice.join(',')}` +
      `&fields=${fields}&pageSize=${BATCH}&format=json`
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) { console.error(`  ! registry returned ${res.status} for a batch of ${slice.length}`); continue }
      const data = await res.json()
      for (const s of data.studies || []) {
        const d = designOf(s)
        if (d.nctId) out.set(d.nctId, d)
      }
    } catch (err) {
      console.error(`  ! batch fetch failed: ${err.message}`)
    }
    process.stdout.write(`\r  fetched ${Math.min(i + BATCH, nctIds.length)}/${nctIds.length} designs`)
    await sleep(150)
  }
  process.stdout.write('\n')
  return out
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  // ── 1. Every indexed trial, grouped by indication ─────────────────────────
  const trials = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('news_feed')
      .select('id,title,url,source_url,metadata').eq('entry_type', 'trial').range(from, from + 999)
    if (error) { console.error('read failed:', error.message); process.exit(1) }
    if (!data.length) break
    trials.push(...data)
    if (data.length < 1000) break
  }
  console.log(`${trials.length} indexed trials.`)

  const byIndication = new Map()
  for (const t of trials) {
    const nctId = t.metadata?.nctId
    if (!nctId) continue
    for (const ind of indicationsFor(t.metadata?.conditions || [])) {
      if (!byIndication.has(ind)) byIndication.set(ind, [])
      byIndication.get(ind).push({ ...t, nctId })
    }
  }

  // Phase 2 targets indications with MORE THAN TWO indexed trials.
  const eligible = [...byIndication.entries()].filter(([, ts]) => ts.length > 2)
  console.log(`${eligible.length} indications with more than two indexed trials ` +
    `(of ${INDICATION_IDS.length} in the vocabulary).`)

  // ── 2. Fetch design fields for the candidate pool ─────────────────────────
  const pool = new Set()
  for (const [, ts] of eligible) {
    // Pre-rank on what is already stored, so the pool is the plausible strongest.
    const ranked = [...ts].sort((a, b) => {
      const pa = /Phase (\d)/.exec(a.metadata?.phase || '')?.[1] || 0
      const pb = /Phase (\d)/.exec(b.metadata?.phase || '')?.[1] || 0
      if (pb !== pa) return pb - pa
      return (b.metadata?.enrollment || 0) - (a.metadata?.enrollment || 0)
    })
    for (const t of ranked.slice(0, CANDIDATES_PER_INDICATION)) pool.add(t.nctId)
  }
  console.log(`fetching design fields for ${pool.size} candidate trials...`)
  const designs = await fetchDesigns([...pool])

  // ── 3. Pick the strongest trial per indication ────────────────────────────
  const records = {}
  const skipped = []
  for (const [ind, ts] of eligible) {
    const scored = []
    for (const t of ts) {
      const d = designs.get(t.nctId)
      if (!d) continue
      const tier = tierOf(d)
      if (!tier) continue      // observational: not interventional evidence
      scored.push({ t, d, tier })
    }
    if (!scored.length) { skipped.push([ind, ts.length, 'no interventional trial in the candidate pool']); continue }

    scored.sort((a, b) => (b.tier.tier - a.tier.tier) || cmpRank(a.d, b.d))
    const best = scored[0]
    const established = isoDate(dateOf(best.d).when)
    if (!established) { skipped.push([ind, ts.length, `winner ${best.d.nctId} has no usable date`]); continue }

    // Confidence describes how established the evidence CLASS is, not how good
    // the trial is. A trial that has not reported cannot establish anything, so
    // an ongoing winner is claimed-only however well designed it is. Replication
    // needs two FINISHED trials on the same rung from different sponsors:
    // "several sponsors have registered one" is not replication.
    const finished = s => s.d.status === 'COMPLETED' || s.d.hasResults
    const sameTierDone = scored.filter(s => s.tier.tier === best.tier.tier && finished(s))
    const sponsors = new Set(sameTierDone.map(s => (s.d.sponsor || '').toLowerCase()).filter(Boolean))
    const confidence = !finished(best) ? 'claimed-only'
      : (best.tier.tier >= 4 && sponsors.size >= 2) ? 'replicated'
      : 'single-group'

    records[`evidence-${ind.replace(/_/g, '-')}`] = {
      axis: `strongest interventional evidence, ${INDICATION_LABEL[ind]}`,
      axis_type: 'evidence',
      indication: ind,
      current_value: valueFor(best.tier, best.d),
      held_by: { type: 'news_feed', id: best.t.id },
      established_date: established,
      confidence,
      source: 'clinicaltrials',
      source_url: best.t.url || best.t.source_url || `https://clinicaltrials.gov/study/${best.d.nctId}`,
      notes: `${best.d.nctId}, sponsor ${best.d.sponsor || 'not stated'}. ` +
        `Rung "${best.tier.id}" (tier ${best.tier.tier} of 5) of the ladder in ` +
        `scripts/seed-evidence-records.js, selected from ${ts.length} indexed trial(s) ` +
        `for this indication, ${scored.length} of which had design fields retrieved and ` +
        `${sameTierDone.length} of which are finished on the same rung across ` +
        `${sponsors.size} sponsor(s). Per-indication, NOT per intervention class: ` +
        `see the header of scripts/seed-evidence-records.js. Derived from registry ` +
        `fields only; no design judgement was applied.`,
    }
  }

  // ── 4. Report ─────────────────────────────────────────────────────────────
  const tierCount = {}
  for (const r of Object.values(records)) {
    const m = /Rung "([a-z_]+)"/.exec(r.notes)?.[1] || '?'
    tierCount[m] = (tierCount[m] || 0) + 1
  }
  console.log(`\n${Object.keys(records).length} evidence record(s) derived.`)
  for (const [k, v] of Object.entries(tierCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(3)}  ${k}`)
  }
  const conf = {}
  for (const r of Object.values(records)) conf[r.confidence] = (conf[r.confidence] || 0) + 1
  console.log('  confidence:', Object.entries(conf).map(([k, v]) => `${k} ${v}`).join(', '))

  if (skipped.length) {
    console.log(`\n${skipped.length} eligible indication(s) with no record:`)
    for (const [ind, n, why] of skipped) console.log(`  ? ${ind} (${n} trials): ${why}`)
  }

  const missing = eligible.map(([i]) => i).filter(i => !records[`evidence-${i.replace(/_/g, '-')}`])
  console.log(`\nPhase 2 evidence criterion: ${eligible.length - missing.length}/${eligible.length} ` +
    `eligible indications covered.`)

  if (!WRITE) {
    console.log('\nDry run. scripts/data/frontier-records.json not touched. Re-run with --write.')
    const sample = Object.entries(records).slice(0, 3)
    if (sample.length) {
      console.log('\nSample:')
      for (const [k, r] of sample) console.log(`  ${k}\n    ${r.current_value}\n    ${r.source_url}`)
    }
    return
  }

  // Merge into the curated file, leaving hand-written entries alone. Evidence
  // records are machine-derived but fully sourced; they live in the same file so
  // one reviewer sees one diff and one backfill applies everything.
  const path = join(__dirname, 'data/frontier-records.json')
  const file = JSON.parse(readFileSync(path, 'utf8'))
  file.records = { ...file.records, ...records }
  writeFileSync(path, JSON.stringify(file, null, 2) + '\n')
  console.log(`\n✓ wrote ${Object.keys(records).length} evidence record(s) into scripts/data/frontier-records.json.`)
  console.log('  Review the diff, then: node --env-file=.env scripts/backfill-frontier-records.js')
}

if (process.argv[1] && process.argv[1].endsWith('seed-evidence-records.js')) {
  run().catch(e => { console.error(e); process.exit(1) })
}
