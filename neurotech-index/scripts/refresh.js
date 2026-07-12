/**
 * refresh.js — daily cron script
 * Pulls new neurotech content from PubMed, arXiv, and NewsAPI,
 * scores each item with Claude, then writes results to Supabase.
 *
 * Run manually:  npm run refresh
 * Runs daily via GitHub Actions at 6am UTC.
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { parseStringPromise } from 'xml2js'

// ── Clients ────────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// ── Config ─────────────────────────────────────────────────────────────────

const PUBMED_TERMS = [
  'brain computer interface',
  'neural interface neurotechnology',
  'neuroprosthetics',
  'deep brain stimulation',
  'electrocorticography BCI',
  'intracortical recording',
  'transcranial magnetic stimulation',
  'functional near-infrared spectroscopy brain',
  'neural implant chronic',
  'brain stimulation therapeutic',
]

const ARXIV_QUERIES = [
  'cat:q-bio.NC AND (ti:brain OR ti:neural OR ti:cortex)',
  'cat:cs.NE AND (abs:brain-computer OR abs:neural interface)',
  'cat:eess.SP AND abs:EEG AND abs:brain',
  'all:brain-computer+interface',
  'all:neural+prosthetics',
]

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
// How far back to pull content. Wider than "this week" so papers are old enough
// to have accrued citations/engagement, which is a ranking input (see computeRank).
const CONTENT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

/**
 * Extract a real publication date (ISO string) from a PubMed <Article>.
 * Prefers <ArticleDate> (electronic pub date, numeric Y/M/D), then falls back
 * to the journal <PubDate>. Month may be numeric ("6") or a name ("Jun").
 * Returns null if no usable year is present.
 */
function parsePubmedDate(art) {
  const src = art?.ArticleDate?.[0] || art?.Journal?.[0]?.JournalIssue?.[0]?.PubDate?.[0]
  const year = parseInt(src?.Year?.[0], 10)
  if (!year) return null
  const rawMonth = src?.Month?.[0]
  let month = 0
  if (rawMonth != null) {
    const n = parseInt(rawMonth, 10)
    month = Number.isNaN(n) ? (MONTHS[String(rawMonth).toLowerCase().slice(0, 3)] ?? 0) : n - 1
  }
  const day = parseInt(src?.Day?.[0], 10) || 1
  const dt = new Date(Date.UTC(year, month, day))
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString()
}

/**
 * Look up real engagement signals (citation counts) from the free Semantic
 * Scholar API and attach them to each item. One batched request for the whole
 * set. Fails soft — if the API is unavailable/rate-limited, items keep 0 and
 * ranking simply leans on relevance + recency.
 */
async function fetchCitations(items) {
  const ids = []
  const idxOf = []
  items.forEach((it, i) => {
    let id = null
    if (it.doi) id = `DOI:${it.doi}`
    else if (it.pmid) id = `PMID:${it.pmid}`
    else if (it.arxivId) id = `ARXIV:${String(it.arxivId).replace(/v\d+$/, '')}`
    if (id) { ids.push(id); idxOf.push(i) }
  })
  if (!ids.length) return
  try {
    const res = await fetch(
      'https://api.semanticscholar.org/graph/v1/paper/batch?fields=citationCount,influentialCitationCount',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }
    )
    if (!res.ok) { console.warn(`  Semantic Scholar ${res.status} — ranking without citations`); return }
    const data = await res.json()
    let hits = 0
    data.forEach((rec, k) => {
      if (!rec) return
      const it = items[idxOf[k]]
      it.citationCount = rec.citationCount ?? 0
      it.influentialCitationCount = rec.influentialCitationCount ?? 0
      hits++
    })
    console.log(`      matched ${hits}/${items.length} items to citation data`)
  } catch (err) {
    console.warn('  Semantic Scholar error — ranking without citations:', err.message)
  }
}

/**
 * Composite ranking score (0–1). Blends the AI relevance score with real
 * engagement (citations, log-scaled) and recency (exponential decay), so the
 * feed order reflects genuine relevance/engagement rather than a single opinion.
 */
