/**
 * score-items.js — Phase 4 runner. Spec 7.3, 7.4 and 6, in that order.
 *
 *   node --env-file=.env scripts/score-items.js --sample 50            # dry run
 *   node --env-file=.env scripts/score-items.js --sample 50 --commit
 *   node --env-file=.env scripts/score-items.js --run-label retro-2016 --as-of 2019-12-31 \
 *        --records-as-of 2016-01-01 --commit
 *
 * Requires migrations 013 and 015.
 *
 * THE ORDER MATTERS AND IS NOT NEGOTIABLE:
 *   1. retrieve  records for the item's subfield, and the coverage ceiling
 *   2. score     one model call, comparison only (scripts/lib/score.js)
 *   3. cap       deterministic ceilings, in code
 *   4. validate  the eight section 8 rules, in code
 *   5. compose   multiplicative, in code (src/lib/compose.js)
 * Everything after step 2 is deterministic. The model never sees the ceilings as
 * negotiable and never touches the composition.
 *
 * --records-as-of is what makes Phase 5 possible: it filters the record set to
 * what existed at a date, so a 2017 item can be scored against 2016 field state
 * instead of today's. Spec 12: scoring 2017 items against 2026 records "inverts
 * the entire exercise".
 */
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { subfieldFor } from '../src/lib/subfields.js'
import { fdCeilingFor } from '../src/lib/frontier-coverage.js'
import { validate } from '../src/lib/validate.js'
import { compose, tagsFor, horizonFor } from '../src/lib/compose.js'
import { buildPrompt, applyCeilings, SCORING_TOOL, RUBRIC_VERSION } from './lib/score.js'
import { GRANULARITY_CAPS } from './lib/caps.js'

const COMMIT = process.argv.includes('--commit')
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d }
const SAMPLE = Number(argOf('--sample', 50))
const RUN_LABEL = argOf('--run-label', 'live')
const AS_OF = argOf('--as-of', null)
const RECORDS_AS_OF = argOf('--records-as-of', null)
const MODEL = argOf('--model', 'claude-sonnet-5')
const CONCURRENCY = 5
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function withRetry(fn, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try { return await fn() } catch (err) {
      if (![429, 500, 502, 503, 529].includes(err.status) || i === attempts - 1) throw err
      await sleep(1500 * 2 ** i)
    }
  }
}

const arr = v => (Array.isArray(v) ? v : typeof v === 'string' ? (() => { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] } })() : [])

/** One item, end to end. Pure of I/O except the single model call. */
export async function scoreOne(anthropic, { extraction, item, entityType, subfield, records, axisPairs, asOf }) {
  const fdCeiling = fdCeilingFor(records, subfield)
  const granularityCap = GRANULARITY_CAPS[extraction.input_granularity] || GRANULARITY_CAPS.metadata

  const resp = await withRetry(() => anthropic.messages.create({
    model: MODEL,
    max_tokens: 2500,
    tools: [SCORING_TOOL(entityType)],
    tool_choice: { type: 'tool', name: 'record_scores' },
    messages: [{ role: 'user', content: buildPrompt({ extraction, entityType, records, axisPairs, fdCeiling }) }],
  }))
  const raw = resp.content?.find(c => c.type === 'tool_use')?.input
  if (!raw) return null

  // 3. cap
  const { scores: capped, capped: ceilingsApplied } = applyCeilings(raw, { fdCeiling, granularityCap })

  // 4. validate
  const forValidation = {
    ...capped,
    entity_type: entityType,
    claimed: extraction.claimed,
    demonstrated: extraction.demonstrated,
    gap_flagged: extraction.gap_flagged,
    frontier_records_consulted: arr(capped.frontier_records_consulted),
    tags: [],
  }
  forValidation.tags = tagsFor(forValidation)
  const { score: validated, resets } = validate(forValidation, { itemId: item.id })

  // 5. compose
  const composed = compose({
    ...validated,
    entity_type: entityType,
    recency_date: item.recency_date,
  }, { asOf })

  const tags = tagsFor(validated)
  return {
    row: {
      item_type: extraction.item_type,
      item_id: item.id,
      entity_type: entityType,
      subfield: subfield || null,
      rubric_version: RUBRIC_VERSION,
      extractor_version: extraction.extractor_version,
      model: MODEL,
      potential_impact: composed.potential_impact,
      path_taken: composed.path_taken,
      base: composed.base,
      multiplier: composed.multiplier,
      recency: composed.recency,
      fd: validated.FD || null, lv: validated.LV || null, tr: validated.TR || null,
      gap: validated.GAP || null, gate: validated.GATE || null, meth: validated.METH || null,
      translational_distance: validated.translational_distance ?? null,
      evidence_grade: validated.evidence_grade || null,
      evidence_variant: entityType === 'trial' ? 'trial_design' : 'standard',
      uncertainty: validated.uncertainty || null,
      frontier_records_consulted: validated.frontier_records_consulted,
      record_update_proposed: validated.record_update_proposed || null,
      gates_triggered: composed.gated ? [composed.gated] : [],
      flags: extraction.trial_design?.sponsor_type === 'INDUSTRY' ? ['industry_sponsored'] : [],
      ceilings_applied: ceilingsApplied,
      fd_ceiling: fdCeiling,
      input_granularity: extraction.input_granularity,
      claim_vs_demonstration: {
        claimed: extraction.claimed, demonstrated: extraction.demonstrated,
        gap_flagged: !!validated.gap_flagged,
      },
      gap_flagged: !!validated.gap_flagged,
      rhetorical_marker_count: arr(extraction.rhetorical_markers).length,
      user_facing_reason: validated.user_facing_reason || null,
      reason_from_template: !!validated.reason_from_template,
      tags,
      horizon: horizonFor(validated.translational_distance),
      run_label: RUN_LABEL,
    },
    resets: resets.map(r => ({
      item_type: extraction.item_type, item_id: item.id, run_label: RUN_LABEL,
      rule: r.rule, field: r.field,
      from_value: r.from == null ? null : String(r.from),
      to_value: r.to == null ? null : String(r.to),
      note: r.note,
    })),
  }
}

