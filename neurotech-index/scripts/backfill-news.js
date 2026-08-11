/**
 * backfill-news.js — fill /media with the last N days of neurotech press.
 *
 *   node --env-file=.env scripts/backfill-news.js                 # dry run
 *   node --env-file=.env scripts/backfill-news.js --commit
 *   node --env-file=.env scripts/backfill-news.js --commit --days=30 --budget=1.50
 *
 * DRY RUN BY DEFAULT, like every other backfill in this directory: it reports the
 * funnel and the projected cost and writes nothing without --commit.
 *
 * Why this exists separately from refresh.js: the nightly run is a DELTA. It asks
 * each source what is new, scores it, stores it, and that is the right shape for
 * a cron. It is the wrong shape for filling an empty archive, because the archive
 * needs breadth (many more queries than a delta justifies) and because re-running
 * the nightly job to get it would re-score the whole research side every pass, at
 * roughly triple the cost per item of the news it is actually after.
 *
 * Everything here that decides what a news item IS — the fetch, the lexicon gate,
 * the picture sourcing — is imported from refresh.js rather than restated, so the
 * backfill and the nightly run cannot drift apart.
 *
 * ── Cost ───────────────────────────────────────────────────────────────────
 * Two guards, because an overnight job that quietly spends is worse than one that
 * quietly stops:
 *
 *   1. Nothing already in news_feed is scored again. Matched on URL and on
 *      normalised title, so a story we hold under a Google News wrapper is not
 *      bought a second time under the publisher's own URL.
 *   2. Every Anthropic call's `usage` is metered against --budget at the measured
 *      Haiku 4.5 rates. The check runs BEFORE each request using the running mean
 *      cost per call, so the budget is a ceiling that is never crossed rather than
 *      a total that is noticed afterwards.
 */
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import {
  UA, NEWS_MAX,
  CURATED_FEEDS, MASTODON_TAGS, GDELT_QUERIES,
  googleNewsUrl, mastodonUrl, fetchRssFeed,
  onTopicByLexicon, getOgImage, measureImage, HI_RES, classifyImageUrl,
  mediaScore, cleanTitle, isOnTopic, RELEVANCE_FLOOR,
} from './refresh.js'

const argv = process.argv.slice(2)
const COMMIT = argv.includes('--commit')
const DAYS = Number(argv.find(a => a.startsWith('--days='))?.split('=')[1] ?? 30)
const BUDGET = Number(argv.find(a => a.startsWith('--budget='))?.split('=')[1] ?? 1.5)
// Vision is the second-largest line item and its value falls off a cliff below
// the fold: imageKind only decides which stories may LEAD. Classify the top of
// the ranking and leave the tail unclassified rather than pay for every picture.
const CLASSIFY_TOP = Number(argv.find(a => a.startsWith('--classify='))?.split('=')[1] ?? 150)

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const anthropic = new Anthropic()

// Measured 10 Aug 2026 against claude-haiku-4-5.
const IN_PER_TOK = 1 / 1e6
const OUT_PER_TOK = 5 / 1e6

const meter = { calls: 0, input: 0, output: 0, get usd() { return this.input * IN_PER_TOK + this.output * OUT_PER_TOK } }
class BudgetExceeded extends Error {}

/**
 * Reserve headroom for one more call before making it. The estimate is this
 * run's own mean, which converges after a handful of calls; the first few use a
 * deliberately pessimistic seed so a tiny budget cannot be blown before the
 * meter has data.
 */
function assertBudget(kind) {
  const seed = kind === 'vision' ? 0.0025 : 0.008
  const mean = meter.calls >= 4 ? meter.usd / meter.calls : seed
  if (meter.usd + mean > BUDGET) {
    throw new BudgetExceeded(
      `budget ceiling reached: $${meter.usd.toFixed(4)} spent, next ${kind} call ~$${mean.toFixed(4)}, cap $${BUDGET.toFixed(2)}`
    )
  }
}
function record(usage) {
  meter.calls++
  meter.input += usage?.input_tokens ?? 0
  meter.output += usage?.output_tokens ?? 0
}

