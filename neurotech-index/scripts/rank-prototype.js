/**
 * rank-prototype.js — READ-ONLY experiment. Prototypes a Research-specific
 * ranking that replaces the one-size-fits-all computeRank() for paper/preprint
 * items, and prints the new order side-by-side with the current order so we can
 * eyeball whether it feels right BEFORE wiring anything into refresh.js.
 *
 * Signals (all normalized 0–1, then weighted):
 *   relevance   — Claude's neurotech-relevance score (day-one)
 *   recency     — exponential decay, 180-day half-life (research stays relevant)
 *   impact      — OpenAlex citation_normalized_percentile (field+year cohort),
 *                 falling back to a log-scaled FWCI; the key "is this a big deal"
 *   velocity    — citations accrued in the last ~2 calendar years (log-scaled)
 *   prestige    — curated venue tier (day-one; helps brand-new papers rank)
 *
 * Nothing is written back. Run: node --env-file=.env scripts/rank-prototype.js
 */
import { createClient } from '@supabase/supabase-js'

const MAILTO = 'sid.a.harr@gmail.com'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// ── Curated venue prestige (day-one signal; case-insensitive substring) ──────
const VENUE_TIERS = [
  [1.00, ['nature', 'science', 'cell', 'neuron', 'nature neuroscience', 'nature medicine',
          'nature biomedical engineering', 'lancet', 'new england journal']],
  [0.85, ['nature communications', 'science advances', 'pnas', 'brain', 'nature methods',
          'jama', 'science translational medicine', 'elife']],
  [0.70, ['journal of neuroscience', 'neuroimage', 'ieee trans', 'journal of neural engineering',
          'brain stimulation', 'annals of neurology', 'movement disorders']],
  [0.55, ['frontiers in', 'plos', 'scientific reports', 'journal of neurophysiology']],
]
function prestige(venue) {
  const v = (venue || '').toLowerCase()
  if (!v) return 0.40
  for (const [score, keys] of VENUE_TIERS) if (keys.some(k => v.includes(k))) return score
  return 0.45 // known venue, untiered
}

// ── OpenAlex enrichment (batched by DOI, 25 per request) ─────────────────────
const OA_FIELDS = 'ids,doi,title,fwci,citation_normalized_percentile,cited_by_count,counts_by_year,primary_location,publication_date'

async function enrichOpenAlex(items) {
  const withDoi = items.filter(i => i.doi)
  for (let i = 0; i < withDoi.length; i += 25) {
    const batch = withDoi.slice(i, i + 25)
    const filter = 'doi:' + batch.map(b => b.doi.toLowerCase()).join('|')
    const url = `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}&select=${OA_FIELDS}&per-page=25&mailto=${MAILTO}`
    try {
      const res = await fetch(url)
      if (!res.ok) { console.warn(`  OpenAlex ${res.status}`); await sleep(1000); continue }
      const { results = [] } = await res.json()
      const byDoi = new Map()
      for (const w of results) {
        const d = (w.doi || '').replace('https://doi.org/', '').toLowerCase()
        if (d) byDoi.set(d, w)
      }
      for (const b of batch) {
        const w = byDoi.get(b.doi.toLowerCase())
        if (!w) continue
        b.oa = true
        b.fwci = w.fwci ?? null
        b.pctile = w.citation_normalized_percentile?.value ?? null
        b.citedBy = w.cited_by_count ?? 0
        const yr = new Date().getUTCFullYear()
        b.recentCites = (w.counts_by_year || [])
          .filter(c => c.year >= yr - 1)
          .reduce((s, c) => s + (c.cited_by_count || 0), 0)
        b.oaVenue = w.primary_location?.source?.display_name || null
      }
      process.stdout.write(`\r  OpenAlex enriched ${Math.min(i + 25, withDoi.length)}/${withDoi.length}`)
    } catch (e) { console.warn('  OpenAlex error', e.message) }
    await sleep(300) // polite pool
  }
  console.log('')
}

// ── Scoring ──────────────────────────────────────────────────────────────────
const clamp01 = x => Math.max(0, Math.min(1, x))
const daysSince = d => (d ? Math.max(0, (Date.now() - new Date(d).getTime()) / 864e5) : 240)

const W = { relevance: 0.28, recency: 0.22, impact: 0.30, velocity: 0.10, prestige: 0.10 }

