/**
 * run-calibration-trials.js — Phase 5 for the trial arm, with NO model calls.
 *
 *   node --env-file=.env scripts/run-calibration-trials.js
 *   node --env-file=.env scripts/run-calibration-trials.js --commit
 *
 * The frozen holdout turned out to be trials end to end: all 24 reference items
 * and all 325 negatives live in news_feed with a registry design block. So the
 * whole of spec 12 can be evaluated against the deterministic scorer for
 * nothing, which is the arm that actually powers the shipped Trials sort.
 *
 * WHAT MAKES THIS A REAL TEST AND NOT A REHEARSAL:
 *
 *   1. It calls scoreTrial() from score-trials-deterministic.js. Not a copy.
 *      A calibration of a parallel implementation measures the parallel
 *      implementation.
 *   2. The frozen hashes are verified before anything runs. The reference list
 *      cannot be edited to fit a result without changing the hash.
 *   3. Nothing post-window reaches the scorer. Evidence records are filtered to
 *      those established on or before 2016-01-01, peer counts are computed only
 *      over trials registered on or before the as-of date, and recency composes
 *      as of 2019-12-31. designGrade() reads only registration-time fields, so
 *      hasResults and status - the very signals the reference list was built
 *      from - never touch a score.
 *
 * THE CONFOUND, STATED UP FRONT. The reference list is trials that posted
 * results and the negative set is trials that did not. A recall win here is
 * partly a win at predicting which trials complete and report, which is related
 * to but not the same as which trials mattered. Open decision 3 (a domain-expert
 * reference list) is the fix, and it is not code.
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { indicationsFor } from '../src/lib/indications.js'
import { trialTier } from './lib/trial-deterministic.js'
import { verifyFrozen, recallAtDecile, negativeAtDecile, BASELINE_AS_OF, WINDOW } from './lib/retro.js'
import { scoreTrial } from './score-trials-deterministic.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const COMMIT = process.argv.includes('--commit')
const AS_OF = '2019-12-31'
const RUN_LABEL = 'retro-trials-det'
const RUBRIC_VERSION = '1.0-det'

async function pageAll(sb, table, select, filt = q => q) {
  const out = []
  for (let f = 0; ; f += 1000) {
    const { data, error } = await filt(sb.from(table).select(select)).order('id').range(f, f + 999)
    if (error) { console.error(`${table}: ${error.message}`); process.exit(1) }
    if (!data.length) break
    out.push(...data); if (data.length < 1000) break
  }
  return out
}

async function byIds(sb, table, select, ids) {
  const out = []
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb.from(table).select(select).in('id', ids.slice(i, i + 100))
    if (error) { console.error(`${table}: ${error.message}`); process.exit(1) }
    out.push(...(data || []))
  }
  return out
}

// Exact cumulative log-factorials rather than a Lanczos approximation: the
// holdout is a few hundred items, so the table is trivial to build and there are
// no magic constants to get subtly wrong in a number we then report as a p-value.
const logFact = (() => {
  const t = [0]
  for (let i = 1; i <= 20000; i++) t[i] = t[i - 1] + Math.log(i)
  return t
})()
const lchoose = (n, k) => (k < 0 || k > n) ? -Infinity
  : logFact[n] - logFact[k] - logFact[n - k]

/**
 * P(X >= hit) for X ~ Hypergeometric(N, K, n): the chance a random top decile
 * would contain this many reference items. Recall alone cannot be read without
 * it, because the decile here holds 35 slots for 24 reference items and is
 * therefore capped far below the 1.0 the spec's example implies.
 */
function hyperTail(N, K, n, hit) {
  let p = 0
  for (let i = hit; i <= Math.min(K, n); i++) {
    p += Math.exp(lchoose(K, i) + lchoose(N - K, n - i) - lchoose(N, n))
  }
  return p
}