async function pageAll(sb, table, select, filt = q => q) {
  const out = []
  for (let f = 0; ; f += 1000) {
    const { data, error } = await filt(sb.from(table).select(select)).range(f, f + 999)
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

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.ANTHROPIC_API_KEY) {
    console.error('SUPABASE_URL, SUPABASE_SERVICE_KEY and ANTHROPIC_API_KEY are required.')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // ── 1. retrieve ───────────────────────────────────────────────────────────
  let recQ = q => q.is('superseded_by', null)
  if (RECORDS_AS_OF) {
    // Field state AS OF a date. This is the whole mechanism behind Phase 5.
    recQ = q => q.is('superseded_by', null).lte('established_date', RECORDS_AS_OF)
  }
  const allRecords = await pageAll(sb, 'frontier_records',
    'id,subfield,axis,axis_type,indication,current_value,confidence,established_date', recQ)
  const allPairs = await pageAll(sb, 'frontier_axis_pairs_live',
    'subfield,axis_a,axis_b,why_binding')
  const extractions = await pageAll(sb, 'item_extractions', '*')

  console.log(`run "${RUN_LABEL}" | rubric ${RUBRIC_VERSION} | model ${MODEL}`)
  console.log(`  frontier records: ${allRecords.length}${RECORDS_AS_OF ? ` (as of ${RECORDS_AS_OF})` : ''}`)
  console.log(`  axis pairs:       ${allPairs.length}`)
  console.log(`  extractions:      ${extractions.length}`)
  if (AS_OF) console.log(`  recency as of:    ${AS_OF}`)
  if (!extractions.length) { console.error('No extractions. Run extract-items.js --commit first.'); process.exit(1) }

  // Resolve each extraction's item and subfield.
  const byType = { papers: [], devices: [], news_feed: [] }
  for (const e of extractions) byType[e.item_type]?.push(e.item_id)
  const items = {}
  for (const [table, ids] of Object.entries(byType)) {
    if (!ids.length) continue
    const cols = table === 'papers' ? 'id,title,year,facet_function,facet_access,facet_application'
      : table === 'devices' ? 'id,name,year,last_updated,facet_function,facet_access,facet_application'
      : 'id,title,published_at,metadata,facet_function,facet_access,facet_application'
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await sb.from(table).select(cols).in('id', ids.slice(i, i + 200))
      for (const r of data || []) items[`${table}:${r.id}`] = r
    }
  }

  const work = extractions.slice(0, SAMPLE).map(e => {
    const item = items[`${e.item_type}:${e.item_id}`]
    if (!item) return null
    const subfield = subfieldFor(item)
    const recency_date = item.year ? `${item.year}-01-01`
      : item.published_at || item.last_updated || null
    return {
      extraction: e, entityType: e.entity_type, subfield,
      item: { ...item, recency_date },
      records: allRecords.filter(r => r.subfield === subfield),
      axisPairs: allPairs.filter(p => p.subfield === subfield),
      asOf: AS_OF,
    }
  }).filter(Boolean)

  console.log(`\nscoring ${work.length} item(s)...`)

  // ── 2-5 ───────────────────────────────────────────────────────────────────
  const rows = [], allResets = []
  let failed = 0
  for (let i = 0; i < work.length; i += CONCURRENCY) {
    const chunk = work.slice(i, i + CONCURRENCY)
    const out = await Promise.all(chunk.map(async w => {
      try { return await scoreOne(anthropic, w) }
      catch (err) { failed++; if (failed <= 3) console.error(`\n  ! ${w.item.id}: ${err.status || ''} ${err.message}`); return null }
    }))
    for (const r of out) if (r) { rows.push(r.row); allResets.push(...r.resets) }
    process.stdout.write(`\r  scored ${rows.length}/${work.length}${failed ? ` (${failed} failed)` : ''}`)
  }
  process.stdout.write('\n')

  report(rows, allResets)

  if (!COMMIT) { console.log('\nDry run. Nothing written. Re-run with --commit.'); return }
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await sb.from('impact_scores')
      .upsert(rows.slice(i, i + 50), { onConflict: 'item_type,item_id,rubric_version,run_label' })
    if (error) { console.error('upsert failed:', error.message); process.exit(1) }
  }
  if (allResets.length) {
    for (let i = 0; i < allResets.length; i += 100) {
      const { error } = await sb.from('impact_score_resets').insert(allResets.slice(i, i + 100))
      if (error) { console.error('reset log insert failed:', error.message); process.exit(1) }
    }
  }
  console.log(`\n✓ stored ${rows.length} score(s) and ${allResets.length} reset(s) under run "${RUN_LABEL}".`)
}