function computeRank(item) {
  const aiNorm = (item.relevanceScore ?? 5) / 10
  const citeNorm = Math.min(1, Math.log10(1 + (item.citationCount ?? 0)) / 3)          // ~1000 citations → 1
  const inflNorm = Math.min(1, Math.log10(1 + (item.influentialCitationCount ?? 0)) / 2) // ~100 influential → 1
  const pub = item.publishedAt || item.published_at
  const days = pub ? Math.max(0, (Date.now() - new Date(pub).getTime()) / 86400000) : 120
  const recNorm = Math.exp(-days / 45)                                                  // ~30–45 day half-life
  return 0.40 * aiNorm + 0.25 * citeNorm + 0.15 * inflNorm + 0.20 * recNorm
}

// ── PubMed ─────────────────────────────────────────────────────────────────

async function fetchPubMed() {
  const since = new Date(Date.now() - CONTENT_WINDOW_MS)
  const dateStr = `${since.getFullYear()}/${String(since.getMonth() + 1).padStart(2, '0')}/${String(since.getDate()).padStart(2, '0')}`

  const allPmids = new Set()
  const results = []

  for (const term of PUBMED_TERMS) {
    try {
      const searchUrl =
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi` +
        `?db=pubmed&term=${encodeURIComponent(term)}` +
        `&datetype=pdat&mindate=${dateStr}&retmax=15&retmode=json`

      const res = await fetch(searchUrl)
      const data = await res.json()
      const pmids = (data.esearchresult?.idlist || []).filter(id => !allPmids.has(id))
      pmids.forEach(id => allPmids.add(id))

      if (!pmids.length) { await sleep(400); continue }

      const fetchUrl =
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi` +
        `?db=pubmed&id=${pmids.join(',')}&retmode=xml`

      const fetchRes = await fetch(fetchUrl)
      const xml = await fetchRes.text()
      const parsed = await parseStringPromise(xml, { explicitArray: true })
      const articles = parsed?.PubmedArticleSet?.PubmedArticle || []

      for (const article of articles) {
        try {
          const ml = article.MedlineCitation?.[0]
          const art = ml?.Article?.[0]
          const pmid = String(ml?.PMID?.[0]?._ || ml?.PMID?.[0] || '')
          const title = art?.ArticleTitle?.[0]
          if (!title) continue

          const rawTitle = typeof title === 'object' ? title._ || title['#text'] || '' : String(title)
          if (!rawTitle.trim()) continue

          const authors = (art?.AuthorList?.[0]?.Author || [])
            .map(a => `${a.ForeName?.[0] || ''} ${a.LastName?.[0] || ''}`.trim())
            .filter(Boolean)

          const abstractParts = art?.Abstract?.[0]?.AbstractText || []
          const abstract = abstractParts
            .map(p => (typeof p === 'object' ? p._ || p['#text'] || '' : String(p)))
            .join(' ')
            .trim()

          const journal = art?.Journal?.[0]?.Title?.[0] || ''
          const publishedAt = parsePubmedDate(art)
          const year = publishedAt
            ? String(new Date(publishedAt).getUTCFullYear())
            : (art?.Journal?.[0]?.JournalIssue?.[0]?.PubDate?.[0]?.Year?.[0]
              || String(new Date().getFullYear()))

          const doi = (art?.ELocationID || [])
            .find(e => e.$?.EIdType === 'doi')?._ || null

          results.push({
            title: rawTitle,
            authors,
            abstract,
            journal,
            year,
            publishedAt,
            doi,
            pmid,
            url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
            source: 'pubmed',
          })
        } catch { /* skip malformed article */ }
      }
    } catch (err) {
      console.warn(`PubMed error for "${term}":`, err.message)
    }
    await sleep(400) // respect rate limit
  }

  // Deduplicate by pmid
  const seen = new Set()
  return results.filter(r => { if (seen.has(r.pmid)) return false; seen.add(r.pmid); return true })
}

// ── arXiv ──────────────────────────────────────────────────────────────────

