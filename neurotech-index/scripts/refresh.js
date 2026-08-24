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
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { syncTrials } from './trials.js'
import { classify } from '../src/lib/classify.js'
import { scanReproLinks } from '../src/lib/repro.js'
import { resolvePaperImage, classifyTechnology, loadClassImages, pickClassImage, FALLBACK_CLASS, queueCandidate, flushQueue } from './lib/images.js'
import { load as loadReview, approved as approvedInReview, decided as decidedInReview } from './lib/review.js'
import { NEUROTECH_LEXICON, onTopicByLexicon } from './lib/lexicon.js'
import { NOTABLE_MAX, NOTABLE_PCTILE_MIN, NOTABLE_WINDOW_DAYS, feedCandidates } from './lib/notable.js'

const NOTABLE_PATH = join(dirname(fileURLToPath(import.meta.url)), '../src/data/notable.json')

// The reviewed picture decisions, read once. Nothing in this run writes them;
// the queue of pictures still needing one is flushed at the end of main().
let REVIEW = null
const reviewStore = () => (REVIEW ||= loadReview())

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

// Keep only what the model scored as neurotech-CENTRAL (5+). General
// neuroscience, neuroimaging findings, genetics, drugs, and medical news score
// 1 to 4 and are dropped, so the feed stays about neurotechnology specifically.
//
// This applies to every channel, not only to media. A paper is admitted on the
// same terms as a press item: a study that USES electrodes or imaging to ask a
// question about the brain is neuroscience, and this index is about the
// instruments. Papers used to ride in ungated, held back only by ranking below
// the storage cutoff, which is not a filter — it is an accident that holds
// until an off-topic paper outranks something.
const RELEVANCE_FLOOR = 5

/** Claude's 1-to-10 neurotech centrality, wherever on the record it is kept. */
const relevanceOf = x => x?.relevance ?? x?.relevanceScore ?? x?.relevance_score ?? null

/** Is this item about neurotechnology, rather than merely near it? An item
 *  that was never scored is given the benefit of the doubt, as it always was. */
const isOnTopic = x => (relevanceOf(x) ?? RELEVANCE_FLOOR) >= RELEVANCE_FLOOR

// Provenance stamp: written to source_url / last_updated / pipeline_version on
// every row this run touches, so a record is traceable to its ingestion.
const PIPELINE_VERSION = 'refresh-2026-07'