// ── Sources ─────────────────────────────────────────────────────────────────

/**
 * Google News queries for archive breadth.
 *
 * A delta needs a handful of queries; an archive needs many, because Google News
 * returns 100 results per query ordered by RELEVANCE, not recency, so the recent
 * slice of any one query is only ~30 items however broad the query is. Coverage
 * therefore comes from asking many narrow questions, not from one wide one.
 */
const BACKFILL_QUERIES = [
  // Field
  'neurotechnology', '"brain-computer interface"', '"brain machine interface"',
  '"neural interface"', '"neural implant"', '"brain implant"', 'neuroprosthetics',
  'neuromodulation', 'neurostimulation', 'bioelectronic medicine',
  // Modality
  '"deep brain stimulation"', '"spinal cord stimulation"', '"vagus nerve stimulation"',
  '"transcranial magnetic stimulation"', '"transcranial direct current stimulation"',
  '"focused ultrasound" brain', 'optogenetics', 'electrocorticography',
  '"EEG headset" OR "consumer EEG"', '"neural decoding" OR "speech decoding" brain',
  '"cochlear implant"', '"retinal implant" OR "bionic eye"',
  // Companies
  'Neuralink', 'Synchron BCI', '"Blackrock Neurotech"', 'Paradromics',
  '"Precision Neuroscience"', '"Motif Neurotech" OR "Science Corporation" neural',
  '"Onward Medical" OR "Saluda Medical" OR "Neuros Medical"',
  'NeuroPace OR "Cala Health" OR Nevro OR CVRx',
  'INBRAIN OR Axoft OR Subsense OR "Merge Labs" OR "Forest Neurotech"',
  'Medtronic neuromodulation OR "Abbott" neurostimulation OR "Boston Scientific" DBS',
  // Application and indication
  'brain implant paralysis', 'BCI speech restored patient',
  '"neural implant" epilepsy OR Parkinson OR depression',
  'brain implant blindness OR hearing restored',
  // Regulatory, funding, policy
  '"FDA" neurotechnology OR neurostimulation clearance',
  'neurotech funding round OR raises Series',
  'neurorights OR "neural data" privacy law',
  // Research
  'brain implant study Nature OR Science journal',
  'neurotechnology research breakthrough university',
]

/**
 * GDELT, slowly.
 *
 * GDELT matters more than its article count suggests: alone among the free
 * sources it returns a DIRECT publisher URL together with an already-extracted
 * social image, so its items need no Open Graph scrape and arrive illustrated.
 * Everything Google News gives us is a redirect wrapper around an opaque payload
 * that cannot be resolved or scraped, so GDELT is most of the answer to "cover
 * images as best as possible".
 *
 * The published limit is one request every five seconds and a burst earns a much
 * longer cooldown, which is why the nightly path's 300ms loop had been silently
 * contributing nothing. An overnight backfill can simply be patient: at this
 * spacing the whole pass costs minutes of wall clock and no money at all.
 */