/** P(a reference item outranks a negative item). Ties count as half. */
function auc(scoreById, refIds, negIds) {
  let wins = 0, ties = 0, n = 0
  for (const r of refIds) {
    const rs = scoreById[r]
    if (rs === undefined) continue
    for (const g of negIds) {
      const gs = scoreById[g]
      if (gs === undefined) continue
      n++
      if (rs > gs) wins++
      else if (rs === gs) ties++
    }
  }
  return n ? { auc: (wins + ties / 2) / n, pairs: n, ties } : { auc: null, pairs: 0, ties: 0 }
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.'); process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  const holdout = JSON.parse(readFileSync(join(__dirname, 'data/retro-holdout.json'), 'utf8'))
  const refIds = holdout.reference.frozen_ids
  const negIds = holdout.negative.frozen_ids

  // Refuse to run against an edited holdout. This is the whole reason the list
  // was frozen: having now seen scores, the test is only meaningful if the
  // answer key provably has not moved.
  for (const [name, list, frozen] of [['reference', refIds, holdout.reference], ['negative', negIds, holdout.negative]]) {
    // freeze() hashes `.id` off each entry, so the bare id list is wrapped.
    if (!verifyFrozen(list.map(id => ({ id })), frozen)) {
      console.error(`FROZEN LIST CHANGED: ${name}. Expected hash ${frozen.hash}. Refusing to run.`)
      process.exit(1)
    }
  }
  console.log(`holdout verified: reference ${refIds.length} (${holdout.reference.hash}), negative ${negIds.length} (${holdout.negative.hash})`)
  console.log(`window ${WINDOW.start}-${WINDOW.end} | baseline ${BASELINE_AS_OF} | composed as of ${AS_OF} | NO model calls\n`)

  // 2016 baseline only. A record established in 2021 is not something a scorer
  // standing in 2016 could have consulted.
  const evidence = await pageAll(sb, 'frontier_records', 'id,indication,current_value,notes,established_date',
    q => q.eq('axis_type', 'evidence').is('superseded_by', null).lte('established_date', BASELINE_AS_OF))
  const evidenceByIndication = {}
  for (const e of evidence) if (e.indication) evidenceByIndication[e.indication] = e
  console.log(`2016 baseline: ${evidence.length} evidence record(s), ${Object.keys(evidenceByIndication).length} indication(s) covered`)

  // Peer counts drive "crowded" in spec 5.2.1. Computed over the WHOLE corpus
  // they would judge a 2017 trial against trials registered years later, so the
  // pool is cut at the as-of date.
  const all = await pageAll(sb, 'news_feed', 'id,metadata', q => q.eq('entry_type', 'trial'))
  const peerCounts = {}
  let inPool = 0
  for (const t of all) {
    const d = t.metadata?.design
    const reg = d?.registrationDate
    if (!d || !reg || String(reg) > AS_OF) continue
    const tier = trialTier(d, t.metadata?.phase)
    if (tier === null) continue
    inPool++
    for (const ind of indicationsFor(t.metadata?.conditions || [])) {
      peerCounts[`${ind}|${tier}`] = (peerCounts[`${ind}|${tier}`] || 0) + 1
    }
  }
  console.log(`peer pool: ${inPool} of ${all.length} trials registered on or before ${AS_OF}\n`)

  const items = await byIds(sb, 'news_feed',
    'id,title,published_at,metadata,facet_function,facet_access,facet_application',
    [...refIds, ...negIds])
  console.log(`loaded ${items.length} of ${refIds.length + negIds.length} holdout items`)

  const scored = [], scoreById = {}
  let skipped = 0
  for (const t of items) {
    const out = scoreTrial(t, evidenceByIndication, peerCounts,
      { asOf: AS_OF, runLabel: RUN_LABEL, rubricVersion: RUBRIC_VERSION })
    if (!out) { skipped++; continue }
    scored.push(out.row)
    scoreById[t.id] = out.row.potential_impact
  }
  console.log(`scored ${scored.length}${skipped ? `, skipped ${skipped} with no design block` : ''}`)

  const ranked = [...scored].sort((a, b) => b.potential_impact - a.potential_impact)
  const rankedIds = ranked.map(r => r.item_id)

  // A ranking where nearly everything ties at zero makes recall an artifact of
  // sort stability, so this is reported before the metrics that depend on it.
  const zero = scored.filter(r => r.potential_impact === 0).length
  const distinct = new Set(scored.map(r => r.potential_impact.toFixed(6))).size
  console.log(`\nSPREAD (read this before the metrics)`)
  console.log(`  zero-scoring:        ${zero}/${scored.length}`)
  console.log(`  distinct values:     ${distinct}`)
  console.log(`  range:               ${ranked[ranked.length - 1].potential_impact.toFixed(4)} .. ${ranked[0].potential_impact.toFixed(4)}`)

  const rec = recallAtDecile(rankedIds, refIds)
  const neg = negativeAtDecile(rankedIds, negIds)
  const a = auc(scoreById, refIds, negIds)

  console.log(`\nRECALL AT TOP DECILE (spec 12, primary)`)
  console.log(`  decile size:         ${rec.decileSize}`)
  console.log(`  reference found:     ${rec.found}/${rec.referenceCount}`)
  console.log(`  recall:              ${rec.recall === null ? 'n/a' : rec.recall.toFixed(3)}`)

  const expected = rec.referenceCount * (rec.decileSize / scored.length)
  const p = hyperTail(scored.length, rec.referenceCount, rec.decileSize, rec.found)
  console.log(`  expected by chance:  ${expected.toFixed(2)}`)
  console.log(`  lift:                ${(rec.found / expected).toFixed(2)}x   (p = ${p < 1e-6 ? p.toExponential(1) : p.toFixed(6)})`)
  console.log(`  NOTE: the decile is ${rec.decileSize} slots for ${rec.referenceCount} reference items, so recall`)
  console.log(`        is structurally capped well below the 1.0 spec 12's example implies.`)

  // Where the misses actually landed. A miss at rank 40 and a miss at rank 300
  // are different failures, and averaging them into one recall number hides that.
  const posOf = Object.fromEntries(rankedIds.map((id, i) => [id, i + 1]))
  const refRanks = refIds.map(id => posOf[id]).filter(Boolean).sort((a, b) => a - b)
  const medianRank = refRanks[Math.floor(refRanks.length / 2)]
  console.log(`  reference ranks:     ${refRanks.join(', ')}`)
  console.log(`  median reference rank ${medianRank} of ${scored.length}`)
  const refZero = refIds.filter(id => scoreById[id] === 0).length
  const negZero = negIds.filter(id => scoreById[id] === 0).length
  console.log(`  scoring zero:        ${refZero}/${refIds.length} reference vs ${negZero}/${negIds.length} negative`)

  console.log(`\nNEGATIVE CASE (spec 12: these should NOT rank highly)`)
  console.log(`  negatives in decile: ${neg.inTopDecile}/${neg.negativeCount}`)
  console.log(`  rate:                ${neg.rate === null ? 'n/a' : neg.rate.toFixed(3)}`)

  console.log(`\nRANK-ORDER AUC (base-rate invariant, survives the enrichment)`)
  console.log(`  P(reference > negative): ${a.auc === null ? 'n/a' : a.auc.toFixed(3)}   over ${a.pairs} pairs, ${a.ties} tied`)
  console.log(`  0.50 = no better than chance`)

  // Zero by construction on this path: nothing here reads prose. Asserted rather
  // than assumed, because it is spec 13's headline number.
  const markers = scored.reduce((n, r) => n + (r.rhetorical_marker_count || 0), 0)
  console.log(`\nHYPE: total rhetorical markers read by the scorer: ${markers} (0 by construction)`)

  const grades = scored.reduce((o, r) => { o[r.evidence_grade] = (o[r.evidence_grade] || 0) + 1; return o }, {})
  const paths = scored.reduce((o, r) => { const k = r.path_taken || 'none'; o[k] = (o[k] || 0) + 1; return o }, {})
  console.log(`\ncontext: grades ${JSON.stringify(grades)}`)
  console.log(`         paths  ${JSON.stringify(paths)}`)

  const pass = a.auc !== null && a.auc > 0.5 && rec.recall !== null
  console.log(`\n=> AUC is ${pass && a.auc > 0.6 ? 'above chance' : a.auc > 0.5 ? 'barely above chance' : 'at or below chance'}.`)
  console.log(`   Spec 12 names recall primary; the confound in the header applies to both.`)

  if (!COMMIT) { console.log(`\nNot stored. Pass --commit to persist under run_label "${RUN_LABEL}".`); return }
  for (let i = 0; i < scored.length; i += 100) {
    const { error } = await sb.from('impact_scores')
      .upsert(scored.slice(i, i + 100), { onConflict: 'item_type,item_id,rubric_version,run_label' })
    if (error) { console.error('store failed:', error.message); process.exit(1) }
  }
  console.log(`\n✓ stored ${scored.length} score(s) under run_label "${RUN_LABEL}".`)
}

run().catch(e => { console.error(e); process.exit(1) })
