/**
 * backfill-stage.js — derive furthest_stage for companies from the trial and
 * regulatory records this database already links to them.
 *
 *   node --env-file=.env scripts/backfill-stage.js            # dry run
 *   node --env-file=.env scripts/backfill-stage.js --commit
 *   node --env-file=.env scripts/backfill-stage.js --only "Neuralink;Synchron"
 *
 * Two evidence sources, both primary:
 *
 *   openfda            regulatory_records reached through the made_by edge from
 *                      a device to its maker. The pathway is the stage and the
 *                      K/PMA number is the citation.
 *   clinicaltrials_gov trials reached through the sponsored_by edge. The stored
 *                      metadata does not carry study type or primary purpose, so
 *                      each NCT is fetched from the CT.gov v2 API, which does.
 *
 * A company with neither gets null, which renders as no badge. That is the
 * honest output and it will be common: the entity graph links a device to only
 * 6 of the current top 20 and a trial to 13.
 *
 * Nothing is written without --commit.
 */
import { createClient } from '@supabase/supabase-js'
import { stageFromTrial, stageFromPathway, furthestStage } from './lib/stage.js'

const arg = name => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : null
}
const COMMIT = process.argv.includes('--commit')
const onlyArg = arg('--only')
const ONLY = onlyArg
  ? onlyArg.split(onlyArg.includes(';') ? ';' : ',').map(s => s.trim()).filter(Boolean)
  : null

const PIPELINE = 'stage-phase2b'
const UA = { headers: { 'User-Agent': 'NeuroBase research@neurobase.app' } }
const sleep = ms => new Promise(r => setTimeout(r, ms))

const nctUrl = id => `https://clinicaltrials.gov/study/${id}`
const CT_FIELDS = 'protocolSection.designModule,protocolSection.statusModule.overallStatus'

/** The design section of a study, from ClinicalTrials.gov. */
async function fetchStudy(nctId) {
  try {
    const res = await fetch(`https://clinicaltrials.gov/api/v2/studies/${nctId}?fields=${CT_FIELDS}`, UA)
    if (!res.ok) return null
    const body = await res.json()
    const design = body.protocolSection?.designModule
    if (!design) return null
    return {
      studyType: design.studyType,
      phases: design.phases || [],
      primaryPurpose: design.designInfo?.primaryPurpose,
      status: body.protocolSection?.statusModule?.overallStatus,
    }
  } catch { return null }
}

async function pageAll(sb, table, select, apply = q => q) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await apply(sb.from(table).select(select)).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  let orgs = await pageAll(sb, 'organizations', 'id,name,furthest_stage,stage_evidence_id',
    q => q.eq('type', 'company'))
  if (ONLY) orgs = orgs.filter(o => ONLY.includes(o.name))
  const orgIds = new Set(orgs.map(o => o.id))

  const edges = (await pageAll(sb, 'relationships', 'subject_id,predicate,object_id',
    q => q.eq('object_type', 'organizations').in('predicate', ['made_by', 'sponsored_by'])))
    .filter(e => orgIds.has(e.object_id))

  const deviceIdsByOrg = {}
  const trialIdsByOrg = {}
  for (const e of edges) {
    if (e.predicate === 'made_by') (deviceIdsByOrg[e.object_id] ||= []).push(e.subject_id)
    else (trialIdsByOrg[e.object_id] ||= []).push(e.subject_id)
  }

  // ── openFDA evidence ──────────────────────────────────────────────────────
  const allDeviceIds = [...new Set(Object.values(deviceIdsByOrg).flat())]
  const regs = allDeviceIds.length
    ? await pageAll(sb, 'regulatory_records', 'device_id,pathway,number,decision_date,source_url',
      q => q.in('device_id', allDeviceIds))
    : []
  const regsByDevice = {}
  for (const r of regs) (regsByDevice[r.device_id] ||= []).push(r)

  // ── Trial evidence ────────────────────────────────────────────────────────
  const allTrialIds = [...new Set(Object.values(trialIdsByOrg).flat())]
  const trials = allTrialIds.length
    ? await pageAll(sb, 'news_feed', 'id,title,metadata,url', q => q.in('id', allTrialIds))
    : []
  const trialById = Object.fromEntries(trials.map(t => [t.id, t]))

  const nctIds = [...new Set(trials.map(t => t.metadata?.nctId).filter(Boolean))]
  console.log(`${orgs.length} companies. ${allDeviceIds.length} linked devices, ` +
    `${regs.length} regulatory records, ${nctIds.length} linked trials to fetch.\n`)

  const studies = {}
  let fetched = 0
  for (const id of nctIds) {
    studies[id] = await fetchStudy(id)
    fetched++
    process.stdout.write(`\r  fetching studies ${fetched}/${nctIds.length}`)
    await sleep(120)
  }
  if (nctIds.length) console.log('')

  // ── Derive ────────────────────────────────────────────────────────────────
  const now = new Date().toISOString()
  const updates = []
  const tally = { openfda: 0, ctgov: 0, none: 0, byStage: {} }

  for (const org of orgs) {
    const evidence = []

    for (const devId of deviceIdsByOrg[org.id] || []) {
      for (const r of regsByDevice[devId] || []) {
        const stage = stageFromPathway(r.pathway)
        if (stage && r.number) {
          evidence.push({
            stage, evidenceType: 'openfda', evidenceId: r.number,
            sourceUrl: r.source_url, date: r.decision_date,
          })
        }
      }
    }

    for (const trialId of trialIdsByOrg[org.id] || []) {
      const t = trialById[trialId]
      const nct = t?.metadata?.nctId
      const study = nct ? studies[nct] : null
      if (!study) continue
      const stage = stageFromTrial(study)
      if (stage) {
        evidence.push({
          stage, evidenceType: 'clinicaltrials_gov', evidenceId: nct, sourceUrl: nctUrl(nct),
        })
      }
    }

    const best = furthestStage(evidence)
    if (!best) {
      tally.none++
      continue
    }
    tally[best.evidenceType === 'openfda' ? 'openfda' : 'ctgov']++
    tally.byStage[best.stage] = (tally.byStage[best.stage] || 0) + 1

    updates.push({
      id: org.id, name: org.name,
      furthest_stage: best.stage,
      stage_evidence_type: best.evidenceType,
      stage_evidence_id: best.evidenceId,
      stage_verified_at: now,
      pipeline_version: PIPELINE,
    })
    console.log(`  ✓ ${org.name}: ${best.stage} (${best.evidenceType} ${best.evidenceId}, ` +
      `${evidence.length} piece(s) of evidence)`)
  }

  console.log('\n─── summary ───')
  console.log(`stage derived:    ${updates.length}`)
  console.log(`  from openFDA:   ${tally.openfda}`)
  console.log(`  from CT.gov:    ${tally.ctgov}`)
  console.log(`no evidence:      ${tally.none}`)
  console.log('by stage:')
  for (const [s, n] of Object.entries(tally.byStage).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(18)} ${n}`)
  }
  console.log('\ncommercial, ce_marked and withdrawn are never derived here. ' +
    'No ingested source supports them.')

  if (!COMMIT) {
    console.log('\nDry run. Nothing written. Re-run with --commit to apply.')
    return
  }
  for (let i = 0; i < updates.length; i += 100) {
    const { error } = await sb.from('organizations').upsert(updates.slice(i, i + 100), { onConflict: 'id' })
    if (error) { console.error('upsert failed:', error.message); process.exit(1) }
  }
  console.log(`✓ wrote ${updates.length} stage values.`)
}

run().catch(e => { console.error(e); process.exit(1) })
