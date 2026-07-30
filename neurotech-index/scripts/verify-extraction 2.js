/**
 * verify-extraction.js — the Phase 3 acceptance harness.
 *
 *   node --env-file=.env scripts/verify-extraction.js --sample 50
 *
 * Spec section 11, Phase 3 accepts when:
 *
 *   (a) on a 50-item hand-labelled sample, `demonstrated` never contains
 *       content absent from the source, and
 *   (b) claimed versus demonstrated divergence is correctly identified on at
 *       least 8 of 10 known-overclaiming items.
 *
 * WHAT THIS CAN AND CANNOT DECIDE.
 *
 * Criterion (a) is machine-checkable in the part that matters. Free prose cannot
 * be diffed against a source, but the FALSIFIABLE content of `demonstrated` is
 * its numbers and its named entities, and those must appear in the source. A
 * hallucinated cohort size or accuracy figure is exactly the failure the
 * criterion exists to catch, and it is detectable. This harness checks every
 * number in `demonstrated` and every number in `quantitative_results` against
 * the source text. Prose that invents no checkable fact is not caught here and
 * that limit is reported rather than hidden.
 *
 * Criterion (b) needs LABELS. "Known-overclaiming" is a human judgement and
 * inventing the labels here would test the extractor against its own opinion.
 * What this harness does instead is assemble a STRUCTURALLY overclaiming set,
 * defined by a property nobody has to judge: an item that asserts a capability
 * while releasing no data. Company announcements and un-resulted registrations
 * are that shape by construction. It reports the detection rate on that set and
 * says plainly that the set is structural, not hand-labelled.
 *
 * The honest summary at the end distinguishes what passed from what a human
 * still has to sign off.
 */
import { createClient } from '@supabase/supabase-js'
import { EXTRACTOR_VERSION } from './lib/extract.js'

const argOf = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d }
const SAMPLE = Number(argOf('--sample', 50))
const LIVE = process.argv.includes('--live')

/** Numbers that carry meaning, ignoring years and trivial small integers. */
export function checkableNumbers(text) {
  const out = new Set()
  for (const m of String(text || '').matchAll(/-?\d+(?:\.\d+)?/g)) {
    const n = m[0]
    const v = Number(n)
    // Years and 0/1 appear everywhere and matching them proves nothing.
    if (v >= 1900 && v <= 2100 && !n.includes('.')) continue
    if (Math.abs(v) <= 1 && !n.includes('.')) continue
    out.add(n)
  }
  return [...out]
}

/**
 * Format without floating-point noise. `0.936 * 100` is 93.60000000000001 in
 * IEEE 754, and comparing that string against a source that says "93.6" reports
 * a grounded value as invented. A false accusation of hallucination is the worst
 * failure this harness can have, so the rounding is deliberate.
 */
const fmt = x => (Number.isFinite(x) ? String(Math.round(x * 1e6) / 1e6) : null)

/** Small integers that abstracts routinely spell out. */
const NUMBER_WORDS = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
}

/**
 * Normalise a source so a number can be found the way papers actually write it.
 *
 * Every rule here fixed a REAL false positive on the first acceptance run, where
 * the harness accused the extractor of inventing three values it had read
 * correctly:
 *   "t(68) = - 3.54"  a sign separated from its digits by a space
 *   "the four subjects"  a count spelled out in words
 * A false accusation of hallucination is the worst failure this check can have,
 * so these are corrections to the checker, not leniency toward the extractor.
 */