/** Spec 13 monitoring, emitted from the first scored batch, not retrofitted. */
export function report(rows, resets) {
  if (!rows.length) return
  console.log(`\n${rows.length} score(s).`)

  const paths = {}
  for (const r of rows) paths[r.path_taken || 'none'] = (paths[r.path_taken || 'none'] || 0) + 1
  console.log('  path split:', paths)
  const leverageish = (paths.leverage || 0) + (paths.gate || 0)
  if (!leverageish) {
    console.log('    ! nothing took the leverage or gate path. Spec 6 built them for the')
    console.log('      boring-but-important category; zero means that machinery is idle.')
  }

  const ent = {}, gran = {}
  for (const r of rows) {
    ent[r.entity_type] = (ent[r.entity_type] || 0) + 1
    gran[r.input_granularity] = (gran[r.input_granularity] || 0) + 1
  }
  console.log('  entity type:', ent)
  console.log('  granularity:', gran)

  // The single most important number in spec 13.
  const n = rows.length
  const xs = rows.map(r => r.rhetorical_marker_count)
  const ys = rows.map(r => r.potential_impact)
  console.log(`  marker/impact correlation: ${pearson(xs, ys).toFixed(3)}  (should sit near zero)`)

  const capped = rows.filter(r => (r.ceilings_applied || []).length).length
  console.log(`  items with a ceiling applied: ${capped}/${n}`)
  console.log(`  gap flagged: ${rows.filter(r => r.gap_flagged).length}/${n}`)
  console.log(`  ranked on a claim (no data released tag): ${rows.filter(r => (r.tags || []).includes('No data released')).length}`)

  const byRule = {}
  for (const r of resets) byRule[r.rule] = (byRule[r.rule] || 0) + 1
  console.log('  section 8 resets by rule:', Object.keys(byRule).length ? byRule : 'none')

  const top = [...rows].sort((a, b) => b.potential_impact - a.potential_impact).slice(0, 5)
  console.log('\n  top 5:')
  for (const t of top) {
    console.log(`    ${t.potential_impact.toFixed(2)} [${t.entity_type}/${t.path_taken}] ${(t.tags || []).join(', ') || 'no tags'}`)
    console.log(`         ${String(t.user_facing_reason || '').slice(0, 110)}`)
  }
}

export function pearson(xs, ys) {
  const n = xs.length
  if (n < 2) return 0
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my
    num += a * b; dx += a * a; dy += b * b
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0
}

if (process.argv[1] && process.argv[1].endsWith('score-items.js')) {
  run().catch(e => { console.error(e); process.exit(1) })
}
