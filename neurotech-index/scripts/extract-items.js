/**
 * extract-items.js — run the extraction pass over indexed items. Spec 7.2.
 *
 *   node --env-file=.env scripts/extract-items.js --sample 50            # dry run
 *   node --env-file=.env scripts/extract-items.js --sample 50 --commit
 *   node --env-file=.env scripts/extract-items.js --type trial --sample 20 --commit
 *
 * Requires migration 013.
 *
 * Pass one of two. It separates what an item claims from what it demonstrates,
 * and stores that separately from any score, so a rescore under a new rubric
 * does not have to pay for extraction again.
 *
 * DEFAULTS TO A SAMPLE, NOT THE CORPUS. Extracting all 83,958 papers is a large
 * spend and Phase 3 acceptance only needs 50 items. Pass --all deliberately.
 */
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import {
  EXTRACTION_TOOL, EXTRACTION_PROMPT, TRIAL_INFERENCE_TOOL, TRIAL_INFERENCE_PROMPT,
  EXTRACTOR_VERSION, ENTITY_NOTES, shapeExtraction, gapFlagged, trialDesignFrom, inputFor,
} from './lib/extract.js'

const COMMIT = process.argv.includes('--commit')
const ALL = process.argv.includes('--all')
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d }
const SAMPLE = Number(argOf('--sample', 50))
const TYPE = argOf('--type', null)
const MODEL = argOf('--model', 'claude-sonnet-5')
const CONCURRENCY = 6
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function withRetry(fn, label, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try { return await fn() } catch (err) {
      const transient = [429, 500, 502, 503, 529].includes(err.status)
      if (!transient || i === attempts - 1) throw err
      await sleep(1500 * 2 ** i)
    }
  }
}

/** Extract one item. Returns the row to store, or null if there was nothing to read. */
export async function extractItem(anthropic, item, entityType) {
  const input = inputFor(item, entityType)
  if (!input) return null

  const resp = await withRetry(() => anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: 'tool', name: EXTRACTION_TOOL.name },
    messages: [{
      role: 'user',
      content: EXTRACTION_PROMPT
        .replace('{entity_note}', ENTITY_NOTES[entityType] || '')
        .replace('{entity_type}', entityType)
        .replace('{granularity}', input.granularity)
        .replace('{content}', input.content.slice(0, 12000)),
    }],
  }), item.id)

  const block = resp.content?.find(c => c.type === 'tool_use')
  if (!block) return null
  const extraction = shapeExtraction(block.input)

  // Trials get a second, deliberately narrow call for the only two design facts
  // the registration does not state. Everything else is copied, not inferred.
  let trialDesign = null
  if (entityType === 'trial' && item.metadata?.design) {
    let inference = null
    try {
      const r = await withRetry(() => anthropic.messages.create({
        model: MODEL,
        max_tokens: 600,
        tools: [TRIAL_INFERENCE_TOOL],
        tool_choice: { type: 'tool', name: TRIAL_INFERENCE_TOOL.name },
        messages: [{
          role: 'user',
          content: TRIAL_INFERENCE_PROMPT
            .replace('{design}', JSON.stringify(item.metadata.design, null, 1).slice(0, 4000))
            .replace('{enrollment}', String(item.metadata.enrollment ?? 'not stated'))
            .replace('{summary}', (item.summary || '').slice(0, 3000)),
        }],
      }), `${item.id}:inference`)
      inference = r.content?.find(c => c.type === 'tool_use')?.input || null
    } catch { inference = null }
    trialDesign = trialDesignFrom(item.metadata, inference)
  }

  return {
    item_type: entityType === 'research' ? 'papers' : entityType === 'device' ? 'devices' : 'news_feed',
    item_id: item.id,
    entity_type: entityType,
    ...extraction,
    gap_flagged: gapFlagged(extraction, entityType),
    trial_design: trialDesign,
    input_granularity: input.granularity,
    extractor_version: EXTRACTOR_VERSION,
    model: MODEL,
  }
}

