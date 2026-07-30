/**
 * build-retro-holdout.js — assemble and FREEZE the Phase 5 evaluation sets.
 *
 *   node --env-file=.env scripts/build-retro-holdout.js            # report only
 *   node --env-file=.env scripts/build-retro-holdout.js --write    # freeze to disk
 *
 * Spec 12 step 5 requires the reference list to be "constructed before anyone
 * sees the scores". This script runs BEFORE any retro scoring, writes the lists
 * with a hash over their ids, and the evaluation later refuses to proceed if the
 * hash no longer matches. That is the mechanism that makes the pre-registration
 * real rather than a promise.
 *
 * Nothing here reads impact_scores. That is deliberate and worth preserving: the
 * moment this script can see a score, the test stops being blind.
 */
import { writeFileSync, existsSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { WINDOW, buildReferenceList, buildNegativeSet, freeze, inWindow } from './lib/retro.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WRITE = process.argv.includes('--write')
const OUT = join(__dirname, 'data/retro-holdout.json')

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

const yearOf = d => Number(String(d || '').slice(0, 4)) || null

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.'); process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  if (existsSync(OUT) && WRITE) {
    const prev = JSON.parse(readFileSync(OUT, 'utf8'))
    console.error(`A frozen holdout already exists (reference hash ${prev.reference.hash}).`)
    console.error('Refusing to overwrite: re-freezing after scores exist would void the pre-registration.')
    console.error('Delete the file by hand if you genuinely intend to rebuild it.')
    process.exit(1)
  }

  // ── 1. The window corpus ──────────────────────────────────────────────────
  const papers = (await pageAll(sb, 'papers', 'id,year,title', q =>
    q.eq('in_scope', true).gte('year', WINDOW.start).lte('year', WINDOW.end)))
    .map(p => ({ ...p, item_type: 'papers' }))

  const feed = (await pageAll(sb, 'news_feed',
    'id,published_at,title,entry_type,metadata,legacy_significance'))
    .filter(r => inWindow(yearOf(r.published_at)))
    .map(r => ({ ...r, item_type: 'news_feed', year: yearOf(r.published_at) }))

  const devices = (await pageAll(sb, 'devices', 'id,year,name', q =>
    q.eq('in_scope', true).gte('year', WINDOW.start).lte('year', WINDOW.end)))
    .map(d => ({ ...d, item_type: 'devices' }))

  const corpus = [...papers, ...feed, ...devices]
  console.log(`window ${WINDOW.start}-${WINDOW.end} corpus: ${corpus.length}`)
  console.log(`  papers ${papers.length} | feed+trials ${feed.length} | devices ${devices.length}`)

  // ── 2. External signals, all post-window and decided by other parties ─────
  const records = await pageAll(sb, 'frontier_records_live', 'held_by_id,held_by_type,established_date')
  const recordHolders = new Set(records.map(r => r.held_by_id).filter(Boolean))

  const regs = await pageAll(sb, 'regulatory_records', 'device_id,decision_date')
  const approvedAfterWindow = new Set(
    regs.filter(r => (yearOf(r.decision_date) || 0) > WINDOW.end).map(r => r.device_id))

  // Phase 3/4 ONLY. "Any completed trial with results" selects 21% of window
  // trials and measures finishing rather than mattering; recall against it would
  // have looked like a pass and meant nothing.
  const pivotalReadouts = new Set(
    feed.filter(r => r.entry_type === 'trial'
      && (r.metadata?.design?.resultsPosted || r.metadata?.hasResults)
      && /Phase 3|Phase 4/.test(r.metadata?.phase || '')).map(r => r.id))

  const signals = { recordHolders, approvedAfterWindow, pivotalReadouts }
  console.log('\nexternal signals')
  console.log(`  items still holding a 2026 frontier record: ${recordHolders.size}`)
  console.log(`  devices cleared or approved after ${WINDOW.end}:  ${approvedAfterWindow.size}`)
  console.log(`  Phase 3/4 window trials that read out:      ${pivotalReadouts.size}`)

  // ── 3. Attention, for the negative case ───────────────────────────────────
  // The frozen legacy score IS the old attention-driven sort. Using it to pick a
  // test set is legitimate: spec 2 forbids attention as an input to the NEW
  // score, not as a way to choose what to test the new score against. This makes
  // the negative case directly ask whether the old sort's favourites survive.
  const scored = feed.filter(r => r.legacy_significance != null)
  // Top decile of the OLD score, computed rather than guessed: a fixed cut of 8
  // matched nothing, because window rows are all trials whose legacy score tops
  // out at 7.
  const ranked = [...scored].sort((a, b) => b.legacy_significance - a.legacy_significance)
  const cutIdx = Math.max(0, Math.ceil(ranked.length / 10) - 1)
  const cut = ranked.length ? ranked[cutIdx].legacy_significance : Infinity
  const attention = new Set(ranked.filter(r => r.legacy_significance >= cut).map(r => r.id))
  console.log(`\nattention proxy: top decile of the OLD sort, legacy_significance >= ${cut}`)
  console.log(`  ${attention.size} of ${scored.length} window items carrying a frozen legacy score`)
  console.log('  ! all window feed rows are trials; this corpus indexes no 2016-2019 media')
  console.log('    coverage, so this is a structural proxy for attention, not a rhetorical')
  console.log('    one, and is a WEAKER hype probe than spec 12 intends.')

  // ── 4. Build and freeze ───────────────────────────────────────────────────
  const reference = buildReferenceList(corpus, signals)
  const negative = buildNegativeSet(corpus, signals, attention)

  const byReason = {}
  for (const e of reference) for (const r of e.reasons) byReason[r] = (byReason[r] || 0) + 1
  console.log(`\nreference list (what actually mattered): ${reference.length}`)
  for (const [k, v] of Object.entries(byReason)) console.log(`  ${String(v).padStart(4)}  ${k}`)
  console.log(`negative set (covered, no outcome):      ${negative.length}`)

  const frozenRef = freeze(reference)
  const frozenNeg = freeze(negative)
  console.log(`\nreference hash ${frozenRef.hash} over ${frozenRef.count} ids`)
  console.log(`negative  hash ${frozenNeg.hash} over ${frozenNeg.count} ids`)

  if (reference.length < 5) {
    console.log('\n! the reference list is very small. Recall over fewer than five items is')
    console.log('  not a meaningful measurement, and the result should be reported as')
    console.log('  inconclusive rather than as a pass.')
  }

  if (!WRITE) { console.log('\nReport only. Re-run with --write to freeze.'); return }
  writeFileSync(OUT, JSON.stringify({
    _readme: [
      'Phase 5 retro-holdout, FROZEN. Spec 12 step 5 requires this to be built',
      'before anyone sees the scores, so the evaluation refuses to run if these',
      'hashes stop matching.',
      '',
      'The reference list is built from outcomes that POSTDATE the window and',
      'were decided by other parties: FDA decisions after 2019, whether the item',
      'still holds a 2026 frontier record, and trials that completed with posted',
      'results. No model judged what mattered. See scripts/lib/retro.js for why',
      'that constraint is not negotiable.',
      '',
      'LIMITATION, reported with every result: this can only see what left an',
      'institutional trace. It is biased toward commercialised and regulated work',
      'and blind to a method that quietly became standard. A domain expert list',
      'built blind to the scores would be strictly better and should replace it.',
    ],
    window: WINDOW,
    built_at: new Date().toISOString(),
    corpus_size: corpus.length,
    attention_cut: cut,
    reference: { ...frozenRef, entries: reference },
    negative: { ...frozenNeg, entries: negative },
  }, null, 2) + '\n')
  console.log(`\n✓ frozen to ${OUT}`)
}

run().catch(e => { console.error(e); process.exit(1) })