async function fetchArXiv() {
  const cutoff = new Date(Date.now() - CONTENT_WINDOW_MS)
  const results = []

  for (const q of ARXIV_QUERIES) {
    try {
      const url =
        `http://export.arxiv.org/api/query` +
        `?search_query=${encodeURIComponent(q)}&sortBy=submittedDate&sortOrder=descending&max_results=15`

      const res = await fetch(url)
      const xml = await res.text()
      const parsed = await parseStringPromise(xml, { explicitArray: true })
      const entries = parsed?.feed?.entry || []

      for (const entry of entries) {
        const published = entry.published?.[0]
        if (!published || new Date(published) < cutoff) continue

        const idRaw = entry.id?.[0] || ''
        const arxivId = idRaw.split('/abs/')[1]?.split('v')[0]
        if (!arxivId) continue

        const title = entry.title?.[0]?.replace(/\s+/g, ' ').trim()
        const abstract = entry.summary?.[0]?.replace(/\s+/g, ' ').trim()
        const authors = (entry.author || []).map(a => a.name?.[0]).filter(Boolean)

        results.push({
          title,
          authors,
          abstract,
          arxivId,
          url: `https://arxiv.org/abs/${arxivId}`,
          publishedAt: published,
          year: String(new Date(published).getFullYear()),
          source: 'arxiv',
        })
      }
    } catch (err) {
      console.warn(`arXiv error for "${q}":`, err.message)
    }
    await sleep(500)
  }

  const seen = new Set()
  return results.filter(r => {
    if (!r.title || seen.has(r.arxivId)) return false
    seen.add(r.arxivId)
    return true
  })
}

// ── Media & press feeds (RSS · Google News · Reddit · Bluesky) ───────────────
// All free, no API keys. Everything is normalized to the same news-item shape
// { title, summary, url, source, publishedAt, entry_type:'news' } and flows into
// the same AI scoring + ranking as papers.

const UA = 'NeuroBaseBot/1.0 (+https://neurobase.app; neurotech research aggregator)'

// Worldwide press aggregation via Google News RSS (query-based).
const GOOGLE_NEWS_QUERIES = [
  'neurotechnology OR "brain-computer interface" OR "neural implant"',
  '"deep brain stimulation" OR neuroprosthetic OR neurostimulation OR "spinal cord stimulation"',
  'Neuralink OR Synchron OR "Blackrock Neurotech" OR "Precision Neuroscience" OR "Paradromics"',
]
const googleNewsUrl = q =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`

// Curated science-media RSS feeds (verified live; fail soft if any URL changes).
const CURATED_FEEDS = [
  ['https://www.sciencedaily.com/rss/mind_brain/neuroscience.xml', 'ScienceDaily'],
  ['https://neurosciencenews.com/feed/', 'Neuroscience News'],
]

// Free social media: Mastodon publishes public per-hashtag RSS with no auth.
// (Reddit and Bluesky block unauthenticated access; X's API is paid.)
const MASTODON_TAGS = ['neurotech', 'neurotechnology', 'neuroscience', 'BCI']
const mastodonUrl = tag => `https://mastodon.social/tags/${tag}.rss`

function stripHtml(s = '') {
  return String(s).replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}
const first = v => (Array.isArray(v) ? v[0] : v)
const textOf = v => { const x = first(v); return typeof x === 'object' ? (x?._ ?? '') : (x ?? '') }
const toIso = d => { const t = d ? new Date(d).getTime() : NaN; return Number.isNaN(t) ? null : new Date(t).toISOString() }