// Code/data availability links detected in a paper's title + abstract.
function reproCols(p) {
  const { code, data } = scanReproLinks(`${p.title || ''} ${p.abstract || ''}`)
  return { code_urls: code, data_urls: data }
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
// How far back to pull content. Wider than "this week" so papers are old enough
// to have accrued citations/engagement, which is a ranking input (see computeRank).
// Doubles as the retention window for news (see syncToSupabase).
const CONTENT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000

// How many news items one run may store, cut against other news rather than
// against papers. This is a ceiling on a DAY's ingest, not on the table: the
// 90-day retention window is what decides how much accumulates behind it.
const NEWS_MAX = 400
// Candidates fetched per run before scoring. The lexicon gate and the relevance
// floor cut this down; the cap only exists so a source that suddenly returns its
// whole archive cannot run the scoring bill away unnoticed.
const MEDIA_CANDIDATE_CAP = 900

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

// ── Media-specific ranking (news / press) ────────────────────────────────────
// News has no citations, so computeRank scored it ~0. Rank instead on outlet
// authority + relevance + recency (news decays fast: 3-day half-life).
const MEDIA_TIERS = [
  [1.00, ['nature', 'science', 'the new york times', 'reuters', 'associated press', 'the washington post',
          'stat', 'mit technology review', 'ieee spectrum', 'scientific american', 'the economist',
          'nih', 'the lancet', 'nejm']],
  [0.75, ['wired', 'ars technica', 'the guardian', 'new atlas', 'sciencedaily', 'science news',
          'nature news', 'the verge', 'quanta', 'npr', 'bbc', 'financial times']],
  [0.55, ['techcrunch', 'gizmodo', 'engadget', 'medgadget', 'endpoints', 'fierce']],
]
// RSS / Google-News titles often carry the outlet name as a prefix ("STAT+: …")
// or a trailing " - Publisher". Strip it when it matches the item's own source
// (high precision — we never touch a headline that merely contains a dash).
function cleanTitle(title, source) {
  let t = (title || '').trim()
  const src = (source || '').trim()
  if (src) {
    const esc = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    t = t.replace(new RegExp('^' + esc + '\\+?\\s*[:\\-–—]\\s*', 'i'), '') // leading "Source: "
    t = t.replace(new RegExp('\\s*[-|–—]\\s*' + esc + '\\s*$', 'i'), '')   // trailing " - Source"
  }
  t = t.replace(/^[A-Z][\w.&]{0,10}\+:\s*/, '') // catches "STAT+: " even if source label differs
  return t.trim() || (title || '').trim()
}

const normTitle = t => (t || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()

// The same story reaches the feed as separate rows with different URLs: via
// Google News (aggregator redirect) AND the publisher's own RSS, and a journal
// article shows up as both a 'news' item (publisher RSS) and a 'paper' (PubMed).
// url-unique dedup misses all of these. Collapse feed rows sharing a normalized
// title, keeping the best copy — a real image (the feed's visual slots need
// one), then the richer research detail page over a generic news link, then a
// direct URL over a news.google.com redirect, then the higher rank. Trials are
// exempt. Returns the number of rows removed.
async function dedupeFeedRows(supabase) {
  const { data, error } = await supabase.from('news_feed')
    .select('id,title,url,entry_type,metadata').in('entry_type', ['paper', 'preprint', 'news'])
  if (error || !data) return 0
  const groups = new Map()
  for (const r of data) {
    const k = normTitle(r.title)
    if (!k) continue
    const arr = groups.get(k)
    if (arr) arr.push(r); else groups.set(k, [r])
  }
  const isAgg = u => /news\.google\.com/i.test(u || '')
  const typeRank = { paper: 2, preprint: 2, news: 1 }
  const better = (a, b) => {
    const ai = a.metadata?.imageKind === 'real', bi = b.metadata?.imageKind === 'real'
    if (ai !== bi) return ai ? a : b                                      // keep the one with a real image
    if (isAgg(a.url) !== isAgg(b.url)) return isAgg(a.url) ? b : a        // prefer a direct publisher URL
    const ta = typeRank[a.entry_type] || 0, tb = typeRank[b.entry_type] || 0
    if (ta !== tb) return ta > tb ? a : b                                // prefer the research detail page
    return (b.metadata?.rankScore ?? 0) > (a.metadata?.rankScore ?? 0) ? b : a
  }
  const toDelete = []
  for (const rows of groups.values()) {
    if (rows.length < 2) continue
    let keep = rows[0]
    for (const r of rows.slice(1)) keep = better(keep, r)
    for (const r of rows) if (r.id !== keep.id) toDelete.push(r.id)
  }
  for (let i = 0; i < toDelete.length; i += 200)
    await supabase.from('news_feed').delete().in('id', toDelete.slice(i, i + 200))
  return toDelete.length
}

function mediaAuthority(source) {
  const s = (source || '').toLowerCase()
  if (!s) return 0.40
  for (const [score, keys] of MEDIA_TIERS) if (keys.some(k => s.includes(k))) return score
  return 0.45 // known outlet, untiered
}
function mediaScore(item) {
  const relevance = clamp01((item.relevanceScore ?? item.relevance_score ?? 5) / 10)
  const recency = Math.exp(-daysOld(item.publishedAt || item.published_at) * Math.LN2 / 3) // 3-day half-life
  const authority = mediaAuthority(item.source)
  // Relevance-dominant: neurotech relevance should drive what surfaces, above
  // freshness or outlet prestige.
  return 0.50 * relevance + 0.30 * recency + 0.20 * authority
}

// ── Research-specific ranking (papers / preprints) ───────────────────────────
// Unlike computeRank (which uses raw, log-scaled citation counts and so buries
// anything recent), this leans on OpenAlex's FIELD- and AGE-normalized impact
// percentile — a 6-citation paper can be top-1%-for-its-cohort. See NOTABLE_*.

const clamp01 = x => Math.max(0, Math.min(1, x))
const daysOld = d => (d ? Math.max(0, (Date.now() - new Date(d).getTime()) / 864e5) : 240)

// Curated venue prestige — the key DAY-ONE signal (fresh papers have no
// citations, so venue is what tells a landmark from a nobody on publication day).
const VENUE_TIERS = [
  [1.00, ['nature', 'science', 'cell', 'neuron', 'nature neuroscience', 'nature medicine',
          'nature biomedical engineering', 'lancet', 'new england journal']],
  [0.85, ['nature communications', 'science advances', 'pnas', 'brain', 'nature methods',
          'jama', 'science translational medicine', 'elife']],
  [0.70, ['journal of neuroscience', 'neuroimage', 'ieee trans', 'journal of neural engineering',
          'brain stimulation', 'annals of neurology', 'movement disorders']],
  [0.55, ['frontiers in', 'plos', 'scientific reports', 'journal of neurophysiology']],
]
function venuePrestige(venue) {
  const v = (venue || '').toLowerCase()
  if (!v) return 0.40
  for (const [score, keys] of VENUE_TIERS) if (keys.some(k => v.includes(k))) return score
  return 0.45 // known venue, untiered
}

const RESEARCH_W = { relevance: 0.28, recency: 0.22, impact: 0.30, velocity: 0.10, prestige: 0.10 }

/**
 * Impact is only TRUSTWORTHY once a paper has accrued signal: OpenAlex
 * percentiles are noise when the whole same-age cohort has ~0 citations.
 * Gate on citedBy≥3 OR age>60d.
 */
function impactTrusted(item) {
  return (item.pctile != null || item.fwci != null) && ((item.citedBy ?? 0) >= 3 || daysOld(item.publishedAt || item.published_at || item.oaDate) > 60)
}

function researchScore(item) {
  const relevance = clamp01((item.relevanceScore ?? item.relevance_score ?? 5) / 10)
  const recency = Math.exp(-daysOld(item.publishedAt || item.published_at) * Math.LN2 / 180) // 180-day half-life
  const velocity = clamp01(Math.log10(1 + (item.recentCites ?? 0)) / 2) // ~100 recent cites → 1
  const prest = venuePrestige(item.oaVenue || item.journal)

  let impact = null
  if (impactTrusted(item)) {
    impact = item.pctile != null ? clamp01(item.pctile) : clamp01(Math.log10(1 + item.fwci) / 1.5)
  }

  const W = RESEARCH_W
  if (impact == null) {
    // Fresh / uncited / not-yet-indexed: drop impact, redistribute its weight
    // onto the day-one signals so new papers compete on relevance/recency/venue.
    const rest = W.relevance + W.recency + W.velocity + W.prestige
    const k = 1 + W.impact / rest
    return k * (W.relevance * relevance + W.recency * recency + W.velocity * velocity + W.prestige * prest)
  }
  return W.relevance * relevance + W.recency * recency + W.impact * impact + W.velocity * velocity + W.prestige * prest
}

/**
 * Enrich items (in place) with OpenAlex field-normalized impact — the signal
 * computeRank can't see. Batched by DOI (25/req, polite pool). Fails soft.
 */
const OA_FIELDS = 'doi,fwci,citation_normalized_percentile,cited_by_count,counts_by_year,primary_location,publication_date'
async function enrichOpenAlex(items) {
  const withDoi = items.filter(i => i.doi)
  if (!withDoi.length) return
  let matched = 0
  for (let i = 0; i < withDoi.length; i += 25) {
    const batch = withDoi.slice(i, i + 25)
    const filter = 'doi:' + batch.map(b => b.doi.toLowerCase()).join('|')
    const url = `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}&select=${OA_FIELDS}&per-page=25&mailto=sid.a.harr@gmail.com`
    try {
      const res = await fetch(url)
      if (!res.ok) { console.warn(`  OpenAlex ${res.status}`); await sleep(1000); continue }
      const { results = [] } = await res.json()
      const byDoi = new Map()
      for (const w of results) {
        const d = (w.doi || '').replace('https://doi.org/', '').toLowerCase()
        if (d) byDoi.set(d, w)
      }
      const yr = new Date().getUTCFullYear()
      for (const b of batch) {
        const w = byDoi.get(b.doi.toLowerCase())
        if (!w) continue
        b.pctile = w.citation_normalized_percentile?.value ?? null
        b.fwci = w.fwci ?? null
        b.citedBy = w.cited_by_count ?? 0
        b.recentCites = (w.counts_by_year || []).filter(c => c.year >= yr - 1).reduce((s, c) => s + (c.cited_by_count || 0), 0)
        b.oaVenue = w.primary_location?.source?.display_name || null
        b.oaDate = w.publication_date || null
        matched++
      }
    } catch (err) { console.warn('  OpenAlex error:', err.message) }
    await sleep(300)
  }
  console.log(`      matched ${matched}/${withDoi.length} papers to OpenAlex impact data`)
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
// Some publishers 403 an honest bot string. Declared per feed rather than used
// globally, so the default stays identifiable and the exceptions stay visible.
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0 Safari/537.36'

// Worldwide press aggregation via Google News RSS (query-based).
//
// Measured 10 Aug 2026: these ten queries return 691 unique neurotech items in a
// single pass, against 60 for the three queries that preceded them. Google News
// serves up to 100 items per query and the old code took 20, so most of what the
// site was missing was never a missing SOURCE — it was this cap. Queries are
// grouped by what they catch (field, modality, company, regulatory, clinical) so
// a gap is visible as a missing group rather than a missing keyword.
const GOOGLE_NEWS_QUERIES = [
  'neurotechnology OR "brain-computer interface" OR "neural implant"',
  '"deep brain stimulation" OR neuroprosthetic OR neurostimulation OR "spinal cord stimulation"',
  'Neuralink OR Synchron OR "Blackrock Neurotech" OR "Precision Neuroscience" OR Paradromics',
  '"Science Corporation" OR "Motif Neurotech" OR INBRAIN OR Axoft OR Subsense OR "Merge Labs"',
  '"Onward Medical" OR "Neuros Medical" OR "Saluda Medical" OR Nevro OR NeuroPace OR CVRx',
  '"cochlear implant" OR "retinal implant" OR "visual prosthesis" OR "auditory brainstem implant"',
  '"vagus nerve stimulation" OR "transcranial magnetic stimulation" OR "focused ultrasound" neuromodulation',
  '"EEG headset" OR "dry electrode" OR "neural decoding" OR electrocorticography',
  '"FDA clearance" OR "FDA approval" neural OR neurostimulation OR neurotechnology',
  '"BCI clinical trial" OR "brain implant" patient OR paralysis speech restored',
]
const googleNewsUrl = q =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`
// The gate itself lives in scripts/lib/lexicon.js so it can be unit-tested
// without live credentials; see scripts/lexicon.test.js. Re-exported below for
// scripts/backfill-news.js, which runs the same gate.

// Curated science-media RSS feeds (image-rich where possible; fail soft if a
// URL changes). Off-topic items are filtered out by AI relevance scoring.
const CURATED_FEEDS = [
  ['https://www.sciencedaily.com/rss/mind_brain/neuroscience.xml', 'ScienceDaily'],
  // 403s the bot UA and serves fine to a browser one. Verified 11 Aug 2026.
  ['https://neurosciencenews.com/feed/', 'Neuroscience News', { ua: BROWSER_UA }],
  ['https://news.mit.edu/rss/topic/neuroscience', 'MIT News'],
  ['https://spectrum.ieee.org/feeds/topic/biomedical.rss', 'IEEE Spectrum'],
  ['https://www.thetransmitter.org/feed/', 'The Transmitter'],
  // Neuro-specific trade press, and the richest picture source of the set: the
  // feed carries a media tag on essentially every item, so these arrive already
  // illustrated and never need an Open Graph scrape. It serves a deep archive
  // rather than a recent slice, hence the raised cap — CONTENT_WINDOW_MS trims
  // the tail.
  ['https://neuronewsinternational.com/feed/', 'NeuroNews', { cap: 200 }],
  ['https://www.medicaldesignandoutsourcing.com/feed/', 'Medical Design and Outsourcing'],
  // Medgadget removed 11 Aug 2026: the host fails to connect at all, on both UAs,
  // which is a dead domain rather than a block.
  ['https://www.nature.com/subjects/neuroscience.rss', 'Nature'],
  ['https://elifesciences.org/rss/recent.xml', 'eLife'],
  ['https://www.statnews.com/feed/', 'STAT'],
  ['https://www.fiercebiotech.com/rss/xml', 'Fierce Biotech'],
  ['https://www.sciencenews.org/feed', 'Science News'],
  ['https://singularityhub.com/feed/', 'Singularity Hub'],
  ['https://www.sciencedaily.com/rss/health_medicine/nervous_system.xml', 'ScienceDaily'],
  ['https://newatlas.com/index.rss', 'New Atlas'],
  ['https://www.frontiersin.org/journals/neuroscience/rss', 'Frontiers'],

  // ── General science and technology desks ──────────────────────────────────
  //
  // Broad feeds, deliberately. They are not neurotech publications and most of
  // what they carry is filtered out by the lexicon gate — but what survives is
  // worth more per item than anything else we fetch, because these publish a
  // DIRECT article URL with a real image attached. Everything arriving through
  // Google News is a redirect wrapper that cannot be resolved or scraped, so
  // this block is most of what puts a photograph on a card.
  //
  // Verified reachable with image tags on 11 Aug 2026; counts are items/media
  // tags in one pull.
  ['https://www.theguardian.com/science/rss', 'The Guardian'],                        // 27 / 81
  ['https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', 'BBC News'],       // 42 / 42
  ['https://www.statnews.com/category/health-tech/feed/', 'STAT Health Tech'],         // 20 / 40
  ['https://www.wired.com/feed/category/science/latest/rss', 'WIRED'],                 // 20 / 40
  ['https://feeds.arstechnica.com/arstechnica/science', 'Ars Technica'],               // 20 / 40
  ['https://spectrum.ieee.org/feeds/feed.rss', 'IEEE Spectrum'],                       // 30 / 30
  ['https://medicalxpress.com/rss-feed/', 'Medical Xpress'],                           // 30 / 30
  ['https://www.newscientist.com/subject/health/feed/', 'New Scientist'],              // 10 / 10
  ['https://interestingengineering.com/feed', 'Interesting Engineering'],              // 10 / 6

  // ── Press releases ────────────────────────────────────────────────────────
  //
  // The "Press" half of the section's name. Company and institutional
  // announcements are primary sources — an FDA clearance, a funding round, a
  // first-in-human — and they reach the wires before any outlet writes them up.
  // Broad health feeds, filtered by the lexicon gate like everything else.
  //
  // Verified 11 Aug 2026. Business Wire is absent on purpose: its documented
  // feed IDs answer 200 with an empty body, so there is nothing to parse.
  ['https://www.prnewswire.com/rss/health-latest-news/health-latest-news-list.rss', 'PR Newswire'],
  ['https://www.prnewswire.com/rss/health/medical-pharmaceuticals-list.rss', 'PR Newswire'],
  ['https://www.globenewswire.com/RssFeed/subjectcode/26-Health/feedTitle/GlobeNewswire%20-%20Health', 'GlobeNewswire'],
]

// GDELT — free global news firehose across thousands of outlets.
const GDELT_QUERIES = [
  '"brain computer interface"', '"brain machine interface"', '"neural implant"',
  '"deep brain stimulation"', 'neurotechnology', '"neural interface"', '"brain implant"',
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

/** Pull an image URL out of an RSS/Atom item (media tags, enclosure, or <img>). */
function pickImage(node) {
  const attr = x => (Array.isArray(x) ? x[0] : x)?.$?.url
  const cand =
    attr(node['media:content']) ||
    attr(node['media:thumbnail']) ||
    attr(node['media:group']?.[0]?.['media:content']) ||
    (node.enclosure || []).map(e => e?.$).find(a => (a?.type || '').startsWith('image/'))?.url ||
    // <img src="…"> embedded in the description/content HTML
    (textOf(node.description) || textOf(node.content) || textOf(node.summary) || '')
      .match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]
  if (!cand || !/^https?:\/\//i.test(cand)) return null
  return cand
}

/** Best-effort Open Graph image scrape for a direct article URL. Fails soft. */
async function getOgImage(url) {
  if (!url || url.includes('news.google.com')) return null // redirect wrappers — skip
  try {
    const ctl = AbortSignal.timeout(4500)
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl, redirect: 'follow' })
    if (!res.ok) return null
    const html = (await res.text()).slice(0, 200_000)
    const m =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
    const img = m?.[1]
    return img && /^https?:\/\//i.test(img) ? img : null
  } catch { return null }
}

/** Read pixel dimensions from an image buffer's header (JPEG/PNG/GIF/WebP). */
function getImageSize(buf) {
  if (!buf || buf.length < 24) return null
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
  // WebP (RIFF….WEBP)
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fourcc = buf.toString('ascii', 12, 16)
    if (fourcc === 'VP8X') return { width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)) }
    if (fourcc === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
    if (fourcc === 'VP8L') { const b = buf.readUInt32LE(21); return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) } }
    return null
  }
  // JPEG
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let o = 2
    while (o < buf.length - 8) {
      if (buf[o] !== 0xFF) { o++; continue }
      const marker = buf[o + 1]
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return { width: buf.readUInt16BE(o + 7), height: buf.readUInt16BE(o + 5) }
      }
      o += 2 + buf.readUInt16BE(o + 2)
    }
  }
  return null
}

/** Fetch an image and return its dimensions, or null. */
async function measureImage(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const dim = getImageSize(Buffer.from(await res.arrayBuffer()))
    return dim && dim.width && dim.height ? dim : null
  } catch { return null }
}

/**
 * The floor for a picture we are willing to feature.
 *
 * 900/500 originally, relaxed to 700/400 on 11 Aug 2026 because that pair was
 * set against the home page lead and, applied uniformly, threw away pictures
 * that are sharp in a card. Set to 800/450 on 23 Aug 2026, which is that same
 * reasoning done with the real measurements: STORY_MIN_W in src/lib/image.js
 * is the largest card frame at a 2x device pixel ratio plus a crop margin, and
 * this is the same pair. A picture stored below the page's floor is kept and
 * then never shown, which reads in the database as coverage the page does not
 * have.
 *
 * Set to 700/400 rather than 800/450 after measuring what the floor actually
 * excluded: eight of the twenty pictures in the whole index sit between 600 and
 * 800 on the long edge, most of them the 766x512 NeuroNews publishes everything
 * at. A 766 across a 620-pixel card frame is not enlarged; 800 was a generous
 * rounding rather than a derivation. The lead keeps its own, higher floor,
 * because 766 across a 1024-pixel lead frame IS enlarged.
 *
 * It also still does the job it was written for: rejecting the 300x200 and
 * 400x225 thumbnails that RSS media tags are full of.
 */
const HI_RES = d => !!d && Math.max(d.width, d.height) >= 700 && Math.min(d.width, d.height) >= 400

/**
 * Classify each item's image as a REAL photograph/microscopy/scientific figure
 * vs a generic STOCK illustration/3D render. Sets item.imageKind to 'real' or
 * 'stock', and to null when nobody has looked at the picture yet — which the
 * page reads as no picture, and which is the point. This is what lets the
 * homepage guarantee its top story never runs stock art.
 *
 * The answer used to come from a vision call per image per night. It now comes
 * from src/data/image-review.json, written by the daily reviewer; an image
 * with no ruling is queued for one. See scripts/lib/review.js.
 */
function classifyImageUrl(url) {
  if (!decidedInReview(reviewStore(), url)) {
    queueCandidate(url, { why: 'unreviewed' })
    return null
  }
  return approvedInReview(reviewStore(), url) ? 'real' : 'stock'
}

async function classifyImages(items) {
  const withImg = items.filter(i => i.image)
  for (let i = 0; i < withImg.length; i += 4) {
    await Promise.all(withImg.slice(i, i + 4).map(async it => { it.imageKind = await classifyImageUrl(it.image) }))
  }
  const real = withImg.filter(i => i.imageKind === 'real').length
  console.log(`      image check: ${real} real / ${withImg.length} classified`)
}

/**
 * Give the day's items a picture, in the order the pipeline trusts them.
 *
 *   1. the paper's OWN figure, from bioRxiv/medRxiv or from Europe PMC when it
 *      is open access. Publisher pages 403 every script, so a paywalled paper
 *      has no figure to be had.
 *   2. a labelled photograph of the technology, from the reviewed pool in
 *      src/data/class-images.json. Marked subject='class', which is what
 *      makes the page label it and print the credit.
 *
 * News keeps the photograph its outlet published, sourced earlier in the run.
 * Everything the pipeline writes carries its provenance: source, credit,
 * licence and the page the file is described on. See scripts/lib/images.js.
 */
async function enrichWithFigures(sortedItems, limit = 60) {
  const pool = loadClassImages()
  const targets = sortedItems.slice(0, limit)
  let own = 0, cls = 0

  const stamp = (it, img) => {
    Object.assign(it.metadata, {
      image: img.url,
      imageKind: img.kind,
      imageSubject: img.subject,
      imageCredit: img.credit || null,
      imageLicense: img.license || null,
      imageLicenseUrl: img.licenseUrl || null,
      imageSource: img.source,
      imageSourceUrl: img.sourceUrl || null,
      imageClassId: img.classId || null,
      imageW: img.w || null,
      imageH: img.h || null,
      imageCheckedAt: new Date().toISOString(),
    })
  }

  const needFigure = targets.filter(it =>
    (it.entry_type === 'paper' || it.entry_type === 'preprint') && !it.metadata.image && it.url)
  for (let i = 0; i < needFigure.length; i += 5) {
    await Promise.all(needFigure.slice(i, i + 5).map(async it => {
      const img = await resolvePaperImage(it)
      if (img) { stamp(it, img); own++ }
    }))
  }

  // The class fallback costs no API calls: the pool is resolved and reviewed
  // once, by scripts/build-class-images.js.
  for (const it of targets) {
    if (it.metadata.image) continue
    const match = classifyTechnology(it)
    if (!match) continue
    const seed = it.source_id || it.title || ''
    for (const id of [match.id, FALLBACK_CLASS].filter(Boolean)) {
      const img = pickClassImage(pool, id, seed)
      if (img) { stamp(it, { ...img, classId: id, subject: 'class' }); cls++; break }
    }
  }

  console.log(`      figures: ${own} of the paper's own, ${cls} labelled class photographs (top ${targets.length})`)
}

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
        image: pickImage(it),
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
        image: pickImage(e),
      })
    }
  }
  return out
}