async function slowGdelt(days, spacingMs = 25_000) {
  const queries = [
    ...GDELT_QUERIES,
    '"neural interface" OR "neuroprosthetic"', '"cochlear implant"', '"retinal implant"',
    '"spinal cord stimulation"', '"vagus nerve stimulation"', 'Neuralink', '"BCI"',
  ]
  const timespan = `${Math.max(1, Math.min(365, days))}d`
  const out = []
  let ok = 0, consecutiveThrottles = 0
  for (const [n, q] of queries.entries()) {
    // Once GDELT is in a cooldown it stays there for far longer than the run can
    // usefully wait, and each further attempt is 25 seconds of nothing. Three
    // strikes and the pass gives up rather than spending six minutes proving the
    // same point fourteen times.
    if (consecutiveThrottles >= 3) {
      console.warn(`  GDELT throttled ${consecutiveThrottles}x in a row — abandoning the pass (${queries.length - n} queries skipped)`)
      break
    }
    if (n) await new Promise(r => setTimeout(r, spacingMs))
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}` +
      `&mode=artlist&format=json&maxrecords=250&sort=datedesc&timespan=${timespan}`
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45_000) })
      const text = await res.text()
      if (!text.trimStart().startsWith('{')) { console.warn(`  GDELT throttled: ${q.slice(0, 40)}`); continue }
      const arts = (JSON.parse(text).articles || []).filter(a => a.url && a.title && a.language === 'English')
      for (const a of arts) {
        out.push({
          title: a.title, url: a.url, summary: '', source: a.domain || 'GDELT',
          publishedAt: a.seendate && a.seendate.length >= 8
            ? `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}T00:00:00Z` : null,
          image: a.socialimage || null, entry_type: 'news',
        })
      }
      ok++
      console.log(`  GDELT ${ok}/${queries.length}: ${arts.length} articles (${arts.filter(a => a.socialimage).length} illustrated) — ${q.slice(0, 40)}`)
    } catch (e) { console.warn(`  GDELT error: ${q.slice(0, 40)} — ${e.message}`) }
  }
  console.log(`  GDELT total: ${out.length} articles, ${out.filter(i => i.image).length} with an image, from ${ok}/${queries.length} queries`)
  return out
}

/**
 * Reddit was tried here and removed on 11 Aug 2026.
 *
 * The feed technically works, but what it returns is not press. Most items are
 * self-posts whose URL points back at the comment thread rather than at an
 * article, so they carry no publisher, no picture, and nothing to link a reader
 * to. Worse, Reddit's Atom sets <author><name> to /u/username, and the parser
 * prefers an item's own source over the feed label — so thirteen redditors were
 * added to the outlet list of a scientific news section.
 *
 * A discussion forum is a fine place to FIND a story and a bad thing to publish
 * as one. If it comes back it should come back as link extraction from the posts,
 * not as the posts themselves.
 */

/** Hacker News via the free Algolia endpoint. Direct URLs, no key. */
async function fetchHackerNews(days) {
  const since = Math.floor((Date.now() - days * 864e5) / 1000)
  const qs = ['brain computer interface', 'neuralink', 'neural implant', 'brain implant', 'neurotechnology']
  const out = []
  for (const q of qs) {
    try {
      const u = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=100&numericFilters=created_at_i>${since}`
      const res = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) })
      const j = await res.json()
      for (const h of j.hits || []) {
        if (!h.url || !h.title) continue
        out.push({
          title: h.title, url: h.url, summary: '',
          source: (() => { try { return new URL(h.url).hostname.replace(/^www\./, '') } catch { return 'Hacker News' } })(),
          publishedAt: h.created_at, image: null, entry_type: 'news',
        })
      }
    } catch (e) { console.warn(`  HN error on "${q}": ${e.message}`) }
    await new Promise(r => setTimeout(r, 400))
  }
  console.log(`  Hacker News: ${out.length} stories`)
  return out
}

/**
 * Google News regional editions.
 *
 * The same query against a different edition returns a substantially different
 * result set, because each edition ranks its own country's outlets first. This
 * is the cheapest coverage available: no new query design, no new source to
 * maintain, and the dedupe collapses whatever overlaps. English-language
 * editions only — the index is English, and GDELT already filters to English.
 */