export async function loadItems(sb, sampleOverride = null) {
  const out = []
  const want = ALL ? Infinity : (sampleOverride ?? SAMPLE)
  const types = TYPE ? [TYPE] : ['research', 'trial', 'device', 'feed']
  // An even spread across entity types, so the sample cannot be all papers.
  const per = Math.max(1, Math.ceil(want / types.length))

  for (const t of types) {
    if (t === 'research') {
      const { data } = await sb.from('papers')
        .select('id,title,abstract,year,doi,url,source_url')
        .eq('in_scope', true).gte('year', 2020).limit(ALL ? 1000 : per * 3)
      for (const r of (data || []).filter(r => (r.abstract || '').length > 200).slice(0, per)) {
        out.push({ item: r, entityType: 'research' })
      }
    } else if (t === 'trial') {
      const { data } = await sb.from('news_feed')
        .select('id,title,summary,url,metadata').eq('entry_type', 'trial').limit(ALL ? 1000 : per * 3)
      for (const r of (data || []).filter(r => r.metadata?.design).slice(0, per)) {
        out.push({ item: r, entityType: 'trial' })
      }
    } else if (t === 'device') {
      const { data } = await sb.from('devices')
        .select('id,name,description,url,source_url').eq('in_scope', true).limit(ALL ? 1000 : per * 3)
      for (const r of (data || []).filter(r => (r.description || '').length > 120).slice(0, per)) {
        out.push({ item: { ...r, title: r.name }, entityType: 'device' })
      }
    } else {
      const { data } = await sb.from('news_feed')
        .select('id,title,summary,url,metadata').neq('entry_type', 'trial').limit(ALL ? 1000 : per * 3)
      for (const r of (data || []).filter(r => (r.summary || '').length > 150).slice(0, per)) {
        out.push({ item: r, entityType: 'feed' })
      }
    }
  }
  return ALL ? out : out.slice(0, want)
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.ANTHROPIC_API_KEY) {
    console.error('SUPABASE_URL, SUPABASE_SERVICE_KEY and ANTHROPIC_API_KEY are required.')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const items = await loadItems(sb)
  console.log(`${items.length} item(s) to extract, model ${MODEL}, version ${EXTRACTOR_VERSION}.`)
  const byType = {}
  for (const i of items) byType[i.entityType] = (byType[i.entityType] || 0) + 1
  console.log('  by entity type:', byType)

  const rows = []
  let failed = 0
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const chunk = items.slice(i, i + CONCURRENCY)
    const results = await Promise.all(chunk.map(async ({ item, entityType }) => {
      try { return await extractItem(anthropic, item, entityType) }
      catch (err) { failed++; if (failed <= 3) console.error(`\n  ! ${item.id}: ${err.status || ''} ${err.message}`); return null }
    }))
    for (const r of results) if (r) rows.push(r)
    process.stdout.write(`\r  extracted ${rows.length}/${items.length}${failed ? ` (${failed} failed)` : ''}`)
  }
  process.stdout.write('\n')

  // ── Report ────────────────────────────────────────────────────────────────
  const gaps = rows.filter(r => r.gap_flagged).length
  const noEvidence = rows.filter(r => !r.demonstrated).length
  const withNumbers = rows.filter(r => r.quantitative_results.length).length
  const withArtifacts = rows.filter(r => r.artifacts_released.length).length
  const namedBeneficiary = rows.filter(r => r.constraints_addressed.some(c => c.who_else_is_blocked)).length
  const markers = rows.reduce((a, r) => a + r.rhetorical_markers.length, 0)
  const byGran = {}
  for (const r of rows) byGran[r.input_granularity] = (byGran[r.input_granularity] || 0) + 1

  console.log(`\n${rows.length} extraction(s).`)
  console.log(`  claimed and demonstrated diverge (gap_flagged): ${gaps}`)
  console.log(`  nothing demonstrated at all:                    ${noEvidence}`)
  console.log(`  with quantitative results:                      ${withNumbers}`)
  console.log(`  with released artifacts:                        ${withArtifacts}`)
  console.log(`  naming a beneficiary other than the authors:    ${namedBeneficiary}`)
  console.log(`  rhetorical markers recorded:                    ${markers}`)
  console.log('  input granularity:', byGran)

  // Per entity type. An aggregate rate hides the thing worth knowing: a device
  // registry entry and a company announcement genuinely demonstrate nothing, so
  // their gap rate SHOULD be high, while a high rate on research would mean the
  // extractor is failing to read evidence that is there.
  console.log('\n  entity type   n   gap   no evidence   with numbers')
  for (const t of ['research', 'device', 'trial', 'feed']) {
    const s = rows.filter(r => r.entity_type === t)
    if (!s.length) continue
    console.log(`  ${t.padEnd(12)} ${String(s.length).padStart(2)}  ${String(s.filter(r => r.gap_flagged).length).padStart(3)}   ` +
      `${String(s.filter(r => !r.demonstrated).length).padStart(11)}   ${String(s.filter(r => r.quantitative_results.length).length).padStart(12)}`)
  }

  const trials = rows.filter(r => r.trial_design)
  if (trials.length) {
    const nullInterp = trials.filter(r => r.trial_design.null_interpretable === true).length
    const unknown = trials.filter(r => r.trial_design.null_interpretable === null).length
    console.log(`  trials with an interpretable null:              ${nullInterp}/${trials.length} (${unknown} could not say)`)
  }

  if (!COMMIT) {
    console.log('\nDry run. Nothing written. Re-run with --commit.')
    for (const r of rows.slice(0, 3)) {
      console.log(`\n  [${r.entity_type}] ${r.input_granularity}${r.gap_flagged ? '  GAP FLAGGED' : ''}`)
      console.log(`    claimed:      ${String(r.claimed).slice(0, 180)}`)
      console.log(`    demonstrated: ${r.demonstrated ? String(r.demonstrated).slice(0, 180) : '(nothing disclosed)'}`)
    }
    return
  }

  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await sb.from('item_extractions')
      .upsert(rows.slice(i, i + 50), { onConflict: 'item_type,item_id,extractor_version' })
    if (error) {
      console.error('upsert failed:', error.message)
      if (/schema cache|does not exist/i.test(error.message)) console.error('Apply migration 013 first.')
      process.exit(1)
    }
  }
  console.log(`\n✓ stored ${rows.length} extraction(s).`)
}

if (process.argv[1] && process.argv[1].endsWith('extract-items.js')) {
  run().catch(e => { console.error(e); process.exit(1) })
}