async function fetchRssFeed(url, label, cap = 15, ua = UA) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(30_000) })
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

const gdeltDate = d => (d && d.length >= 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T00:00:00Z` : null)

/** GDELT global news firehose (thousands of outlets), one request per query. */
async function fetchGdelt() {
  const out = []
  let ok = 0, throttled = 0, failed = 0
  for (const [n, q] of GDELT_QUERIES.entries()) {
    // GDELT publishes a hard limit of one request every five seconds and answers
    // a violation with a 200-shaped plaintext scolding, not an error status. The
    // old loop slept 300ms and ran `JSON.parse` inside a `catch { continue }`, so
    // every throttled query parsed as a failure and was skipped in silence: the
    // step reported success having contributed nothing, and had been doing so for
    // as long as anyone can tell. Diagnosed 11 Aug 2026.
    //
    // Ten seconds, not five. The published limit is a floor, and a burst earns a
    // cooldown well beyond it; a daily run can afford to be patient with a source
    // that hands over a direct publisher URL and an already-extracted image.
    if (n) await sleep(10_000)
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}` +
      `&mode=artlist&format=json&maxrecords=250&sort=datedesc&timespan=3w`
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45_000) })
      const text = await res.text()
      if (!text.trimStart().startsWith('{')) {
        // Throttle replies are plaintext. One retry after a long pause; GDELT is
        // worth waiting for, but not worth stalling the whole run over.
        throttled++
        console.warn(`  GDELT throttled on "${q}" — retrying in 30s`)
        await sleep(30_000)
        const retry = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45_000) })
        const rtext = await retry.text()
        if (!rtext.trimStart().startsWith('{')) { console.warn(`  GDELT still throttled on "${q}" — skipped`); continue }
        for (const a of (JSON.parse(rtext).articles || [])) {
          if (!a.url || !a.title || a.language !== 'English') continue
          out.push({ title: a.title, url: a.url, summary: '', source: a.domain || 'GDELT', publishedAt: gdeltDate(a.seendate), image: a.socialimage || null, entry_type: 'news' })
        }
        ok++
        continue
      }
      for (const a of (JSON.parse(text).articles || [])) {
        if (!a.url || !a.title || a.language !== 'English') continue
        out.push({ title: a.title, url: a.url, summary: '', source: a.domain || 'GDELT', publishedAt: gdeltDate(a.seendate), image: a.socialimage || null, entry_type: 'news' })
      }
      ok++
    } catch (e) {
      failed++
      console.warn(`  GDELT error on "${q}": ${e.message}`)
    }
  }
  // Say what happened. A source that contributes nothing must not look identical
  // to one that was never configured.
  console.log(`      GDELT: ${ok}/${GDELT_QUERIES.length} queries answered, ` +
    `${out.length} articles (${out.filter(i => i.image).length} with an image)` +
    `${throttled ? `, ${throttled} throttled` : ''}${failed ? `, ${failed} errored` : ''}`)
  if (!ok) console.warn('::warning::GDELT returned nothing this run — check rate limiting')
  return out
}

