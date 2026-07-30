/**
 * score-trials-deterministic.js — score every indexed trial with NO model call.
 *
 *   node --env-file=.env scripts/score-trials-deterministic.js            # dry run
 *   node --env-file=.env scripts/score-trials-deterministic.js --commit
 *
 * Requires migrations 013 and 015.
 *
 * Same validators, same composition, same storage as the model path: only the
 * scoring step differs. That is the point of the Phase 4 design constraint that
 * the scorer takes its inputs as arguments; the deterministic scorer drops into
 * the same slot.
 *
 * WHY THIS EXISTS. 8,216 of 8,345 indexed trials carry everything spec 5.3.2
 * needs, because we ingested the registry's design block. The model path scored
 * 20 of them before the API credit ran out. This scores all of them for nothing.
 *
 * It is STRICTER on spec 2, not looser. No unanchored importance question is
 * possible because there is no model to ask; rhetorical markers cannot raise a
 * score because nothing reads them; every referent is the registry field that
 * produced the number. The marker/impact correlation is zero by construction.
 *
 * Rows are written under rubric_version "1.0-det" so a deterministic score is
 * never mistaken for a model one in monitoring or in the inspection view.
 */
import { createClient } from '@supabase/supabase-js'
import { indicationsFor, INDICATION_LABEL } from '../src/lib/indications.js'
import { subfieldFor } from '../src/lib/subfields.js'
import { validate } from '../src/lib/validate.js'
import { compose, tagsFor, horizonFor } from '../src/lib/compose.js'
import {
  designGrade, gapFor, gateFor, methFor, translationalDistance, reasonFor, trialTier,
} from './lib/trial-deterministic.js'

const COMMIT = process.argv.includes('--commit')
const RUBRIC_VERSION = '1.0-det'
const RUN_LABEL = 'live'

// PAGINATED WITH AN EXPLICIT ORDER. Postgres does not guarantee a stable row
// order across .range() calls without ORDER BY, so pages overlap and gap:
// a deterministic run produced 301 duplicate trial rows and 212 duplicate
// research rows that way, while silently missing others.
async function pageAll(sb, table, select, filt = q => q) {
  const out = []
  for (let f = 0; ; f += 1000) {
    const { data, error } = await filt(sb.from(table).select(select)).order('id').range(f, f + 999)
    if (error) {
      console.error(`${table}: ${error.message}`)
      if (/schema cache|does not exist/i.test(error.message)) console.error('Apply migrations 013 and 015 first.')
      process.exit(1)
    }
    if (!data.length) break
    out.push(...data); if (data.length < 1000) break
  }
  return out
}

