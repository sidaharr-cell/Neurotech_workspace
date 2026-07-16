/**
 * seed-notable.js — one-time seed for src/data/notable.json. Pulls recent
 * neurotech papers from the papers table, enriches them with OpenAlex
 * field-normalized impact (which also supplies the publication date), and keeps
 * the top-decile, in-window standouts — the same rule the daily cron applies in
 * syncNotable(). Generates a one-line AI significance blurb for the final set.
 * After this, refresh.js maintains the rail.
 *
 *   node --env-file=.env scripts/seed-notable.js
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import {
  enrichOpenAlex, impactTrusted, toNotable, daysOld,
  NOTABLE_MAX, NOTABLE_PCTILE_MIN, NOTABLE_WINDOW_DAYS, NOTABLE_PATH,
} from './refresh.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Pull recent (2026) neurotech papers with a DOI — the pool OpenAlex can rate.
// Supabase caps a request at 1000 rows, so page through a few thousand.
const rows = []
for (let from = 0; from < 5000; from += 1000) {
  const { data, error } = await supabase
    .from('papers').select('title,authors,journal,year,doi,pubmed_id,url,abstract')
    .eq('year', '2026').not('doi', 'is', null)
    .order('created_at', { ascending: false })
    .range(from, from + 999)
  if (error) { console.error(error); process.exit(1) }
  rows.push(...(data || []))
  if (!data || data.length < 1000) break
}

const items = rows.map(r => ({
  title: r.title,
  authors: r.authors || [],
  journal: r.journal,
  doi: r.doi,
  pmid: r.pubmed_id || null,
  url: r.url,
  abstract: r.abstract || '',
}))

console.log(`Enriching ${items.length} candidate papers via OpenAlex (this takes ~1–2 min)...`)
await enrichOpenAlex(items)

const rail = items
  .filter(it => impactTrusted(it) && (it.pctile ?? 0) >= NOTABLE_PCTILE_MIN && daysOld(it.oaDate) <= NOTABLE_WINDOW_DAYS)
  .sort((a, b) => (b.pctile - a.pctile))
  .slice(0, NOTABLE_MAX)

// One-line "why it matters" blurb for the final set (cheap — only ~12 calls).
for (const it of rail) {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 90,
      messages: [{ role: 'user', content: `In ONE sentence (≤30 words), say why this neurotechnology paper matters. No preamble.\n\nTitle: ${it.title}\nAbstract: ${(it.abstract || '').slice(0, 900)}` }],
    })
    it.significance = msg.content[0]?.text?.trim() || ''
  } catch (e) { it.significance = ''; console.warn('  blurb failed:', e.message) }
}

const out = rail.map(toNotable)
writeFileSync(NOTABLE_PATH, JSON.stringify(out, null, 2) + '\n')
console.log(`\n✓ Wrote notable.json — ${out.length} papers`)
out.forEach(r => console.log(`  ${(r.pctile * 100).toFixed(0)}%  cite=${r.citedBy}  ${(r.publishedAt || '').slice(0, 10)}  ${r.title.slice(0, 62)}`))