const EDITIONS = [
  ['en-US', 'US', 'US:en'],
  ['en-GB', 'GB', 'GB:en'],
  ['en-IN', 'IN', 'IN:en'],
  ['en-AU', 'AU', 'AU:en'],
]
const editionUrl = (q, [hl, gl, ceid]) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`

// Only the core queries get the regional treatment; running all 41 across four
// editions is 164 requests for heavily overlapping results.
const CORE_FOR_EDITIONS = BACKFILL_QUERIES.slice(0, 14)

async function fetchEverything(cutoffMs, days) {
  const editionCalls = CORE_FOR_EDITIONS.length * (EDITIONS.length - 1)
  console.log(`Fetching (${BACKFILL_QUERIES.length} Google News queries + ${editionCalls} regional, ${CURATED_FEEDS.length} feeds, ${MASTODON_TAGS.length} Mastodon, HN, GDELT)...`)
  const settled = await Promise.allSettled([
    ...BACKFILL_QUERIES.map(q => fetchRssFeed(googleNewsUrl(q), 'Google News', 100)),
    ...CORE_FOR_EDITIONS.flatMap(q =>
      EDITIONS.slice(1).map(e => fetchRssFeed(editionUrl(q, e), 'Google News', 100))
    ),
    ...CURATED_FEEDS.map(([u, l, o = {}]) => fetchRssFeed(u, l, o.cap ?? 60, o.ua ?? UA)),
    ...MASTODON_TAGS.map(t => fetchRssFeed(mastodonUrl(t), `#${t} · Mastodon`, 20)),
    fetchHackerNews(days),
  ])
  const failed = settled.filter(s => s.status === 'rejected').length
  if (failed) console.warn(`  ${failed} source(s) rejected outright`)
  const parallel = settled.flatMap(s => (s.status === 'fulfilled' ? s.value : []))

  // GDELT runs last and alone, because it is the one source that must not be
  // hit concurrently with anything else that shares its rate limit.
  const gdelt = await slowGdelt(days)

  return [...parallel, ...gdelt].filter(i =>
    i.title && i.url && (!i.publishedAt || new Date(i.publishedAt).getTime() >= cutoffMs)
  )
}

const titleKey = t => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60)
const isAgg = u => /news\.google\.com/i.test(u || '')

/** Keep the copy that can be illustrated: an image first, then a direct URL. */
function collapse(items) {
  const better = (a, b) => {
    if (!!a.image !== !!b.image) return a.image ? a : b
    if (isAgg(a.url) !== isAgg(b.url)) return isAgg(a.url) ? b : a
    return a
  }
  const byTitle = new Map()
  for (const it of items) {
    const k = titleKey(it.title)
    if (!k) continue
    const prev = byTitle.get(k)
    byTitle.set(k, prev ? better(prev, it) : it)
  }
  const seenUrl = new Set(), out = []
  for (const it of byTitle.values()) {
    if (seenUrl.has(it.url)) continue
    seenUrl.add(it.url); out.push(it)
  }
  return out
}

// ── Scoring (news shape: no significance paragraph) ─────────────────────────

const TOPIC_TAGS = [
  'BCI', 'EEG', 'fMRI', 'Neural dust', 'Electrode array', 'Deep brain stimulation',
  'Neuralink', 'Synchron', 'Motor cortex', 'Speech BCI', 'Somatosensory',
  'ALS', "Parkinson's", 'Spinal cord injury', 'Neural recording', 'Wireless',
  'Implant', 'Consumer', 'Clinical trial', 'Open-source', 'Machine learning',
  'Prosthetics', 'Optogenetics', 'Calcium imaging', 'Connectomics',
]

const RUBRIC =
  `You are an expert in neurotechnology. Rate each item for its significance to the field.\n\n` +
  `For each numbered item, respond with a JSON array element containing:\n` +
  `- "score": integer 1 to 10, measuring relevance to NEUROTECHNOLOGY SPECIFICALLY. ` +
  `Neurotechnology means devices and methods that interface with the nervous system: ` +
  `brain-computer interfaces, neural implants and electrode arrays, neurostimulation and ` +
  `neuromodulation (DBS, TMS, tES, VNS, spinal cord stimulation), neuroprosthetics, cochlear ` +
  `and retinal implants, neural recording and decoding, closed-loop and adaptive neural systems, ` +
  `optogenetics and ultrasound neuromodulation, and the hardware, software, companies, and clinical ` +
  `trials behind them. ` +
  `Score 5 to 10 ONLY when such neurotechnology is CENTRAL to the item: 5 to 6 incremental, ` +
  `7 to 8 strong or notable, 9 to 10 a landmark advance (rare). ` +
  `Score 1 to 4 for EVERYTHING ELSE, even when it concerns the brain or nervous system: ` +
  `general neuroscience, neuroimaging findings with no device, genetics, basic biology, psychology, ` +
  `drugs and pharmacology, diagnostics and biomarkers, surgery, epidemiology, general medical news. ` +
  `Consumer gadgets, vehicles, lifestyle, diet, business, or politics score 1. ` +
  `CRUCIAL: an item that merely USES neural recording, electrophysiology, stimulation, or brain ` +
  `imaging as a tool to study brain function, circuits, cells, or a disease is NOT neurotechnology; ` +
  `score it 1 to 4. To score 5 or higher the item must be primarily ABOUT the technology itself. ` +
  `Differentiate items within this batch.\n` +
  `- "summary": one crisp sentence on why it matters to neurotech practitioners\n` +
  `Write the summary in clear, punchy prose. Do NOT use em dashes or en dashes (— or –); use commas, periods, colons, or parentheses instead.\n` +
  `- "topics": 1-4 tags chosen ONLY from this list: ${TOPIC_TAGS.join(', ')}\n\n`

