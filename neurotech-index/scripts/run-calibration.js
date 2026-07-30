/**
 * run-calibration.js — Phase 5. Score the holdout and evaluate it.
 *
 *   node --env-file=.env scripts/run-calibration.js --negatives 100 --background 76
 *
 * Reads the FROZEN holdout, verifies its hash, extracts and scores the sample
 * against 2016 field state, then evaluates. Refuses to run if the frozen lists
 * have changed since they were registered.
 *
 * STRATIFIED, AND THAT MATTERS FOR HOW THE NUMBERS READ. The reference list is
 * 24 items in a 12,357-item corpus, a base rate of 0.19%. A random sample large
 * enough to contain them naturally would be most of the corpus. So the sample is
 * built as: every reference item, a sample of the negative set, and a random
 * background.
 *
 * The consequence is that the positive base rate in the SAMPLE is far higher
 * than in the corpus, so recall at the top decile is measured on an enriched
 * set and is NOT comparable to what recall would be over the whole corpus. That
 * is stated with the result rather than buried.
 *
 * Because of that enrichment, a second, base-rate-invariant metric is reported
 * alongside it: the probability that a reference item outranks a negative item
 * (the rank-order AUC). Spec 12 names recall as primary and it is reported as
 * primary; the AUC is the one that survives the enrichment.
 */
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { subfieldFor } from '../src/lib/subfields.js'
import { fdCeilingFor } from '../src/lib/frontier-coverage.js'
import { validate } from '../src/lib/validate.js'
import { compose, tagsFor } from '../src/lib/compose.js'
import { buildPrompt, applyCeilings, SCORING_TOOL, parseToolScores } from './lib/score.js'
import { GRANULARITY_CAPS } from './lib/caps.js'
import {
  EXTRACTION_TOOL, EXTRACTION_PROMPT, ENTITY_NOTES, shapeExtraction, gapFlagged,
  trialDesignFrom, inputFor,
} from './lib/extract.js'
import {
  stripIdentity, freeze, verifyFrozen, recallAtDecile, negativeAtDecile, BASELINE_AS_OF, WINDOW,
} from './lib/retro.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d }
const N_NEG = Number(argOf('--negatives', 100))
const N_BG = Number(argOf('--background', 76))
const MODEL = argOf('--model', 'claude-sonnet-5')
const AS_OF = '2019-12-31'
const RUN_LABEL = argOf('--run-label', 'retro-2016')
const RESEARCH_ONLY = process.argv.includes('--research-only')
const COMMIT = process.argv.includes('--commit')
const WITHHOLD_CLAIMED = process.argv.includes('--withhold-claimed')
const CONCURRENCY = 6
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function withRetry(fn, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try { return await fn() } catch (err) {
      if (![429, 500, 502, 503, 529].includes(err.status) || i === attempts - 1) throw err
      await sleep(1500 * 2 ** i)
    }
  }
}

async function pageAll(sb, table, select, filt = q => q) {
  const out = []
  for (let f = 0; ; f += 1000) {
    const { data, error } = await filt(sb.from(table).select(select)).range(f, f + 999)
    if (error) { console.error(`${table}: ${error.message}`); return out }
    if (!data.length) break
    out.push(...data); if (data.length < 1000) break
  }
  return out
}

/** Deterministic shuffle so a re-run samples identically. */
function seededPick(arr, n, seed = 42) {
  const a = [...arr]
  let s = seed
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const j = s % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, n)
}

