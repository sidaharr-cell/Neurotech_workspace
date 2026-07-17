/**
 * backfill-paper-impact.js — populate papers.rank_score with OpenAlex
 * field-normalized citation impact, so the searchable /research DB can be
 * ordered by significance instead of just publication year.
 *
 * Impact-forward score (historical papers have accrued citations, so no
 * cold-start gate): 0.72 * impact percentile + 0.15 * venue prestige +
 * 0.13 * recent-citation velocity. Papers OpenAlex can't rate keep rank_score 0
 * (they sort last). Idempotent and re-runnable; safe to stop and restart.
 *
 * Prereq (one-time, Supabase SQL editor):
 *   alter table papers add column if not exists rank_score real default 0;
 *
 *   node --env-file=.env scripts/backfill-paper-impact.js [maxPapers]
 */
import { createClient } from '@supabase/supabase-js'
import { enrichOpenAlex, venuePrestige, clamp01 } from './refresh.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const MAX = process.argv[2] ? Number(process.argv[2]) : Infinity
const PAGE = 1000

function paperImpactScore(it) {
  let impact = null
  if (it.pctile != null) impact = clamp01(it.pctile)
  else if (it.fwci != null) impact = clamp01(Math.log10(1 + it.fwci) / 1.5)
  if (impact == null) return 0
  const velocity = clamp01(Math.log10(1 + (it.recentCites || 0)) / 2)
  const prestige = venuePrestige(it.oaVenue || it.journal)
  return 0.72 * impact + 0.15 * prestige + 0.13 * velocity
}

let processed = 0, scored = 0, from = 0
for (;;) {
  if (processed >= MAX) break
  const { data, error } = await supabase
    .from('papers')
    .select('id,title,doi,journal')
    .not('doi', 'is', null)
    .order('id', { ascending: true })
    .range(from, from + PAGE - 1)
  if (error) { console.error('fetch error:', error.message); process.exit(1) }
  if (!data.length) break

  const items = data.map(p => ({ id: p.id, title: p.title, doi: p.doi, journal: p.journal }))
  await enrichOpenAlex(items)

  // Upsert just {id, title, rank_score} — the conflict on id updates rank_score
  // in place; title is included only to satisfy the NOT NULL insert path.
  const updates = items.map(it => ({ id: it.id, title: it.title, rank_score: paperImpactScore(it) }))
  for (let i = 0; i < updates.length; i += 500) {
    const { error: uErr } = await supabase.from('papers').upsert(updates.slice(i, i + 500), { onConflict: 'id' })
    if (uErr) { console.error('upsert error:', uErr.message); process.exit(1) }
  }

  processed += data.length
  scored += updates.filter(u => u.rank_score > 0).length
  from += PAGE
  console.log(`  processed ${processed} papers · ${scored} with an impact score`)
  if (data.length < PAGE) break
}

console.log(`\n✓ Done — ${processed} papers processed, ${scored} scored by OpenAlex impact.`)