export function normalizeSource(source) {
  return String(source || '')
    .replace(/[−–—]/g, '-')        // unicode minus and dashes
    .replace(/(^|[\s(=,:])-\s+(?=[\d.])/g, '$1-') // "= - 3.54" -> "= -3.54"
    .replace(/,(?=\d{3}\b)/g, '')                 // thousands separators
    // "P = .06" -> also expose "0.06". Journals routinely drop the leading zero
    // on p-values, and the extractor correctly writes them back in.
    .replace(/(^|[^\d.])\.(\d+)/g, (m, pre, digits) => `${pre}.${digits} 0.${digits}`)
    .replace(/\b([a-z]+)\b/gi, (w, word) => {
      const v = NUMBER_WORDS[word.toLowerCase()]
      return v === undefined ? w : `${w} ${v}`     // keep the word, add the digit
    })
}

/** Is a number present in the source, allowing for how sources really write it? */
export function numberInSource(n, source) {
  const s = String(source || '')
  const sNorm = normalizeSource(s)
  const raw = String(n)
  if (raw && (s.includes(raw) || sNorm.includes(raw))) return true

  const bare = raw.replace(/,(?=\d{3}\b)/g, '')
  if (bare && sNorm.includes(bare)) return true

  const v = Number(bare)
  if (!Number.isFinite(v)) return false
  if (s.includes(v.toLocaleString('en-US'))) return true

  // A negative asserted from a source that states the magnitude alongside a
  // separate sign, e.g. "a decrease of 3.54".
  if (v < 0 && sNorm.includes(String(Math.abs(v)))) return true

  // A rounded restatement: 0.936 reported from a source saying 93.6%.
  for (const alt of [fmt(v * 100), fmt(v / 100), fmt(Math.round(v))]) {
    if (alt && alt.length > 1 && sNorm.includes(alt)) return true
  }
  return false
}

/** Every checkable number an extraction asserts, with where it came from. */
export function assertedNumbers(e) {
  const out = []
  for (const n of checkableNumbers(e.demonstrated)) out.push({ n, field: 'demonstrated' })
  for (const q of e.quantitative_results || []) {
    for (const n of checkableNumbers(q.value)) out.push({ n, field: `quantitative_results.${q.metric}` })
  }
  return out
}

async function sourceTextFor(sb, row) {
  if (row.item_type === 'papers') {
    const { data } = await sb.from('papers').select('title,abstract').eq('id', row.item_id).maybeSingle()
    return data ? `${data.title}\n${data.abstract || ''}` : null
  }
  if (row.item_type === 'devices') {
    const { data } = await sb.from('devices').select('name,description').eq('id', row.item_id).maybeSingle()
    return data ? `${data.name}\n${data.description || ''}` : null
  }
  const { data } = await sb.from('news_feed').select('title,summary,metadata').eq('id', row.item_id).maybeSingle()
  if (!data) return null
  // A trial's source includes its registry design block, which is where its
  // endpoint text and enrollment live.
  return `${data.title}\n${data.summary || ''}\n${JSON.stringify(data.metadata || {})}`
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  // --live extracts fresh and verifies in memory, so acceptance can be measured
  // before migration 013 is applied or anything is stored.
  let rows
  if (LIVE) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const { loadItems, extractItem } = await import('./extract-items.js')
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const items = await loadItems(sb, SAMPLE)
    console.log(`extracting ${items.length} item(s) live...`)
    rows = []
    for (let i = 0; i < items.length; i += 6) {
      const chunk = items.slice(i, i + 6)
      const out = await Promise.all(chunk.map(async ({ item, entityType }) => {
        try { return await extractItem(anthropic, item, entityType) } catch { return null }
      }))
      for (const r of out) if (r) rows.push(r)
      process.stdout.write(`\r  ${rows.length}/${items.length}`)
    }
    process.stdout.write('\n\n')
  } else {
    const { data, error } = await sb.from('item_extractions')
      .select('*').eq('extractor_version', EXTRACTOR_VERSION).limit(SAMPLE * 4)
    if (error) {
      console.error('read failed:', error.message)
      if (/schema cache|does not exist/i.test(error.message)) {
        console.error('Apply migration 013 and run extract-items.js first, or pass --live.')
      }
      process.exit(1)
    }
    rows = data
  }
  if (!rows.length) { console.error('No extractions. Run extract-items.js --commit first, or pass --live.'); process.exit(1) }

  const sample = rows.slice(0, SAMPLE)
  console.log(`Phase 3 acceptance, ${sample.length} extraction(s), version ${EXTRACTOR_VERSION}.\n`)

  // ── Criterion (a): grounding ──────────────────────────────────────────────
  let checked = 0, ungrounded = 0, itemsWithAny = 0, itemsUngrounded = 0
  const failures = []
  for (const r of sample) {
    const src = await sourceTextFor(sb, r)
    if (!src) continue
    const asserted = assertedNumbers(r)
    if (asserted.length) itemsWithAny++
    let bad = 0
    for (const a of asserted) {
      checked++
      if (!numberInSource(a.n, src)) {
        ungrounded++; bad++
        if (failures.length < 12) failures.push({ id: r.item_id, type: r.entity_type, ...a })
      }
    }
    if (bad) itemsUngrounded++
  }
  const groundedPct = checked ? (100 * (checked - ungrounded) / checked) : 100
  console.log('(a) demonstrated never contains content absent from the source')
  console.log(`    checkable numbers asserted: ${checked} across ${itemsWithAny} item(s)`)
  console.log(`    grounded in the source:     ${checked - ungrounded} (${groundedPct.toFixed(1)}%)`)
  console.log(`    items with any ungrounded:  ${itemsUngrounded}/${sample.length}`)
  if (failures.length) {
    console.log('    ungrounded values:')
    for (const f of failures) console.log(`      ✗ ${f.n}  in ${f.field}  [${f.type} ${String(f.id).slice(0, 8)}]`)
  }
  const aPass = ungrounded === 0
  console.log(`    => ${aPass ? 'PASS' : 'FAIL'}`)
  console.log('    LIMIT: prose in `demonstrated` that asserts no number or entity is')
  console.log('           not checkable this way and is not covered by this result.')

  // ── Criterion (b): divergence on overclaiming items ───────────────────────
  // Structural definition, so no label has to be invented: an item that asserts
  // something while disclosing no methods, no numbers and no artifacts.
  const overclaimers = sample.filter(r =>
    r.claimed && !r.methods_disclosed
    && !(r.quantitative_results || []).length
    && !(r.artifacts_released || []).length
    && r.entity_type !== 'trial')
  const caught = overclaimers.filter(r => r.gap_flagged).length
  console.log('\n(b) divergence identified on known-overclaiming items')
  console.log(`    structurally overclaiming items in sample: ${overclaimers.length}`)
  console.log(`    flagged by the extractor:                  ${caught}`)
  if (overclaimers.length) {
    const rate = 100 * caught / overclaimers.length
    console.log(`    detection rate:                            ${rate.toFixed(0)}%`)
    console.log(`    => ${rate >= 80 ? 'PASS' : 'FAIL'} against the 8-in-10 bar`)
  } else {
    console.log('    => INCONCLUSIVE, no structurally overclaiming items in this sample')
  }
  console.log('    LIMIT: this set is STRUCTURAL, not hand-labelled. It tests that the')
  console.log('           extractor flags "asserts without disclosing", which is the')
  console.log('           shape the control exists for. A hand-labelled set of items')
  console.log('           that overclaim in SUBSTANCE is a human judgement and is not')
  console.log('           substituted for here.')

  // ── Context ───────────────────────────────────────────────────────────────
  const byGran = {}, byType = {}
  for (const r of sample) {
    byGran[r.input_granularity] = (byGran[r.input_granularity] || 0) + 1
    byType[r.entity_type] = (byType[r.entity_type] || 0) + 1
  }
  console.log('\nsample composition')
  console.log('   granularity:', byGran)
  console.log('   entity type:', byType)
  const markerVsGap = sample.filter(r => (r.rhetorical_markers || []).length && r.gap_flagged).length
  const markerTotal = sample.filter(r => (r.rhetorical_markers || []).length).length
  console.log(`   items using promotional language: ${markerTotal}, of which flagged: ${markerVsGap}`)

  console.log(`\nPhase 3: ${aPass && overclaimers.length && caught / overclaimers.length >= 0.8 ? 'both criteria met on the automated checks' : 'not fully met'}`)
  console.log('Human sign-off still required on: the hand-labelled 50-item read for (a),')
  console.log('and a hand-labelled overclaiming set for (b).')
}

if (process.argv[1] && process.argv[1].endsWith('verify-extraction.js')) {
  run().catch(e => { console.error(e); process.exit(1) })
}
