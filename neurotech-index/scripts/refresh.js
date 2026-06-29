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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// ── PubMed ─────────────────────────────────────────────────────────────────

async function fetchPubMed() {
  const since = new Date(Date.now() - SEVEN_DAYS_MS)
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
          const year = art?.Journal?.[0]?.JournalIssue?.[0]?.PubDate?.[0]?.Year?.[0]
            || String(new Date().getFullYear())

          const doi = (art?.ELocationID || [])
            .find(e => e.$?.EIdType === 'doi')?._ || null

          results.push({
            title: rawTitle,
            authors,
            abstract,
            journal,
            year,
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
  const cutoff = new Date(Date.now() - SEVEN_DAYS_MS)
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

// ── NewsAPI ────────────────────────────────────────────────────────────────

async function fetchNews() {
  if (!process.env.NEWS_API_KEY) {
    console.log('  NEWS_API_KEY not set — skipping news fetch')
    return []
  }

  const queries = ['neurotechnology', 'brain computer interface', 'Neuralink', 'neural implant']
  const results = []
  const cutoff = new Date(Date.now() - SEVEN_DAYS_MS)

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
            `- "score": integer 1–10 (10 = landmark result; 7+ = important; 4–6 = routine; 1–3 = low relevance)\n` +
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

  // Clear news_feed items older than 7 days
  await supabase.from('news_feed')
    .delete()
    .lt('published_at', new Date(Date.now() - SEVEN_DAYS_MS).toISOString())

  // Build combined feed, sorted by score descending
  const allItems = [
    ...pubmed.map(p => ({
      title: p.title,
      summary: p.aiSummary || p.abstract?.slice(0, 300) || '',
      source: p.journal || 'PubMed',
      url: p.url,
      published_at: new Date().toISOString(),
      topics: p.topics || [],
      relevance_score: p.relevanceScore || 5,
      entry_type: 'paper',
      metadata: { authors: p.authors, journal: p.journal, doi: p.doi, pmid: p.pmid },
    })),
    ...arxiv.map(p => ({
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
    ...news.map(n => ({
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
  ].sort((a, b) => b.relevance_score - a.relevance_score)

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

  console.log('[3/4] Fetching news...')
  const news = await fetchNews()
  console.log(`      ${news.length} news items`)

  const total = pubmed.length + arxiv.length + news.length
  if (total === 0) {
    console.log('\nNothing new to process. Done.')
    return
  }

  console.log(`\n[4/4] Scoring ${total} items with Claude haiku...`)
  const allItems = [...pubmed, ...arxiv, ...news]
  const scored = await scoreWithClaude(allItems)

  const scoredPubmed = scored.filter(i => i.source === 'pubmed')
  const scoredArxiv = scored.filter(i => i.source === 'arxiv')
  const scoredNews = scored.filter(i => i.entry_type === 'news')

  console.log('\nSyncing to Supabase...')
  await syncToSupabase(scoredPubmed, scoredArxiv, scoredNews)

  console.log('\n✅ Refresh complete — ' + new Date().toUTCString())
}

main().catch(err => { console.error(err); process.exit(1) })