/**
 * Pull every free media/press/social source in parallel, dedupe, gate, cap.
 *
 * This function no longer touches images. Sourcing a picture costs an Open Graph
 * scrape, an image download to measure it, and a vision call — and it used to run
 * on every candidate BEFORE anything was scored, so most of that spend went to
 * items the relevance floor then discarded. Pictures are now sourced in
 * enrichMediaImages, after scoring, for the items that survived it.
 */
async function fetchMedia() {
  const cutoff = Date.now() - CONTENT_WINDOW_MS
  const batches = await Promise.all([
    ...GOOGLE_NEWS_QUERIES.map(q => fetchRssFeed(googleNewsUrl(q), 'Google News', 100)),
    ...CURATED_FEEDS.map(([u, l, o = {}]) => fetchRssFeed(u, l, o.cap ?? 30, o.ua ?? UA)),
    ...MASTODON_TAGS.map(t => fetchRssFeed(mastodonUrl(t), `#${t} · Mastodon`, 10)),
    fetchGdelt(),
  ])

  const raw = batches.flat().filter(i =>
    i.title && i.url && (!i.publishedAt || new Date(i.publishedAt).getTime() >= cutoff)
  )

  // Dedupe by URL and by normalized title. Cross-source overlap is the normal
  // case, not the exception: the same story arrives from Google News, from the
  // publisher's own feed, and from GDELT.
  //
  // Which copy survives is the whole ballgame for pictures. It used to be
  // whichever arrived first, and Google News is fetched first, so the aggregator
  // copy won essentially every contest. A news.google.com URL is a redirect
  // wrapper around an opaque, non-decodable payload: getOgImage cannot scrape it,
  // nothing can resolve it to the publisher, and the reader clicks through a
  // bounce. Measured 11 Aug 2026 on the stored feed: 73% of rows with a direct
  // publisher URL carried a picture, against 7% of rows with an aggregator URL.
  // So first-wins was not a neutral tie-break — it was discarding the copy that
  // could be illustrated in favour of the one that could not.
  //
  // Preference order matches dedupeFeedRows, which applies the same rule later
  // against the database: a copy that already has an image, then a direct
  // publisher URL, then the earlier arrival.
  const isAgg = u => /news\.google\.com/i.test(u || '')
  const better = (a, b) => {
    if (!!a.image !== !!b.image) return a.image ? a : b
    if (isAgg(a.url) !== isAgg(b.url)) return isAgg(a.url) ? b : a
    return a
  }
  const byKey = new Map()
  for (const it of raw) {
    if (!it.url) continue
    const tkey = it.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60)
    const prev = byKey.get(tkey)
    byKey.set(tkey, prev ? better(prev, it) : it)
  }
  // Title-collapse can still leave two rows on the same URL (different headlines
  // for one page); drop those too.
  const seenUrl = new Set(), out = []
  for (const it of byKey.values()) {
    if (seenUrl.has(it.url)) continue
    seenUrl.add(it.url); out.push(it)
  }

  // The lexicon gate is what makes the wider fetch affordable: it is free, and it
  // rejects the half of this pool that is off topic in a way a regex can see.
  const onTopic = out.filter(onTopicByLexicon)
  onTopic.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
  const capped = onTopic.slice(0, MEDIA_CANDIDATE_CAP)

  console.log(`      ${raw.length} fetched → ${out.length} unique → ${onTopic.length} on-topic` +
    `${capped.length < onTopic.length ? ` → ${capped.length} after cap` : ''}`)
  return capped
}