/** Parse an RSS 2.0 or Atom feed into normalized items. */
async function parseFeed(xml) {
  const doc = await parseStringPromise(xml, { explicitArray: true })
  const out = []
  const channel = doc?.rss?.channel?.[0]
  if (channel?.item) {
    for (const it of channel.item) {
      out.push({
        title: stripHtml(textOf(it.title)),
        url: textOf(it.link),
        summary: stripHtml(textOf(it.description)),
        publishedAt: toIso(textOf(it.pubDate)),
        source: textOf(it.source),
      })
    }
  }
  if (doc?.feed?.entry) {
    for (const e of doc.feed.entry) {
      const links = Array.isArray(e.link) ? e.link : [e.link]
      const link = (links.find(l => l?.$?.rel === 'alternate') || links[0])?.$?.href || textOf(e.link)
      out.push({
        title: stripHtml(textOf(e.title)),
        url: link,
        summary: stripHtml(textOf(e.summary) || textOf(e.content)),
        publishedAt: toIso(textOf(e.published) || textOf(e.updated)),
        source: stripHtml(textOf(e.author?.[0]?.name)),
      })
    }
  }
  return out
}

async function fetchRssFeed(url, label, cap = 15) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) { console.warn(`  ${label} ${res.status} — skipped`); return [] }
    const items = await parseFeed(await res.text())
    return items
      .filter(i => i.title && i.url)
      .map(i => ({ ...i, source: i.source || label, entry_type: 'news' }))
      .slice(0, cap) // feeds are reverse-chronological; keep the newest
  } catch (err) {
    console.warn(`  ${label} error — skipped:`, err.message)
    return []
  }
}

/** Pull every free media/press/social source in parallel, dedupe, cap. */
async function fetchMedia() {
  const cutoff = Date.now() - CONTENT_WINDOW_MS
  const batches = await Promise.all([
    ...GOOGLE_NEWS_QUERIES.map(q => fetchRssFeed(googleNewsUrl(q), 'Google News', 20)),
    ...CURATED_FEEDS.map(([u, l]) => fetchRssFeed(u, l, 12)),
    ...MASTODON_TAGS.map(t => fetchRssFeed(mastodonUrl(t), `#${t} · Mastodon`, 6)),
  ])

  let items = batches.flat().filter(i =>
    i.title && i.url && (!i.publishedAt || new Date(i.publishedAt).getTime() >= cutoff)
  )

  // Dedupe by URL and by a normalized title (cross-source overlap is common).
  const seenUrl = new Set(), seenTitle = new Set(), out = []
  for (const it of items) {
    const tkey = it.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60)
    if (!it.url || seenUrl.has(it.url) || seenTitle.has(tkey)) continue
    seenUrl.add(it.url); seenTitle.add(tkey); out.push(it)
  }

  out.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
  return out.slice(0, 80) // cap to bound scoring cost
}

// ── NewsAPI ────────────────────────────────────────────────────────────────

async function fetchNews() {
  if (!process.env.NEWS_API_KEY) {
    console.log('  NEWS_API_KEY not set — skipping news fetch')
    return []
  }

  const queries = ['neurotechnology', 'brain computer interface', 'Neuralink', 'neural implant']
  const results = []
  const cutoff = new Date(Date.now() - CONTENT_WINDOW_MS)

  for (const q of queries.slice(0, 2)) { // free tier: 100 req/day
    try {
      const url =
        `https://newsapi.org/v2/everything` +
        `?q=${encodeURIComponent(q)}&sortBy=publishedAt&pageSize=15&language=en` +
        `&apiKey=${process.env.NEWS_API_KEY}`

      const res = await fetch(url)
      const data = await res.json()

      for (const a of data.articles || []) {
        if (!a.title || a.title === '[Removed]') continue
        if (new Date(a.publishedAt) < cutoff) continue
        results.push({
          title: a.title,
          summary: a.description || '',
          url: a.url,
          source: a.source?.name || 'News',
          publishedAt: a.publishedAt,
          entry_type: 'news',
        })
      }
    } catch (err) {
      console.warn(`NewsAPI error for "${q}":`, err.message)
    }
    await sleep(500)
  }

  const seen = new Set()
  return results.filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true })
}

// ── Claude scoring ──────────────────────────────────────────────────────────

const TOPIC_TAGS = [
  'EEG', 'ECoG', 'BCI', 'fMRI', 'fNIRS', 'DBS', 'TMS', 'Ultrasound',
  'Neuralink', 'Synchron', 'Motor cortex', 'Speech BCI', 'Somatosensory',
  'ALS', "Parkinson's", 'Spinal cord injury', 'Neural recording', 'Wireless',
  'Implant', 'Consumer', 'Clinical trial', 'Open-source', 'Machine learning',
  'Prosthetics', 'Optogenetics', 'Calcium imaging', 'Connectomics',
]