function researchScore(it) {
  const age = daysSince(it.published_at)
  const relevance = clamp01((it.relevance_score ?? 5) / 10)
  const recency = Math.exp(-age * Math.LN2 / 180) // 180-day half-life
  const velocity = clamp01(Math.log10(1 + (it.recentCites ?? 0)) / 2) // ~100 recent cites → 1
  const prest = prestige(it.oaVenue || it.journal)

  // Impact is only TRUSTWORTHY once a paper has accrued enough signal: OpenAlex
  // percentiles are noise when the whole same-age cohort has ~0 citations. Gate
  // on citedBy≥3 OR age>60d. When impact is untrustworthy (fresh, uncited, or
  // simply not yet indexed), drop the impact term and redistribute its weight
  // onto the day-one signals — so new papers compete on relevance/recency/venue
  // and get promoted later, once the nightly re-score sees real citations.
  const impactTrusted = (it.pctile != null || it.fwci != null) && ((it.citedBy ?? 0) >= 3 || age > 60)

  let impact = null
  if (impactTrusted) {
    impact = it.pctile != null ? clamp01(it.pctile) : clamp01(Math.log10(1 + it.fwci) / 1.5)
  }

  let score, w = { ...W }
  if (impact == null) {
    // redistribute impact weight proportionally across the remaining signals
    const rest = W.relevance + W.recency + W.velocity + W.prestige
    const k = 1 + W.impact / rest
    w = { relevance: W.relevance * k, recency: W.recency * k, velocity: W.velocity * k, prestige: W.prestige * k, impact: 0 }
    score = w.relevance * relevance + w.recency * recency + w.velocity * velocity + w.prestige * prest
  } else {
    score = W.relevance * relevance + W.recency * recency + W.impact * impact + W.velocity * velocity + W.prestige * prest
  }
  return { score, impactTrusted, parts: { relevance, recency, impact, velocity, prest } }
}

// ── Main ──────────────────────────────────────────────────────────────────────
const N = 120
const { data: rows, error } = await supabase
  .from('news_feed').select('*')
  .in('entry_type', ['paper', 'preprint'])
  .order('created_at', { ascending: false })
  .limit(N)
if (error) { console.error(error); process.exit(1) }

const items = rows.map(r => ({
  id: r.id,
  title: r.title,
  journal: r.metadata?.journal || r.source,
  doi: r.metadata?.doi || null,
  published_at: r.published_at,
  relevance_score: r.relevance_score,
  oldRank: r.metadata?.rankScore ?? (r.relevance_score ?? 0) / 10,
  citationCount: r.metadata?.citationCount ?? 0,
}))

console.log(`Pulled ${items.length} research items (${items.filter(i => i.doi).length} with DOI). Enriching via OpenAlex...`)
await enrichOpenAlex(items)

const scored = items.map(it => ({ ...it, ...researchScore(it) }))

// Rank positions under each scheme
const byOld = [...scored].sort((a, b) => b.oldRank - a.oldRank)
const byNew = [...scored].sort((a, b) => b.score - a.score)
const oldPos = new Map(byOld.map((it, i) => [it.id, i + 1]))
const newPos = new Map(byNew.map((it, i) => [it.id, i + 1]))

const pad = (s, n) => String(s).slice(0, n).padEnd(n)
const num = (x, n = 2) => (x == null ? '  -  ' : x.toFixed(n))

console.log('\n════════ TOP 25 UNDER NEW RESEARCH SCORE ════════')
console.log('(imp "-" = fresh/uncited, impact dropped & weight redistributed)')
console.log('new  old   Δ   rel  rec  imp  vel  prs | pct   fwci  cite | title')
for (const it of byNew.slice(0, 25)) {
  const np = newPos.get(it.id), op = oldPos.get(it.id), delta = op - np
  const arrow = delta > 0 ? `+${delta}` : `${delta}`
  const p = it.parts
  console.log(
    `${pad(np, 4)} ${pad(op, 4)} ${pad(arrow, 4)} ` +
    `${num(p.relevance)} ${num(p.recency)} ${num(p.impact)} ${num(p.velocity)} ${num(p.prest)} | ` +
    `${pad(it.pctile != null ? (it.pctile * 100).toFixed(0) + '%' : '-', 4)} ${pad(num(it.fwci, 1), 5)} ${pad(it.citedBy ?? 0, 4)} | ` +
    `${pad(it.title, 70)}`
  )
}

console.log('\n════════ BIGGEST RISERS (new ≫ old) ════════')
const movers = [...scored].map(it => ({ ...it, delta: oldPos.get(it.id) - newPos.get(it.id) }))
for (const it of movers.sort((a, b) => b.delta - a.delta).slice(0, 8))
  console.log(`  ${pad('+' + it.delta, 5)} new#${pad(newPos.get(it.id), 4)} old#${pad(oldPos.get(it.id), 4)} pct=${pad(it.pctile != null ? (it.pctile * 100).toFixed(0) + '%' : '-', 5)} ${pad(it.title, 66)}`)

console.log('\n════════ BIGGEST FALLERS (old ≫ new) ════════')
for (const it of movers.sort((a, b) => a.delta - b.delta).slice(0, 8))
  console.log(`  ${pad(it.delta, 5)} new#${pad(newPos.get(it.id), 4)} old#${pad(oldPos.get(it.id), 4)} pct=${pad(it.pctile != null ? (it.pctile * 100).toFixed(0) + '%' : '-', 5)} ${pad(it.title, 66)}`)

const enriched = scored.filter(i => i.oa).length
console.log(`\nOpenAlex match: ${enriched}/${items.length}. Items with a percentile: ${scored.filter(i => i.pctile != null).length}.`)