/** One trial, end to end. Pure: no I/O, no model. */
export function scoreTrial(trial, evidenceByIndication, peerCounts = {}) {
  const m = trial.metadata || {}
  const design = m.design
  if (!design) return null

  const indications = indicationsFor(m.conditions || [])
  const indication = indications.find(i => evidenceByIndication[i]) || indications[0] || null
  const record = indication ? evidenceByIndication[indication] : null

  const grade = designGrade(design, m.phase)
  const tier = trialTier(design, m.phase)
  const peers = indication && tier !== null ? (peerCounts[`${indication}|${tier}`] ?? null) : null
  const GAP = gapFor({ design, phase: m.phase }, record, peers)
  const GATE = gateFor({ phase: m.phase, design })
  const METH = methFor({ design })
  const td = translationalDistance(m.phase)

  const forValidation = {
    entity_type: 'trial',
    GAP: { score: GAP.score, justification: GAP.justification, referent: GAP.referent },
    GATE: { score: GATE.score, justification: GATE.justification, referent: GATE.referent, unlocks: GATE.unlocks },
    METH: { score: METH.score, justification: METH.justification, referent: METH.referent },
    frontier_records_consulted: GAP.consulted,
    translational_distance: td,
    evidence_grade: grade.grade,
    // A registered trial has demonstrated nothing yet by definition; the design
    // is what it can establish. gapFlagged is entity-aware and exempts trials.
    claimed: trial.title || null,
    demonstrated: grade.grade === 'announced-only' ? null
      : `A ${grade.referent} able to establish its registered primary outcome.`,
    tags: [],
    user_facing_reason: reasonFor({
      design, phase: m.phase,
      indicationLabel: indication ? INDICATION_LABEL[indication] : null,
      gap: GAP, grade: grade.grade,
    }),
  }
  forValidation.tags = tagsFor(forValidation)

  const { score: validated, resets } = validate(forValidation, { itemId: trial.id })
  const composed = compose({
    ...validated, entity_type: 'trial',
    recency_date: m.lastChanged || trial.published_at,
  })

  return {
    row: {
      item_type: 'news_feed', item_id: trial.id, entity_type: 'trial',
      subfield: subfieldFor(trial) || null,
      rubric_version: RUBRIC_VERSION, model: null,
      potential_impact: composed.potential_impact,
      path_taken: composed.path_taken, base: composed.base,
      multiplier: composed.multiplier, recency: composed.recency,
      gap: validated.GAP, gate: validated.GATE, meth: validated.METH,
      translational_distance: validated.translational_distance,
      evidence_grade: validated.evidence_grade, evidence_variant: 'trial_design',
      uncertainty: record ? 'medium' : 'high',
      frontier_records_consulted: validated.frontier_records_consulted,
      gates_triggered: composed.gated ? [composed.gated] : [],
      flags: m.sponsorClass === 'INDUSTRY' ? ['industry_sponsored'] : [],
      ceilings_applied: [], fd_ceiling: null,
      input_granularity: 'registry',
      claim_vs_demonstration: {
        claimed: forValidation.claimed, demonstrated: forValidation.demonstrated,
        gap_flagged: !!validated.gap_flagged,
      },
      gap_flagged: !!validated.gap_flagged,
      // Zero by construction: nothing in this path reads prose.
      rhetorical_marker_count: 0,
      user_facing_reason: validated.user_facing_reason,
      reason_from_template: true,
      tags: tagsFor(validated), horizon: horizonFor(validated.translational_distance),
      run_label: RUN_LABEL,
    },
    resets: resets.map(r => ({
      item_type: 'news_feed', item_id: trial.id, run_label: RUN_LABEL,
      rule: r.rule, field: r.field,
      from_value: r.from == null ? null : String(r.from),
      to_value: r.to == null ? null : String(r.to),
      note: r.note,
    })),
  }
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.'); process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  const evidence = await pageAll(sb, 'frontier_records_live',
    'id,indication,current_value,notes', q => q.eq('axis_type', 'evidence'))
  const evidenceByIndication = {}
  for (const e of evidence) if (e.indication) evidenceByIndication[e.indication] = e

  const trials = await pageAll(sb, 'news_feed',
    'id,title,published_at,metadata,facet_function,facet_access,facet_application',
    q => q.eq('entry_type', 'trial'))

  console.log(`${trials.length} trials | ${evidence.length} evidence records | NO model calls`)

  // Count how many trials share an indication AND a design tier, so "crowded"
  // in spec 5.2.1 is measured rather than assumed. Without this every trial that
  // merely MATCHED the strongest recorded design was called incremental, which
  // zeroed most of the corpus: the evidence record is drawn from this same pool
  // and is therefore almost never beaten.
  const peerCounts = {}
  for (const t of trials) {
    const d = t.metadata?.design
    if (!d) continue
    const tier = trialTier(d, t.metadata?.phase)
    if (tier === null) continue
    for (const ind of indicationsFor(t.metadata?.conditions || [])) {
      peerCounts[`${ind}|${tier}`] = (peerCounts[`${ind}|${tier}`] || 0) + 1
    }
  }

  const rows = [], allResets = []
  let skipped = 0
  for (const t of trials) {
    const out = scoreTrial(t, evidenceByIndication, peerCounts)
    if (!out) { skipped++; continue }
    rows.push(out.row); allResets.push(...out.resets)
  }
  console.log(`scored ${rows.length}, skipped ${skipped} with no registry design block\n`)

  const tally = (a, k) => a.reduce((o, r) => { const v = r[k] ?? 'none'; o[v] = (o[v] || 0) + 1; return o }, {})
  console.log('  evidence grade:', tally(rows, 'evidence_grade'))
  console.log('  path split:    ', tally(rows, 'path_taken'))
  console.log('  horizon:       ', tally(rows, 'horizon'))
  const nz = rows.filter(r => r.potential_impact > 0)
  const sorted = [...rows].sort((a, b) => b.potential_impact - a.potential_impact)
  console.log(`  non-zero: ${nz.length}/${rows.length} | range ${sorted[sorted.length - 1].potential_impact.toFixed(3)} .. ${sorted[0].potential_impact.toFixed(3)}`)
  console.log(`  with a consulted record: ${rows.filter(r => (r.frontier_records_consulted || []).length).length}`)
  const byRule = {}
  for (const r of allResets) byRule[r.rule] = (byRule[r.rule] || 0) + 1
  console.log('  section 8 resets:', Object.keys(byRule).length ? byRule : 'none')

  console.log('\n  top 5:')
  for (const t of sorted.slice(0, 5)) {
    console.log(`    ${t.potential_impact.toFixed(2)} [${t.path_taken}] ${(t.tags || []).join(', ') || 'no tags'}`)
    console.log(`         ${String(t.user_facing_reason).slice(0, 120)}`)
  }

  if (!COMMIT) { console.log('\nDry run. Nothing written. Re-run with --commit.'); return }

  // The model path scored a handful of trials before the credit ran out. Those
  // rows carry a different rubric_version, so leaving them would put two rows in
  // the same run_label for one item and double it in the sort.
  const { error: delErr, count } = await sb.from('impact_scores')
    .delete({ count: 'exact' }).eq('run_label', RUN_LABEL).eq('entity_type', 'trial').eq('rubric_version', '1.0')
  if (delErr) { console.error('cleanup failed:', delErr.message); process.exit(1) }
  console.log(`\nremoved ${count ?? 0} model-scored trial row(s) so each trial has exactly one score`)

  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await sb.from('impact_scores')
      .upsert(rows.slice(i, i + 100), { onConflict: 'item_type,item_id,rubric_version,run_label' })
    if (error) { console.error('upsert failed:', error.message); process.exit(1) }
    process.stdout.write(`\r  stored ${Math.min(i + 100, rows.length)}/${rows.length}`)
  }
  process.stdout.write('\n')
  for (let i = 0; i < allResets.length; i += 100) {
    const { error } = await sb.from('impact_score_resets').insert(allResets.slice(i, i + 100))
    if (error) { console.error('reset log failed:', error.message); break }
  }
  console.log(`✓ stored ${rows.length} trial score(s) under rubric ${RUBRIC_VERSION}, ${allResets.length} reset(s).`)
}

if (process.argv[1] && process.argv[1].endsWith('score-trials-deterministic.js')) {
  run().catch(e => { console.error(e); process.exit(1) })
}