async function scoreNews(items, batchSize = 10, concurrency = 3) {
  const out = []
  const batches = []
  for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize))
  let done = 0, aborted = false

  async function run(batch) {
    if (aborted) return
    const body = batch
      .map((it, i) => `[${i + 1}] TITLE: ${it.title}\nCONTENT: ${(it.summary || '').slice(0, 400)}`)
      .join('\n\n---\n\n')
    try {
      assertBudget('score')
    } catch (e) {
      if (e instanceof BudgetExceeded) { aborted = true; console.warn(`\n  ${e.message}`); return }
      throw e
    }
    try {
      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{ role: 'user', content: `${RUBRIC}Items:\n${body}\n\nRespond with ONLY a JSON array of ${batch.length} objects, no other text.` }],
      })
      record(res.usage)
      let raw = res.content[0].text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      if (raw[0] !== '[') {
        const a = raw.indexOf('['), b = raw.lastIndexOf(']')
        if (a !== -1 && b !== -1) raw = raw.slice(a, b + 1)
      }
      const parsed = JSON.parse(raw)
      batch.forEach((it, i) => out.push({
        ...it,
        relevanceScore: parsed[i]?.score ?? 5,
        aiSummary: parsed[i]?.summary || '',
        topics: Array.isArray(parsed[i]?.topics) ? parsed[i].topics : [],
      }))
    } catch (err) {
      // A malformed batch is five lost items, not a lost run. They keep their
      // feed summary and a neutral score, and the relevance floor still applies.
      console.warn(`  scoring batch failed (${err.message.slice(0, 80)}) — kept at neutral`)
      batch.forEach(it => out.push({ ...it, relevanceScore: 5, aiSummary: '', topics: [] }))
    }
    done += batch.length
    if (done % 200 < batchSize) console.log(`      scored ${done}/${items.length}  ($${meter.usd.toFixed(3)})`)
  }

  for (let i = 0; i < batches.length && !aborted; i += concurrency) {
    await Promise.all(batches.slice(i, i + concurrency).map(run))
    await new Promise(r => setTimeout(r, 400))
  }
  return { scored: out, aborted }
}

// ── Pictures ────────────────────────────────────────────────────────────────

async function sourceImages(items) {
  const need = items.filter(i => !i.image && i.url && !isAgg(i.url))
  console.log(`  Open Graph scrape for ${need.length} items without a feed image...`)
  for (let i = 0; i < need.length; i += 8) {
    await Promise.all(need.slice(i, i + 8).map(async it => { it.image = await getOgImage(it.url) }))
  }
  console.log('  Measuring images and dropping thumbnails...')
  const withAny = items.filter(i => i.image)
  for (let i = 0; i < withAny.length; i += 8) {
    await Promise.all(withAny.slice(i, i + 8).map(async it => {
      const d = await measureImage(it.image)
      if (HI_RES(d)) { it.imageW = d.width; it.imageH = d.height } else { it.image = null }
    }))
  }
  const kept = items.filter(i => i.image)
  console.log(`  ${kept.length}/${items.length} carry a high-resolution image`)

  const toClassify = kept.slice(0, CLASSIFY_TOP)
  console.log(`  Vision check on the top ${toClassify.length}...`)
  for (let i = 0; i < toClassify.length; i += 4) {
    let stop = false
    await Promise.all(toClassify.slice(i, i + 4).map(async it => {
      try { assertBudget('vision') } catch (e) {
        if (e instanceof BudgetExceeded) { stop = true; return }
        throw e
      }
      it.imageKind = await classifyImageUrl(it.image)
      meter.calls++; meter.input += 1400; meter.output += 5 // vision usage is not returned by the helper
    }))
    if (stop) { console.warn('  vision stopped at the budget ceiling; remaining images stay unclassified'); break }
  }
  return kept.length
}