/**
 * Source and vet a picture for each item: Open Graph scrape where the feed gave
 * us nothing, a dimension check to drop thumbnails, then the vision classifier
 * that separates a real photograph from stock art.
 *
 * Call this AFTER scoring, with only the items that are going to be stored. The
 * work is three network round trips and a model call per item, and running it on
 * the full candidate pool is how a 900-item fetch would cost more than the
 * scoring it feeds.
 */
async function enrichMediaImages(items) {
  if (!items.length) return
  // Fill missing images via Open Graph scrape (direct URLs only), bounded concurrency.
  const need = items.filter(i => !i.image && i.url && !i.url.includes('news.google.com'))
  for (let i = 0; i < need.length; i += 6) {
    await Promise.all(need.slice(i, i + 6).map(async it => { it.image = await getOgImage(it.url) }))
  }
  // Keep only high-resolution images (drop small thumbnails); record dimensions.
  for (let i = 0; i < items.length; i += 6) {
    await Promise.all(items.slice(i, i + 6).map(async it => {
      if (!it.image) return
      const d = await measureImage(it.image)
      if (HI_RES(d)) { it.imageW = d.width; it.imageH = d.height } else { it.image = null }
    }))
  }
  const withImg = items.filter(i => i.image).length
  console.log(`      ${withImg}/${items.length} stored media items have a high-res image`)
  await classifyImages(items)
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

/**
 * Score items for neurotech relevance, and write the prose the cards show.
 *
 * `significance` — the 3-to-4-sentence paragraph — is asked for per call rather
 * than always, because it is the single most expensive thing this pipeline buys.
 * Measured 10 Aug 2026 on Haiku 4.5, a batch of five: 927 in / 788 out with the
 * paragraph, 879 in / 331 out without. Output is billed at five times input, so
 * the paragraph alone is roughly half the cost of the entire run.
 *
 * Research keeps it. It is the body text of the notable rail and of every paper's
 * detail page, so there it IS the product. News does not: ItemDetail already
 * falls back to the one-line summary (`metadata?.significance || summary`), no
 * card or list surface reads the field, and at several hundred stories a day the
 * paragraph is a paragraph nearly nobody opens.
 *
 * @param {object[]} items
 * @param {{ significance?: boolean, batchSize?: number }} [opts]
 */
async function scoreWithClaude(items, { significance = true, batchSize = 5 } = {}) {
  const scored = []
  // Batches run a few at a time rather than strictly one after another: at eighty
  // items a serial loop was a rounding error, at several hundred it is the longest
  // step in the run. Three is chosen against the rate limit, not the clock.
  const CONCURRENCY = 3
  const batches = []
  for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize))

  async function runBatch(batch) {
    const prompt = batch
      .map((item, idx) =>
        `[${idx + 1}] TITLE: ${item.title}\nCONTENT: ${(item.abstract || item.summary || '').slice(0, 400)}`
      )
      .join('\n\n---\n\n')

    try {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: significance ? 3000 : 1500,
        messages: [{
          role: 'user',
          content:
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
            `general neuroscience, neuroimaging or brain-scan findings with no device, genetics, basic ` +
            `biology, psychology, drugs and pharmacology, diagnostics and biomarkers and blood tests, ` +
            `surgery, epidemiology, and general medical news. ` +
            `Consumer gadgets, vehicles, lifestyle, diet, business, or politics score 1. ` +
            `CRUCIAL: an item that merely USES neural recording, electrophysiology, stimulation, or brain ` +
            `imaging as a tool to study brain function, circuits, cells, or a disease is NOT neurotechnology; ` +
            `score it 1 to 4. To score 5 or higher the item must be primarily ABOUT the technology itself: ` +
            `building, improving, validating, deploying, or commercializing a device, interface, implant, ` +
            `electrode array, stimulator, prosthesis, or neural decoding system. Example: developing a new ` +
            `brain-computer interface scores high; a neuroscience study that uses electrodes to map dopamine ` +
            `circuits scores low. ` +
            `Differentiate items within this batch.\n` +
            `- "summary": one crisp sentence on why it matters to neurotech practitioners\n` +
            (significance
              ? `- "significance": a single paragraph (3 to 4 sentences) in plain language explaining what this is and why it matters to neurotechnology. Self-contained; do not start with "This paper/article".\n` +
                `Write summary and significance in clear, punchy prose. Do NOT use em dashes or en dashes (— or –); use commas, periods, colons, or parentheses instead.\n`
              : `Write the summary in clear, punchy prose. Do NOT use em dashes or en dashes (— or –); use commas, periods, colons, or parentheses instead.\n`) +
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
          aiSignificance: parsed[idx]?.significance || '',
          topics: parsed[idx]?.topics || [],
        })
      })
    } catch (err) {
      console.warn('Claude scoring error:', err.message)
      batch.forEach(item => scored.push({ ...item, relevanceScore: 5, aiSummary: '', aiSignificance: '', topics: [] }))
    }
  }

  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    await Promise.all(batches.slice(i, i + CONCURRENCY).map(runBatch))
    if (i + CONCURRENCY < batches.length) await sleep(600)
    if (batches.length > 20 && (i / CONCURRENCY) % 10 === 0) {
      console.log(`      scored ${Math.min(scored.length, items.length)}/${items.length}`)
    }
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
        source_id: p.pmid,
        source_url: p.url,
        pipeline_version: PIPELINE_VERSION,
        ...reproCols(p),
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
        source_id: p.arxivId,
        source_url: p.url,
        pipeline_version: PIPELINE_VERSION,
        ...reproCols(p),
      })),
      { onConflict: 'arxiv_id', ignoreDuplicates: true }
    )
    if (error) console.warn('arxiv upsert error:', error.message)
  }

  // Retention is per entry type, because the two content kinds answer different
  // questions. A paper is in the feed because it is NEW, and it graduates to the
  // papers table and the notable rail once it stops being new, so a 7-day churn
  // costs nothing. News is the archive: /media is the only surface a press item
  // ever appears on, and deleting it at day 7 is deleting the section.
  //
  // Settled 10 Aug 2026: one blanket 7-day delete held the feed at THIRTY news
  // rows indefinitely. The daily run worked — it ingested, scored, and stored
  // every night — and then threw the week away, so the table never grew and
  // nothing said so. News now keeps the same 90-day window the ingest already
  // uses to decide what is worth fetching (CONTENT_WINDOW_MS): a story we would
  // still pull today is a story we should not have deleted yesterday.
  //
  // Both measure from created_at (when the row entered the feed) rather than
  // published_at, so an old-but-newly-surfaced item gets its full window.
  // Trials are exempt from both — they have their own prune in trials.js.
  // NEWS IS NEVER DELETED. Not after ninety days, not after a year. /media is an
  // archive — the only surface a press item ever appears on — and a story that
  // drops out of it is coverage the site no longer has. The page pages backwards
  // through it instead of holding a window, so there is no longer any size at
  // which old news becomes a problem to be pruned.
  //
  // Papers keep the 7-day churn, because for them the feed is a NEW-arrivals
  // list: a paper graduates to the papers table and the notable rail and goes on
  // being findable there, so ageing it out of the feed loses nothing.
  //
  // The only thing that still removes a news row is dedupeFeedRows, and that
  // collapses duplicate copies of ONE story rather than dropping a story.
  const RETENTION_MS = { paper: SEVEN_DAYS_MS, preprint: SEVEN_DAYS_MS }
  for (const [type, ms] of Object.entries(RETENTION_MS)) {
    const { error } = await supabase.from('news_feed')
      .delete()
      .eq('entry_type', type)
      .lt('created_at', new Date(Date.now() - ms).toISOString())
    if (error) console.warn(`retention prune (${type}) failed:`, error.message)
  }

  // Attach a composite rank to metadata. Papers/preprints use the research
  // scorer (field-normalized impact); news keeps the recency-led computeRank.
  const withMeta = (item, base) => {
    const isResearch = base.entry_type === 'paper' || base.entry_type === 'preprint'
    const rankScore = isResearch ? researchScore(item)
      : base.entry_type === 'news' ? mediaScore(item)
      : computeRank(item)
    const row = {
      ...base,
      metadata: {
        ...base.metadata,
        rankScore,
        citationCount: item.citationCount ?? 0,
        influentialCitationCount: item.influentialCitationCount ?? 0,
        pctile: item.pctile ?? null,
        fwci: item.fwci ?? null,
        significance: item.aiSignificance || '',
      },
    }
    // Facet columns so feed items are filterable like every other content type.
    // Papers/preprints classify from title+summary here; the fuller papers-table
    // rows get MeSH-refined facets separately.
    const kind = base.entry_type === 'news' ? 'news' : 'papers'
    // Provenance block: canonical link, freshness stamp, and the version that
    // wrote the row (source is already set on `base`).
    row.source_url = base.url || null
    row.last_updated = new Date().toISOString()
    row.pipeline_version = PIPELINE_VERSION
    return { ...row, ...classify(row, kind) }
  }

  // Build combined feed, sorted by the composite rank (not the raw AI score).
  //
  // The topic gate is applied HERE and not at the call site: the papers table
  // is the index and stays comprehensive, marking topicality with in_scope for
  // pages to filter on. The feed is the curated layer over it, and a paper
  // that only borrows a neurotechnology to study something else does not
  // belong in it.
  const feedPubmed = pubmed.filter(isOnTopic)
  const feedArxiv = arxiv.filter(isOnTopic)
  const offTopicResearch = (pubmed.length - feedPubmed.length) + (arxiv.length - feedArxiv.length)
  if (offTopicResearch) console.log(`      kept ${offTopicResearch} off-topic papers out of the feed (relevance < ${RELEVANCE_FLOOR}); they stay in the index`)

  const allItems = [
    ...feedPubmed.map(p => withMeta(p, {
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
    ...feedArxiv.map(p => withMeta(p, {
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
      title: cleanTitle(n.title, n.source),
      summary: n.aiSummary || n.summary || '',
      source: n.source,
      url: n.url,
      published_at: n.publishedAt || new Date().toISOString(),
      topics: n.topics || [],
      relevance_score: n.relevanceScore || 5,
      entry_type: 'news',
      metadata: { image: n.image || null, imageKind: n.imageKind || null, imageW: n.imageW || null, imageH: n.imageH || null },
    })),
  ].sort((a, b) => b.metadata.rankScore - a.metadata.rankScore)

  // Populate real figures for the top-ranked papers/preprints (graphical
  // abstracts / hero figures via the DOI page, vision-filtered to real only).
  console.log('  Fetching paper figures...')
  await enrichWithFigures(allItems, 90)

  // Quotas are per kind, because one shared cutoff is not a ranking decision —
  // it is an accident of the two scorers. researchScore and mediaScore produce
  // numbers on the same 0-1 scale that do not mean the same thing, and papers
  // sit higher on it, so a combined top-60 handed research most of the slots and
  // news whatever was left. That is how a day's ingest of eighty press items
  // became a handful of stored rows.
  //
  // Each kind is now cut against its own peers. Research keeps the 60 it always
  // had; news gets NEWS_MAX of its own, which is a real ceiling rather than a
  // side effect, and can be raised without taking slots from research.
  const research = allItems.filter(i => i.entry_type !== 'news')
  const newsItems = allItems.filter(i => i.entry_type === 'news')
  const topResearch = research.slice(0, 60)
  const topNews = newsItems.slice(0, NEWS_MAX)

  // The homepage's story frames need photographs, and photo-bearing media ranks
  // below papers, so anything with a real image that missed its quota is still
  // kept. Unchanged in intent; it now draws from what both quotas left behind.
  const kept = new Set([...topResearch, ...topNews])
  const extras = allItems
    .filter(i => !kept.has(i) && i.metadata?.image && i.metadata?.imageSubject !== 'class')
    .slice(0, 30)
  const toStore = [...topResearch, ...topNews, ...extras]

  for (let i = 0; i < toStore.length; i += 100) {
    const { error } = await supabase.from('news_feed').upsert(toStore.slice(i, i + 100), {
      onConflict: 'url',
      ignoreDuplicates: false,
    })
    if (error && !error.message.includes('duplicate')) {
      console.warn('news_feed upsert error:', error.message)
    }
  }

  console.log(
    `✓ Synced: ${pubmed.length} PubMed | ${arxiv.length} arXiv | ${news.length} news` +
    ` → ${toStore.length} feed items (${topResearch.length} research, ${topNews.length} news,` +
    ` ${extras.length} extra real-image)`
  )
}

// ── Notable research rail ────────────────────────────────────────────────────
// A rolling six-month set of the highest FIELD-normalized-impact neurotech
// papers, written to src/data/notable.json (committed daily, like funding.json).
// Papers "graduate" here from the fresh 7-day feed once OpenAlex shows real,
// top-decile citation impact — giving landmark work a longer runway than the
// feed allows.
//
// The rail's numbers, and the feed sweep that keeps it from draining, live in
// scripts/lib/notable.js. The window is 180 days rather than the 90 it was
// until 24 Aug 2026; the header there has the measurement that changed it.

/** The image block scripts/backfill-images.js writes onto a rail entry. */
const NOTABLE_IMAGE_KEYS = [
  'image_url', 'image_kind', 'image_subject', 'image_credit', 'image_license',
  'image_license_url', 'image_source', 'image_source_url', 'image_w', 'image_h',
  'image_checked_at',
]

// Normalize a raw scored item OR a stored rail entry into one rail record.
// `relevance` is carried so a paper admitted today can be re-judged on topic
// tomorrow without being scored again.
//
// The image block is carried for a plainer reason: this rebuilds the file from
// scratch every run, so a field it does not name is a field it deletes. It was
// dropping the picture backfill-images had resolved for each paper, which then
// resolved it again from the same source the same night — the pictures were
// only ever there because the image step runs after this one. A rail entry
// keeps its picture now, and a failed image step no longer empties the rail.
function toNotable(x) {
  const image = {}
  for (const k of NOTABLE_IMAGE_KEYS) if (x[k] != null) image[k] = x[k]
  return {
    ...image,
    title: x.title,
    authors: x.authors || [],
    journal: x.oaVenue || x.journal || x.source || '',
    pmid: x.pmid || null,
    doi: x.doi || null,
    url: x.url || (x.doi ? `https://doi.org/${x.doi}` : (x.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${x.pmid}/` : '')),
    publishedAt: x.publishedAt || x.published_at || x.oaDate || null,
    pctile: x.pctile ?? null,
    fwci: x.fwci ?? null,
    citedBy: x.citedBy ?? 0,
    relevance: relevanceOf(x),
    significance: x.significance || x.aiSignificance || '',
  }
}

/**
 * Score any rail entry that has no topic judgement on it yet.
 *
 * Entries written before the rail had a topic gate carry a percentile and
 * nothing else. They are scored from the abstract in the papers table, which
 * is where the rail's own candidates came from; a paper the table does not
 * have is judged on its title, which for the case that prompted this is
 * already answer enough.
 */
async function scoreRailTopics(entries) {
  const gaps = entries.filter(e => relevanceOf(e) == null)
  if (!gaps.length) return

  for (const e of gaps) {
    if (!e.doi && !e.pmid) continue
    const q = supabase.from('papers').select('abstract').limit(1)
    const { data } = await (e.doi ? q.eq('doi', e.doi) : q.eq('pubmed_id', String(e.pmid)))
    e.abstract = data?.[0]?.abstract || ''
  }
  const scored = await scoreWithClaude(gaps.map(e => ({ title: e.title, abstract: e.abstract || '' })))
  gaps.forEach((e, i) => { e.relevance = scored[i]?.relevanceScore ?? RELEVANCE_FLOOR; delete e.abstract })
}

/**
 * Fill the rail out of the papers table when the day's ingest did not.
 *
 * The rail only ever saw two sources: what came in today, and what was already
 * on it. Today's ingest is a hundred-odd papers, and the chance that four of
 * them are both top-decile for their field and inside the window is small, so
 * the rail drained. The home page then showed fewer than four, and lost another
 * to the dedup against the feed above, which is how a four-slot section came to
 * render two.
 *
 * The table holds 83k papers. This asks it for recent ones with a DOI and puts
 * them through the SAME gates as everything else — trusted impact, top decile,
 * in window, on topic. Nothing is relaxed to fill a slot: a short rail is
 * better than a rail padded with work that does not belong on it.
 *
 * Cost is bounded and small. OpenAlex takes 25 DOIs a request, so the scan is
 * about twenty requests, and Claude only sees the handful that already cleared
 * impact and window.
 */
const NOTABLE_SCAN = 500

async function topUpNotable(byKey, keyOf, need) {
  const { data, error } = await supabase
    .from('papers')
    .select('title,authors,journal,year,doi,pubmed_id,url,abstract')
    .not('doi', 'is', null)
    .order('created_at', { ascending: false })
    .limit(NOTABLE_SCAN)
  if (error) { console.warn('      rail top-up read failed:', error.message); return 0 }

  const candidates = (data || [])
    .map(r => ({ title: r.title, authors: r.authors || [], journal: r.journal, doi: r.doi,
      pmid: r.pubmed_id || null, url: r.url, abstract: r.abstract || '' }))
    .filter(c => !byKey.has(keyOf(c)))
  if (!candidates.length) return 0

  await enrichOpenAlex(candidates)
  const qualified = candidates.filter(c =>
    impactTrusted(c) && (c.pctile ?? 0) >= NOTABLE_PCTILE_MIN && daysOld(c.oaDate) <= NOTABLE_WINDOW_DAYS)
  if (!qualified.length) return 0

  const scored = await scoreWithClaude(qualified.map(c => ({ title: c.title, abstract: c.abstract })))
  qualified.forEach((c, i) => { c.relevance = scored[i]?.relevanceScore ?? RELEVANCE_FLOOR })

  let added = 0
  for (const c of qualified.filter(isOnTopic).sort((a, b) => b.pctile - a.pctile)) {
    if (added >= need) break
    byKey.set(keyOf(c), toNotable(c))
    added++
  }
  console.log(`      rail top-up: scanned ${candidates.length} papers, ${qualified.length} cleared impact, added ${added}`)
  return added
}

/** How many feed rows one sweep will re-enrich through OpenAlex in a night. */
const SWEEP_MAX_ENRICH = 60

/**
 * Admit papers the index already holds and has already judged.
 *
 * This is the re-check the rail never had. Every gate is the one the rest of
 * the rail uses; what is different is only WHEN the question gets asked, which
 * is every night rather than once on the day a paper arrived. See the header of
 * scripts/lib/notable.js for the arithmetic that made that the difference
 * between a full rail and an empty one.
 *
 * Two economies keep this cheap enough to run nightly. Candidates are filtered
 * on their STORED percentile before anything is fetched, so OpenAlex sees a
 * handful of rows rather than the whole feed — a percentile is age-normalised
 * and does not swing far, and the papers-table top-up below is the deeper net
 * for anything this pre-filter passes over. And nothing here is scored: the
 * topic judgement rides along on the row from the run that ingested it.
 */
async function sweepFeedIntoRail(byKey, keyOf, need) {
  const all = await feedCandidates(supabase)
  const candidates = all
    .filter(c => !byKey.has(keyOf(c)))
    .filter(isOnTopic)
    .filter(c => c.pctile == null || c.pctile >= NOTABLE_PCTILE_MIN)
    .filter(c => daysOld(c.publishedAt) <= NOTABLE_WINDOW_DAYS)
    .slice(0, SWEEP_MAX_ENRICH)
  if (!candidates.length) return 0

  // The stored citation count is written at ingest and is usually 0 on a paper
  // that has been cited since — and under 60 days old, citations are the only
  // thing that can make its impact trusted. So ask OpenAlex again.
  await enrichOpenAlex(candidates)

  const qualified = candidates.filter(c =>
    impactTrusted(c)
    && (c.pctile ?? 0) >= NOTABLE_PCTILE_MIN
    && daysOld(c.publishedAt || c.oaDate) <= NOTABLE_WINDOW_DAYS)

  let added = 0
  for (const c of qualified.sort((a, b) => b.pctile - a.pctile)) {
    if (added >= need) break
    byKey.set(keyOf(c), toNotable(c))
    added++
  }
  console.log(`      rail sweep: ${all.length} papers in the feed, ${candidates.length} plausible, ${qualified.length} qualify, added ${added}`)
  return added
}

/**
 * Rebuild the rail.
 *
 * `allowModel` is false when the caller must not spend the Claude API — the
 * repair script (scripts/backfill-notable.js) runs that way. It skips the two
 * steps that score: back-filling a topic judgement onto pre-gate entries, and
 * the papers-table top-up. Everything else, including the feed sweep, needs
 * only OpenAlex and what the rows already carry.
 *
 * `commit` false reports what the rail would become without writing the file.
 */
async function syncNotable(researchItems, { allowModel = true, commit = true } = {}) {
  // Load the existing rail and re-enrich it — citations climb over time, so a
  // paper's percentile is re-checked every run (and it drops off if it fades).
  let existing = []
  try { if (existsSync(NOTABLE_PATH)) existing = JSON.parse(readFileSync(NOTABLE_PATH, 'utf8')) } catch { /* first run */ }
  await enrichOpenAlex(existing) // mutates in place: refreshes pctile/fwci/citedBy
  if (allowModel) await scoreRailTopics(existing)

  // New qualifiers from this run: trusted impact AND top-decile field percentile.
  const fresh = researchItems.filter(it => it.doi && impactTrusted(it) && (it.pctile ?? 0) >= NOTABLE_PCTILE_MIN)

  // Merge (a fresh reading wins over a stored one), keep only still-qualifying
  // in-window papers, and take the top N by percentile.
  const keyOf = x => (x.doi || x.pmid || x.url || '').toLowerCase()
  const byKey = new Map()
  for (const e of existing) if (keyOf(e)) byKey.set(keyOf(e), toNotable(e))
  for (const it of fresh) if (keyOf(it)) byKey.set(keyOf(it), toNotable(it))

  // A percentile is a ranking WITHIN a field, so it says how a paper did among
  // its own kind and nothing at all about which kind that is. Impact alone put
  // a zebrafish morphogenesis paper on the front page under "Top 1%". The rail
  // is a neurotech rail before it is an impact rail, so topic is asked first.
  const build = () => [...byKey.values()]
    .filter(isOnTopic)
    .filter(x => x.pctile != null && x.pctile >= NOTABLE_PCTILE_MIN && daysOld(x.publishedAt) <= NOTABLE_WINDOW_DAYS)
    .sort((a, b) => b.pctile - a.pctile)
    .slice(0, NOTABLE_MAX)

  const offTopic = [...byKey.values()].filter(x => !isOnTopic(x))
  let rail = build()

  // The home page shows six and takes them from this file AFTER dropping any
  // that already appear in the feed above, so a rail of exactly six can render
  // fewer. Carrying the full twelve is what keeps the section full.
  //
  // The first place to look is the index itself. A paper cannot clear
  // impactTrusted until day 60 (citations, or age), and the only two things
  // that used to admit one were today's ingest and a scan of the last few days
  // of ingest — so a paper that became eligible two months after it arrived
  // was never looked at again, and the rail drained to five. This sweeps the
  // research rows already in the feed and admits the ones that qualify NOW.
  // They carry the percentile and the topic score the run already wrote, so it
  // costs no model call; see scripts/lib/notable.js.
  if (rail.length < NOTABLE_MAX) {
    const added = await sweepFeedIntoRail(byKey, keyOf, NOTABLE_MAX - rail.length)
    if (added) rail = build()
  }

  // Only then the expensive path: a scan of the papers table, which has to
  // enrich and topic-score its candidates from scratch.
  if (allowModel && rail.length < NOTABLE_MAX) {
    await topUpNotable(byKey, keyOf, NOTABLE_MAX - rail.length)
    rail = build()
  }

  if (commit) writeFileSync(NOTABLE_PATH, JSON.stringify(rail, null, 2) + '\n')
  console.log(`      notable rail: ${rail.length} papers (${existing.length} carried + ${fresh.length} new qualifiers)${commit ? '' : ' — DRY RUN, not written'}`)
  for (const x of offTopic) console.log(`      dropped off-topic (relevance ${relevanceOf(x)}): ${x.title.slice(0, 64)}`)
  return rail
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

  // Research and news are scored separately so news can skip the significance
  // paragraph, which is roughly half the cost of the run and which nothing on a
  // news surface reads. See scoreWithClaude.
  const research = [...pubmed, ...arxiv]
  console.log(`\n[4/5] Scoring ${total} items with Claude haiku` +
    ` (${research.length} research with significance, ${news.length} news without)...`)
  const scoredResearch = await scoreWithClaude(research, { significance: true, batchSize: 5 })
  const scoredNewsAll = await scoreWithClaude(news, { significance: false, batchSize: 10 })
  const scored = [...scoredResearch, ...scoredNewsAll]

  console.log('[5/5] Fetching engagement signals (Semantic Scholar + OpenAlex)...')
  await fetchCitations(scored)
  await enrichOpenAlex(scored) // field-normalized impact percentile / FWCI

  const scoredPubmed = scored.filter(i => i.source === 'pubmed')
  const scoredArxiv = scored.filter(i => i.source === 'arxiv')
  const scoredNews = scoredNewsAll.filter(isOnTopic)
  const dropped = scoredNewsAll.length - scoredNews.length
  if (dropped) console.log(`      dropped ${dropped} off-topic media items (relevance < ${RELEVANCE_FLOOR})`)

  // Pictures are sourced only for news that survived the relevance floor, and
  // only up to what syncToSupabase can actually store. Doing it here rather than
  // inside fetchMedia is what keeps a 900-candidate fetch cheaper than the old
  // 80-candidate one.
  scoredNews.sort((a, b) => mediaScore(b) - mediaScore(a))
  const needImages = scoredNews.slice(0, NEWS_MAX)
  console.log(`Sourcing pictures for ${needImages.length} stored media items...`)
  await enrichMediaImages(needImages)

  console.log('\nSyncing to Supabase...')
  await syncToSupabase(scoredPubmed, scoredArxiv, scoredNews)

  const nDup = await dedupeFeedRows(supabase)
  if (nDup) console.log(`      removed ${nDup} duplicate feed rows (same story, different source)`)

  console.log('Updating notable research rail (OpenAlex impact)...')
  await syncNotable([...scoredPubmed, ...scoredArxiv])

  console.log('Syncing clinical trials (ClinicalTrials.gov)...')
  const nTrials = await syncTrials(supabase)
  console.log(`      ${nTrials} trials`)

  // Every picture this run met and had no ruling on. Written once, at the end,
  // so the daily reviewer has a work list in the morning and tomorrow's run can
  // use what it decides. See scripts/lib/review.js.
  const queued = flushQueue()
  if (queued) console.log(`      ${queued} new picture(s) queued for review`)

  console.log('\n✅ Refresh complete — ' + new Date().toUTCString())
}

export { enrichOpenAlex, impactTrusted, researchScore, mediaScore, scoreWithClaude, cleanTitle, dedupeFeedRows, venuePrestige, clamp01, daysOld, toNotable, isOnTopic, relevanceOf, syncNotable, RELEVANCE_FLOOR, NOTABLE_MAX, NOTABLE_PCTILE_MIN, NOTABLE_WINDOW_DAYS, NOTABLE_PATH }

// Media-side internals, exported for scripts/backfill-news.js. The backfill runs
// the same fetch, the same gate and the same picture sourcing as the nightly
// media path; importing them is what keeps the two from drifting into two
// different definitions of what a news item is.
export {
  UA, BROWSER_UA, CONTENT_WINDOW_MS, NEWS_MAX,
  GOOGLE_NEWS_QUERIES, CURATED_FEEDS, MASTODON_TAGS, GDELT_QUERIES,
  googleNewsUrl, mastodonUrl, fetchRssFeed, fetchGdelt,
  onTopicByLexicon, NEUROTECH_LEXICON,
  getOgImage, measureImage, HI_RES, classifyImages, classifyImageUrl,
}

// Only run the daily refresh when executed directly (not when imported by a
// helper such as scripts/seed-notable.js).
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main().catch(err => { console.error(err); process.exit(1) })
}