/** Extract then score one stripped item against the 2016 baseline. */
async function scoreRetro(anthropic, { item, entityType, subfield, records, axisPairs }) {
  const input = inputFor(item, entityType)
  if (!input) return null

  const eResp = await withRetry(() => anthropic.messages.create({
    model: MODEL, max_tokens: 2000,
    tools: [EXTRACTION_TOOL], tool_choice: { type: 'tool', name: EXTRACTION_TOOL.name },
    messages: [{
      role: 'user',
      content: EXTRACTION_PROMPT
        .replace('{entity_note}', ENTITY_NOTES[entityType] || '')
        .replace('{entity_type}', entityType)
        .replace('{granularity}', input.granularity)
        .replace('{content}', input.content.slice(0, 12000)),
    }],
  }))
  const eBlock = eResp.content?.find(c => c.type === 'tool_use')
  if (!eBlock) return null
  const extraction = shapeExtraction(eBlock.input)
  extraction.gap_flagged = gapFlagged(extraction, entityType)
  extraction.input_granularity = input.granularity
  extraction.trial_design = entityType === 'trial' && item.metadata?.design
    ? trialDesignFrom(item.metadata) : null

  const fdCeiling = fdCeilingFor(records, subfield)
  const granularityCap = GRANULARITY_CAPS[input.granularity] || GRANULARITY_CAPS.metadata

  const sResp = await withRetry(() => anthropic.messages.create({
    model: MODEL, max_tokens: 2500,
    tools: [SCORING_TOOL(entityType)], tool_choice: { type: 'tool', name: 'record_scores' },
    messages: [{ role: 'user', content: buildPrompt({ extraction, entityType, records, axisPairs, fdCeiling, withholdClaimed: WITHHOLD_CLAIMED }) }],
  }))
  const raw = sResp.content?.find(c => c.type === 'tool_use')?.input
  if (!raw) return null

  const dims = entityType === 'trial' ? ['GAP', 'GATE', 'METH'] : ['FD', 'LV', 'TR']
  const { scores: parsed, malformed } = parseToolScores(raw, dims, entityType)
  if (malformed.length) throw Object.assign(new Error(`malformed ${malformed.join(',')}`), { malformed })

  const { scores: capped } = applyCeilings(parsed, { fdCeiling, granularityCap })
  const forValidation = {
    ...capped, entity_type: entityType,
    claimed: extraction.claimed, demonstrated: extraction.demonstrated,
    gap_flagged: extraction.gap_flagged,
    frontier_records_consulted: Array.isArray(capped.frontier_records_consulted) ? capped.frontier_records_consulted : [],
    tags: [],
  }
  forValidation.tags = tagsFor(forValidation)
  const { score: validated } = validate(forValidation, { itemId: item.id })
  const composed = compose(
    { ...validated, entity_type: entityType, recency_date: item.recency_date },
    { asOf: AS_OF })

  return {
    id: item.id, entity_type: entityType, subfield,
    item_type: entityType === 'research' ? 'papers' : 'news_feed',
    fd: validated.FD || null, lv: validated.LV || null, tr: validated.TR || null,
    gap: validated.GAP || null, gate: validated.GATE || null, meth: validated.METH || null,
    base: composed.base, multiplier: composed.multiplier, recency: composed.recency,
    evidence_grade: validated.evidence_grade || null,
    translational_distance: validated.translational_distance ?? null,
    user_facing_reason: validated.user_facing_reason || null,
    frontier_records_consulted: forValidation.frontier_records_consulted,
    potential_impact: composed.potential_impact,
    path_taken: composed.path_taken,
    tags: tagsFor(validated),
    granularity: input.granularity,
    fd_ceiling: fdCeiling,
    marker_count: (extraction.rhetorical_markers || []).length,
  }
}