// ── Main ────────────────────────────────────────────────────────────────────

/**
 * Re-source pictures for rows already in the table, touching nothing else.
 *
 * Separate from the ingest because the two go stale for different reasons. A
 * story is scored once and stays scored; its picture depends on what the
 * publisher was serving that day and on where the resolution floor happens to
 * sit, and both of those change. When the floor moved on 11 Aug 2026 every
 * NeuroNews picture in the table was eligible again, and re-running the whole
 * backfill to collect them would have re-fetched and re-scored everything.
 *
 * Costs nothing but vision calls, and those are metered like any other.
 */
async function imagesOnly() {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('news_feed')
      .select('id,url,source,title,metadata').eq('entry_type', 'news').range(from, from + 999)
    if (error) throw new Error(`reading news_feed: ${error.message}`)
    rows.push(...data)
    if (data.length < 1000) break
  }
  const missing = rows.filter(r => !r.metadata?.image && !isAgg(r.url))
  console.log(`${rows.length} news rows, ${rows.filter(r => r.metadata?.image).length} already illustrated`)
  console.log(`${missing.length} have a direct URL and no picture — retrying those\n`)
  if (!missing.length) return

  const items = missing.map(r => ({ ...r, image: null }))
  await sourceImages(items)

  const got = items.filter(i => i.image)
  if (!COMMIT) {
    console.log(`\nDRY RUN — ${got.length} pictures found. Re-run with --commit to store them.`)
    return
  }
  let written = 0
  for (const it of got) {
    const { error } = await sb.from('news_feed')
      .update({ metadata: { ...it.metadata, image: it.image, imageKind: it.imageKind || null, imageW: it.imageW || null, imageH: it.imageH || null } })
      .eq('id', it.id)
    if (error) console.warn(`  update failed for ${it.id}: ${error.message}`)
    else written++
  }
  const { count } = await sb.from('news_feed').select('*', { count: 'exact', head: true })
    .eq('entry_type', 'news').not('metadata->>image', 'is', null)
  console.log(`\n✓ added ${written} pictures — ${count} of ${rows.length} news items now illustrated`)
  console.log(`  spent $${meter.usd.toFixed(4)} over ${meter.calls} calls`)
}