async function scoreWithClaude(items) {
  const scored = []

  for (let i = 0; i < items.length; i += 5) {
    const batch = items.slice(i, i + 5)

    const prompt = batch
      .map((item, idx) =>
        `[${idx + 1}] TITLE: ${item.title}\nCONTENT: ${(item.abstract || item.summary || '').slice(0, 400)}`
      )
      .join('\n\n---\n\n')

    try {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content:
            `You are an expert in neurotechnology. Rate each item for its significance to the field.\n\n` +
            `For each numbered item, respond with a JSON array element containing:\n` +
            `- "score": integer 1–10. USE THE FULL RANGE and spread scores — do not cluster. ` +
            `Reserve 9–10 for genuine landmark advances only (rare); 7–8 = strong/notable; 5–6 = solid but incremental; ` +
            `3–4 = routine or narrow; 1–2 = tangential. Most items should NOT be 9. Differentiate items within this batch.\n` +
            `- "summary": one crisp sentence on why it matters to neurotech practitioners\n` +
            `- "topics": 1–4 tags chosen ONLY from this list: ${TOPIC_TAGS.join(', ')}\n\n` +
            `Items:\n${prompt}\n\n` +
            `Respond with ONLY a JSON array of ${batch.length} objects, no other text.`,
        }],
      })

      // Claude sometimes wraps JSON in ```json … ``` fences — strip them,
      // then fall back to slicing from the first '[' to the last ']'.
      let raw = response.content[0].text.trim()
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      if (raw[0] !== '[') {
        const start = raw.indexOf('[')
        const end = raw.lastIndexOf(']')
        if (start !== -1 && end !== -1) raw = raw.slice(start, end + 1)
      }
      const parsed = JSON.parse(raw)
      batch.forEach((item, idx) => {
        scored.push({
          ...item,
          relevanceScore: parsed[idx]?.score ?? 5,
          aiSummary: parsed[idx]?.summary || '',
          topics: parsed[idx]?.topics || [],
        })
      })
    } catch (err) {
      console.warn('Claude scoring error:', err.message)
      batch.forEach(item => scored.push({ ...item, relevanceScore: 5, aiSummary: '', topics: [] }))
    }

    await sleep(1200)
  }

  return scored
}

// ── Supabase sync ──────────────────────────────────────────────────────────

