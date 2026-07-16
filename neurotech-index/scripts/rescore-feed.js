/**
 * rescore-feed.js — one-time pass to re-score EVERY current feed row with the
 * new per-type scorers (research → OpenAlex impact, media → authority+recency).
 * The daily refresh only re-scores the items it re-fetches, so older rows linger
 * on their previous scores for up to 7 days; this brings the whole live feed to
 * the new criteria immediately. Idempotent and re-runnable.
 *
 *   node --env-file=.env scripts/rescore-feed.js
 */
import { createClient } from '@supabase/supabase-js'
import { enrichOpenAlex, researchScore, mediaScore } from './refresh.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// Pull every non-trial feed row (trials rank via their own relevance_score).
const rows = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('news_feed').select('id,source,published_at,relevance_score,entry_type,metadata')
    .neq('entry_type', 'trial').order('id').range(from, from + 999)
  if (error) { console.error(error); process.exit(1) }
  rows.push(...data)
  if (data.length < 1000) break
}
console.log(`Re-scoring ${rows.length} feed rows...`)

// Enrich research rows with OpenAlex impact (needs a DOI).
const research = rows.filter(r => r.entry_type === 'paper' || r.entry_type === 'preprint')
const items = research.map(r => ({ row: r, doi: r.metadata?.doi || null, journal: r.metadata?.journal, published_at: r.published_at, relevance_score: r.relevance_score }))
await enrichOpenAlex(items)
const byId = new Map(items.map(it => [it.row.id, it]))

let updated = 0
const jobs = rows.map(r => {
  let rankScore, extra = {}
  if (r.entry_type === 'paper' || r.entry_type === 'preprint') {
    const it = byId.get(r.id)
    rankScore = researchScore(it)
    extra = { pctile: it.pctile ?? null, fwci: it.fwci ?? null }
  } else if (r.entry_type === 'news') {
    rankScore = mediaScore({ relevance_score: r.relevance_score, published_at: r.published_at, source: r.source })
  } else {
    return null
  }
  const metadata = { ...r.metadata, rankScore, ...extra }
  return { id: r.id, metadata }
}).filter(Boolean)

// Update in place, bounded concurrency.
for (let i = 0; i < jobs.length; i += 25) {
  await Promise.all(jobs.slice(i, i + 25).map(async j => {
    const { error } = await supabase.from('news_feed').update({ metadata: j.metadata }).eq('id', j.id)
    if (error) console.warn('update error:', error.message); else updated++
  }))
  process.stdout.write(`\r  updated ${updated}/${jobs.length}`)
}
console.log(`\n✓ Re-scored ${updated} feed rows with the new per-type scorers.`)