async function main() {
  const started = Date.now()
  const cutoff = Date.now() - DAYS * 864e5

  if (argv.includes('--images-only')) {
    console.log(`\nNeuroBase picture re-source — budget $${BUDGET.toFixed(2)}, ${COMMIT ? 'COMMIT' : 'DRY RUN'}\n`)
    return imagesOnly()
  }
  console.log(`\nNeuroBase news backfill — last ${DAYS} days, budget $${BUDGET.toFixed(2)}, ${COMMIT ? 'COMMIT' : 'DRY RUN'}\n`)

  const raw = await fetchEverything(cutoff, DAYS)
  const unique = collapse(raw)
  const onTopic = unique.filter(onTopicByLexicon)
  console.log(`\n  ${raw.length} in window → ${unique.length} unique → ${onTopic.length} pass the lexicon gate`)

  // Skip anything already stored. This is the difference between a backfill that
  // can be re-run safely and one that costs full price every time.
  const existing = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('news_feed').select('url,title').eq('entry_type', 'news').range(from, from + 999)
    if (error) throw new Error(`reading news_feed: ${error.message}`)
    existing.push(...data)
    if (data.length < 1000) break
  }
  const haveUrl = new Set(existing.map(r => r.url))
  const haveTitle = new Set(existing.map(r => titleKey(r.title)))
  const fresh = onTopic.filter(i => !haveUrl.has(i.url) && !haveTitle.has(titleKey(i.title)))
  console.log(`  ${existing.length} already stored → ${fresh.length} new to score`)

  const estBatches = Math.ceil(fresh.length / 10)
  const estScore = estBatches * 0.0048
  const estVision = Math.min(CLASSIFY_TOP, fresh.length) * 0.0025
  console.log(`  projected: ~$${(estScore + estVision).toFixed(2)} (scoring ~$${estScore.toFixed(2)}, vision ~$${estVision.toFixed(2)})`)

  if (!COMMIT) {
    console.log('\nDRY RUN — no scoring, no writes. Re-run with --commit.')
    const withImg = fresh.filter(i => i.image).length
    const direct = fresh.filter(i => !isAgg(i.url)).length
    console.log(`  of the ${fresh.length} new: ${withImg} arrive with a feed image, ${direct} have a direct publisher URL`)
    // The gate is the one step that discards items silently and for free, so a
    // dry run has to show its work: a gate that is too tight looks exactly like
    // a source that returned nothing.
    const rejected = unique.filter(i => !onTopicByLexicon(i))
    console.log(`\n  sample of ${rejected.length} items the lexicon gate rejected:`)
    for (const r of rejected.slice(0, 12)) console.log(`    · ${r.title.slice(0, 96)}`)
    const bySrc = {}
    for (const i of fresh) bySrc[i.source] = (bySrc[i.source] || 0) + 1
    console.log('\n  new items by source:')
    Object.entries(bySrc).sort((a, b) => b[1] - a[1]).slice(0, 12)
      .forEach(([s, n]) => console.log(`    ${String(n).padStart(4)}  ${s}`))
    return
  }
  if (!fresh.length) { console.log('\nNothing new. Done.'); return }

  console.log(`\nScoring ${fresh.length} items (news shape, no significance paragraph)...`)
  const { scored, aborted } = await scoreNews(fresh)
  const keep = scored.filter(isOnTopic)
  console.log(`  ${keep.length}/${scored.length} cleared the relevance floor (>= ${RELEVANCE_FLOOR})`)
  if (aborted) console.warn('  NOTE: scoring stopped early at the budget ceiling')

  keep.sort((a, b) => mediaScore(b) - mediaScore(a))
  const toStore = keep.slice(0, NEWS_MAX * 3)

  console.log(`\nSourcing pictures for ${toStore.length} items...`)
  await sourceImages(toStore)

  const rows = toStore.map(n => ({
    title: cleanTitle(n.title, n.source),
    summary: n.aiSummary || n.summary || '',
    source: n.source,
    url: n.url,
    published_at: n.publishedAt || new Date().toISOString(),
    topics: n.topics || [],
    relevance_score: n.relevanceScore || 5,
    entry_type: 'news',
    metadata: {
      image: n.image || null,
      imageKind: n.imageKind || null,
      imageW: n.imageW || null,
      imageH: n.imageH || null,
      rankScore: mediaScore(n),
      citationCount: 0,
      significance: '',
      backfill: true,
    },
  }))

  console.log(`\nUpserting ${rows.length} rows...`)
  let written = 0
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100)
    const { error } = await sb.from('news_feed').upsert(chunk, { onConflict: 'url', ignoreDuplicates: false })
    if (error) console.warn(`  upsert error: ${error.message}`)
    else written += chunk.length
  }

  const { count } = await sb.from('news_feed').select('*', { count: 'exact', head: true }).eq('entry_type', 'news')
  console.log(`\n✓ wrote ${written} rows — news_feed now holds ${count} news items`)
  console.log(`  spent $${meter.usd.toFixed(4)} over ${meter.calls} calls ` +
    `(${meter.input.toLocaleString()} in / ${meter.output.toLocaleString()} out) in ${Math.round((Date.now() - started) / 1000)}s`)
}

main().catch(e => {
  if (e instanceof BudgetExceeded) { console.error(`\nSTOPPED: ${e.message}`); process.exit(3) }
  console.error(e)
  process.exit(1)
})