async function syncToSupabase(pubmed, arxiv, news) {
  // Upsert PubMed papers into papers table
  if (pubmed.length) {
    const { error } = await supabase.from('papers').upsert(
      pubmed.map(p => ({
        title: p.title,
        authors: p.authors,
        journal: p.journal,
        year: p.year,
        doi: p.doi || null,
        pubmed_id: p.pmid,
        url: p.url,
        abstract: p.abstract || null,
        tags: p.topics || [],
        source: 'pubmed',
      })),
      { onConflict: 'pubmed_id', ignoreDuplicates: true }
    )
    if (error) console.warn('papers upsert error:', error.message)
  }

  // Upsert arXiv papers
  if (arxiv.length) {
    const { error } = await supabase.from('papers').upsert(
      arxiv.map(p => ({
        title: p.title,
        authors: p.authors,
        year: p.year,
        arxiv_id: p.arxivId,
        url: p.url,
        abstract: p.abstract || null,
        tags: p.topics || [],
        source: 'arxiv',
      })),
      { onConflict: 'arxiv_id', ignoreDuplicates: true }
    )
    if (error) console.warn('arxiv upsert error:', error.message)
  }

  // Clear feed entries added more than 7 days ago (by when they entered the
  // feed, not the paper's publication date — older high-impact papers stay).
  await supabase.from('news_feed')
    .delete()
    .lt('created_at', new Date(Date.now() - SEVEN_DAYS_MS).toISOString())

  // Attach a composite rank (relevance + engagement + recency) to metadata.
  const withMeta = (item, base) => ({
    ...base,
    metadata: {
      ...base.metadata,
      rankScore: computeRank(item),
      citationCount: item.citationCount ?? 0,
      influentialCitationCount: item.influentialCitationCount ?? 0,
    },
  })

  // Build combined feed, sorted by the composite rank (not the raw AI score).
  const allItems = [
    ...pubmed.map(p => withMeta(p, {
      title: p.title,
      summary: p.aiSummary || p.abstract?.slice(0, 300) || '',
      source: p.journal || 'PubMed',
      url: p.url,
      published_at: p.publishedAt || new Date().toISOString(),
      topics: p.topics || [],
      relevance_score: p.relevanceScore || 5,
      entry_type: 'paper',
      metadata: { authors: p.authors, journal: p.journal, doi: p.doi, pmid: p.pmid },
    })),
    ...arxiv.map(p => withMeta(p, {
      title: p.title,
      summary: p.aiSummary || p.abstract?.slice(0, 300) || '',
      source: 'arXiv',
      url: p.url,
      published_at: p.publishedAt || new Date().toISOString(),
      topics: p.topics || [],
      relevance_score: p.relevanceScore || 5,
      entry_type: 'preprint',
      metadata: { authors: p.authors, arxivId: p.arxivId },
    })),
    ...news.map(n => withMeta(n, {
      title: n.title,
      summary: n.aiSummary || n.summary || '',
      source: n.source,
      url: n.url,
      published_at: n.publishedAt || new Date().toISOString(),
      topics: n.topics || [],
      relevance_score: n.relevanceScore || 5,
      entry_type: 'news',
      metadata: {},
    })),
  ].sort((a, b) => b.metadata.rankScore - a.metadata.rankScore)

  // Upsert top 60 into news_feed
  for (const item of allItems.slice(0, 60)) {
    const { error } = await supabase.from('news_feed').upsert(item, {
      onConflict: 'url',
      ignoreDuplicates: false,
    })
    if (error && !error.message.includes('duplicate')) {
      console.warn('news_feed upsert error:', error.message)
    }
  }

  console.log(
    `✓ Synced: ${pubmed.length} PubMed | ${arxiv.length} arXiv | ${news.length} news` +
    ` → ${Math.min(allItems.length, 60)} feed items`
  )
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.')
    process.exit(1)
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY must be set.')
    process.exit(1)
  }

  console.log('🧠 Neurotech Index refresh — ' + new Date().toUTCString())

  console.log('\n[1/4] Fetching PubMed papers...')
  const pubmed = await fetchPubMed()
  console.log(`      ${pubmed.length} new papers`)

  console.log('[2/4] Fetching arXiv preprints...')
  const arxiv = await fetchArXiv()
  console.log(`      ${arxiv.length} new preprints`)

  console.log('[3/4] Fetching media & press (Google News · science RSS · Mastodon)...')
  const media = await fetchMedia()
  const apiNews = await fetchNews() // NewsAPI, only if a key is set
  const news = [...media, ...apiNews]
  console.log(`      ${news.length} media/press items`)

  const total = pubmed.length + arxiv.length + news.length
  if (total === 0) {
    console.log('\nNothing new to process. Done.')
    return
  }

  console.log(`\n[4/5] Scoring ${total} items with Claude haiku...`)
  const allItems = [...pubmed, ...arxiv, ...news]
  const scored = await scoreWithClaude(allItems)

  console.log('[5/5] Fetching citation counts (Semantic Scholar)...')
  await fetchCitations(scored)

  const scoredPubmed = scored.filter(i => i.source === 'pubmed')
  const scoredArxiv = scored.filter(i => i.source === 'arxiv')
  const scoredNews = scored.filter(i => i.entry_type === 'news')

  console.log('\nSyncing to Supabase...')
  await syncToSupabase(scoredPubmed, scoredArxiv, scoredNews)

  console.log('\n✅ Refresh complete — ' + new Date().toUTCString())
}

main().catch(err => { console.error(err); process.exit(1) })