async function run() {
  const holdoutPath = join(__dirname, 'data/retro-holdout.json')
  if (!existsSync(holdoutPath)) {
    console.error('No frozen holdout. Run build-retro-holdout.js --write first.'); process.exit(1)
  }
  const holdout = JSON.parse(readFileSync(holdoutPath, 'utf8'))

  // Pre-registration check. If the lists moved after freezing, the test is void.
  if (!verifyFrozen(holdout.reference.entries, holdout.reference)
    || !verifyFrozen(holdout.negative.entries, holdout.negative)) {
    console.error('FROZEN HOLDOUT HASH MISMATCH. The evaluation sets changed after registration.')
    console.error('The result would not be a blind test. Refusing to run.')
    process.exit(1)
  }
  console.log(`holdout verified: reference ${holdout.reference.hash} (${holdout.reference.count}), ` +
    `negative ${holdout.negative.hash} (${holdout.negative.count})`)

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // ── The 2016 baseline record set ──────────────────────────────────────────
  const records = await pageAll(sb, 'frontier_records',
    'id,subfield,axis,axis_type,current_value,confidence,established_date',
    q => q.is('superseded_by', null).lte('established_date', BASELINE_AS_OF))
  const axisPairs = await pageAll(sb, 'frontier_axis_pairs_live', 'subfield,axis_a,axis_b,why_binding')
  const bySf = {}
  for (const r of records) bySf[r.subfield] = (bySf[r.subfield] || 0) + 1
  console.log(`\n2016 baseline: ${records.length} records established on or before ${BASELINE_AS_OF}`)
  console.log('  per subfield:', JSON.stringify(bySf))
  if (records.length < 20) {
    console.log('  ! a thin baseline caps FD low everywhere, which suppresses the frontier')
    console.log('    path and makes the result a test of the leverage path more than of the')
    console.log('    whole rubric. Reported with the outcome.')
  }

  // ── The stratified sample ─────────────────────────────────────────────────
  const refIds = new Set(holdout.reference.frozen_ids)
  const negIds = holdout.negative.frozen_ids
  const pickedNeg = seededPick(negIds, Math.min(N_NEG, negIds.length))

  const papers = await pageAll(sb, 'papers', 'id,title,abstract,year,authors,journal',
    q => q.eq('in_scope', true).gte('year', WINDOW.start).lte('year', WINDOW.end))
  const feed = await pageAll(sb, 'news_feed', 'id,title,summary,published_at,entry_type,metadata')
  const byId = {}
  for (const p of papers) byId[p.id] = { ...p, item_type: 'papers', entityType: 'research', recency_date: `${p.year}-01-01` }
  for (const f of feed) {
    const y = Number(String(f.published_at || '').slice(0, 4))
    if (y < WINDOW.start || y > WINDOW.end) continue
    byId[f.id] = { ...f, item_type: 'news_feed', entityType: f.entry_type === 'trial' ? 'trial' : 'feed', recency_date: f.published_at }
  }

  let picked
  if (RESEARCH_ONLY) {
    // Research only. The trial-vs-trial run discriminated "did the sponsor post
    // results", which no dimension claims to predict. Rhetorical markers live in
    // paper abstracts, so hype correlation is testable here and not there.
    const pool = Object.keys(byId).filter(id => byId[id].entityType === 'research')
    picked = seededPick(pool, N_BG + N_NEG, 11)
    console.log(`\nRESEARCH-ONLY run: ${picked.length} window papers sampled`)
  } else {
    const bgPool = Object.keys(byId).filter(id => !refIds.has(id) && !pickedNeg.includes(id))
    picked = [...refIds, ...pickedNeg, ...seededPick(bgPool, N_BG, 7)].filter(id => byId[id])
  }
  picked = picked.filter(id => byId[id])
  console.log(`\nsample: ${picked.length}  (reference ${[...refIds].filter(i => byId[i]).length}, ` +
    `negative ${pickedNeg.filter(i => byId[i]).length}, background ${picked.length - [...refIds].filter(i => byId[i]).length - pickedNeg.filter(i => byId[i]).length})`)

  // ── Strip identity, then score ────────────────────────────────────────────
  let strippedCount = 0
  const work = picked.map(id => {
    const raw = byId[id]
    const { item, removed } = stripIdentity(raw)
    if (removed.length) strippedCount++
    const subfield = subfieldFor(raw)
    return {
      item: { ...item, id: raw.id, metadata: raw.metadata, recency_date: raw.recency_date },
      entityType: raw.entityType, subfield,
      records: records.filter(r => r.subfield === subfield),
      axisPairs: axisPairs.filter(p => p.subfield === subfield),
    }
  })
  console.log(`entity stripping removed a named organisation from ${strippedCount} item(s)`)

  const scored = []
  let failed = 0
  for (let i = 0; i < work.length; i += CONCURRENCY) {
    const out = await Promise.all(work.slice(i, i + CONCURRENCY).map(async w => {
      try { return await scoreRetro(anthropic, w) } catch { failed++; return null }
    }))
    for (const r of out) if (r) scored.push(r)
    process.stdout.write(`\r  scored ${scored.length}/${work.length}${failed ? ` (${failed} failed)` : ''}`)
  }
  process.stdout.write('\n')

  // ── Evaluate ──────────────────────────────────────────────────────────────
  const ranked = [...scored].sort((a, b) => b.potential_impact - a.potential_impact)
  const rankedIds = ranked.map(r => r.id)
  const scoredRef = [...refIds].filter(id => scored.some(s => s.id === id))
  const scoredNeg = pickedNeg.filter(id => scored.some(s => s.id === id))

  const recall = recallAtDecile(rankedIds, scoredRef)
  const negative = negativeAtDecile(rankedIds, scoredNeg)

  // Base-rate-invariant: P(reference outranks negative).
  const impactOf = Object.fromEntries(scored.map(s => [s.id, s.potential_impact]))
  let wins = 0, ties = 0, total = 0
  for (const r of scoredRef) for (const n of scoredNeg) {
    total++
    if (impactOf[r] > impactOf[n]) wins++
    else if (impactOf[r] === impactOf[n]) ties++
  }
  const auc = total ? (wins + 0.5 * ties) / total : null

  console.log('\n══ PHASE 5 CALIBRATION ══')
  console.log(`scored ${scored.length} of ${work.length}${failed ? `, ${failed} failed` : ''}`)
  console.log(`\nPRIMARY, recall at the top decile (spec 12)`)
  console.log(`  decile size:      ${recall.decileSize}`)
  console.log(`  reference in set: ${recall.referenceCount}`)
  console.log(`  found in decile:  ${recall.found}`)
  console.log(`  recall:           ${recall.recall === null ? 'n/a' : (recall.recall * 100).toFixed(0) + '%'}`)
  console.log('  NOTE: the sample is enriched. The reference base rate here is')
  console.log(`  ${(100 * recall.referenceCount / scored.length).toFixed(1)}% against 0.19% in the full corpus, so this recall is NOT`)
  console.log('  comparable to recall over the whole corpus.')

  console.log(`\nNEGATIVE CASE (spec 12 calls this the more diagnostic test)`)
  console.log(`  hyped items scored:      ${negative.negativeCount}`)
  console.log(`  reaching the top decile: ${negative.inTopDecile}`)
  console.log(`  rate:                    ${negative.rate === null ? 'n/a' : (negative.rate * 100).toFixed(1) + '%'}`)

  console.log(`\nBASE-RATE-INVARIANT`)
  console.log(`  P(reference outranks a hyped item): ${auc === null ? 'n/a' : (auc * 100).toFixed(1) + '%'}`)
  console.log(`  (50% is chance. This survives the enrichment; recall does not.)`)

  // ── HYPE CORRELATION, spec 13's "single most important number" ───────────
  // No reference list and no domain expert needed, which is why this survives
  // open decision 3 being unresolved. It asks directly whether promotional
  // language predicts score, which spec 2 forbids.
  const xs = scored.map(s => s.marker_count)
  const ys = scored.map(s => s.potential_impact)
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b }
  const r = dx && dy ? num / Math.sqrt(dx * dy) : 0

  const decile = Math.max(1, Math.ceil(ranked.length / 10))
  const topMarkers = ranked.slice(0, decile).reduce((a, s) => a + s.marker_count, 0) / decile
  const restMarkers = ranked.slice(decile).reduce((a, s) => a + s.marker_count, 0) / Math.max(1, ranked.length - decile)
  const withMarkers = scored.filter(s => s.marker_count > 0)
  const without = scored.filter(s => s.marker_count === 0)
  const meanWith = withMarkers.length ? withMarkers.reduce((a, s) => a + s.potential_impact, 0) / withMarkers.length : 0
  const meanWithout = without.length ? without.reduce((a, s) => a + s.potential_impact, 0) / without.length : 0

  console.log('\nHYPE CORRELATION (spec 13: the single most important number)')
  console.log(`  claimed passed to scorer:         ${WITHHOLD_CLAIMED ? 'NO (withheld)' : 'yes'}`)
  console.log(`  marker/impact correlation:        ${r.toFixed(3)}   (target: near zero)`)
  console.log(`  mean markers, top decile:         ${topMarkers.toFixed(2)}`)
  console.log(`  mean markers, rest:               ${restMarkers.toFixed(2)}`)
  console.log(`  mean impact WITH markers:         ${meanWith.toFixed(3)}  (n=${withMarkers.length})`)
  console.log(`  mean impact WITHOUT markers:      ${meanWithout.toFixed(3)}  (n=${without.length})`)
  const verdict = Math.abs(r) < 0.15 && topMarkers <= restMarkers * 1.5
  console.log(`  => ${verdict ? 'PASS: promotional language does not predict score' : 'FAIL: promotional language tracks score'}`)

  const paths = {}, ents = {}
  for (const s of scored) { paths[s.path_taken || 'none'] = (paths[s.path_taken || 'none'] || 0) + 1; ents[s.entity_type] = (ents[s.entity_type] || 0) + 1 }
  console.log(`\ncontext: paths ${JSON.stringify(paths)} | entities ${JSON.stringify(ents)}`)
  const zero = scored.filter(s => s.potential_impact === 0).length
  console.log(`zero-scoring items: ${zero}/${scored.length}`)

  if (!COMMIT) { console.log('\nNot stored. Pass --commit to persist under run_label "' + RUN_LABEL + '".'); return }
  // Store, so asking WHY an item ranked low never costs another full run again.
  const rows = scored.map(s => ({
    item_type: s.item_type, item_id: s.id, entity_type: s.entity_type, subfield: s.subfield || null,
    rubric_version: '1.0', model: MODEL,
    potential_impact: s.potential_impact, path_taken: s.path_taken,
    base: s.base, multiplier: s.multiplier, recency: s.recency,
    fd: s.fd, lv: s.lv, tr: s.tr, gap: s.gap, gate: s.gate, meth: s.meth,
    translational_distance: s.translational_distance, evidence_grade: s.evidence_grade,
    evidence_variant: s.entity_type === 'trial' ? 'trial_design' : 'standard',
    frontier_records_consulted: s.frontier_records_consulted || [],
    fd_ceiling: s.fd_ceiling, input_granularity: s.granularity,
    rhetorical_marker_count: s.marker_count,
    user_facing_reason: s.user_facing_reason, tags: s.tags || [],
    run_label: RUN_LABEL,
  }))
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await sb.from('impact_scores')
      .upsert(rows.slice(i, i + 50), { onConflict: 'item_type,item_id,rubric_version,run_label' })
    if (error) { console.error('store failed:', error.message); process.exit(1) }
  }
  console.log(`\n✓ stored ${rows.length} score(s) under run_label "${RUN_LABEL}".`)
}

run().catch(e => { console.error(e); process.exit(1) })
