/**
 * backfill-pubmed.js — one-time comprehensive backfill of neurotech papers from
 * PubMed into the `papers` table via NCBI E-utilities (ESearch history + EFetch).
 *
 * Usage:
 *   node --env-file=.env scripts/backfill-pubmed.js            # full backfill
 *   BACKFILL_LIMIT=300 node --env-file=.env scripts/backfill-pubmed.js  # test
 *
 * Optional NCBI_API_KEY in .env raises the rate limit (3 -> 10 req/s).
 */
import { createClient } from '@supabase/supabase-js'
import { parseStringPromise } from 'xml2js'
import { DEVICE_CLASSES } from '../src/lib/taxonomy.js'
import { classify } from '../src/lib/classify.js'

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const UA = 'Mozilla/5.0 (compatible; NeuroBaseBot/1.0)'
const API_KEY = process.env.NCBI_API_KEY || ''
const BATCH = 200
const LIMIT = process.env.BACKFILL_LIMIT ? parseInt(process.env.BACKFILL_LIMIT, 10) : Infinity
const keyParam = API_KEY ? `&api_key=${API_KEY}` : ''
const PACE = API_KEY ? 130 : 360 // ms between EFetch calls

// Scoped neurotech query (title/abstract). Tune breadth here.
const QUERY = '("brain-computer interface"[tiab] OR "brain-machine interface"[tiab] OR "neural prosthesis"[tiab] OR neuroprosthe*[tiab] OR "deep brain stimulation"[tiab] OR neurostimulat*[tiab] OR "neural implant"[tiab] OR "neural interface"[tiab] OR "cochlear implant"[tiab] OR "retinal prosthesis"[tiab] OR electrocorticograph*[tiab] OR intracortical[tiab] OR "spinal cord stimulation"[tiab] OR "vagus nerve stimulation"[tiab] OR neurotechnolog*[tiab] OR "responsive neurostimulation"[tiab] OR optogenetic*[tiab])'

const sleep = ms => new Promise(r => setTimeout(r, ms))

function deriveTags(text) {
  const h = (text || '').toLowerCase()
  return DEVICE_CLASSES.filter(c => c.match.some(m => h.includes(m))).map(c => c.id)
}

async function fetchJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) { await sleep(1500); continue }
      return await res.json()
    } catch { await sleep(1500) }
  }
  return null
}

// Collect all matching PMIDs, chunked by publication year so each sub-query
// stays under PubMed's 10k paging limit (and no expiring history session).
async function esearchAllPmids() {
  const pmids = new Set()
  const thisYear = new Date().getFullYear()
  for (let year = thisYear; year >= 1980; year--) {
    let retstart = 0
    for (;;) {
      const term = `(${QUERY}) AND ${year}[pdat]`
      const url = `${EUTILS}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&retstart=${retstart}&retmax=9999&retmode=json${keyParam}`
      const j = await fetchJson(url)
      const ids = j?.esearchresult?.idlist || []
      ids.forEach(id => pmids.add(id))
      const count = parseInt(j?.esearchresult?.count || '0', 10)
      retstart += 9999
      if (retstart >= count || ids.length === 0) break
      await sleep(PACE)
    }
    if (year % 5 === 0) console.log(`   …${year}: ${pmids.size.toLocaleString()} ids so far`)
    await sleep(PACE)
  }
  return [...pmids]
}

async function efetchByIds(ids) {
  const url = `${EUTILS}/efetch.fcgi?db=pubmed&id=${ids.join(',')}&retmode=xml${keyParam}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`efetch ${res.status}`)
  const parsed = await parseStringPromise(await res.text(), { explicitArray: true })
  const articles = parsed?.PubmedArticleSet?.PubmedArticle || []
  const rows = []
  for (const article of articles) {
    try {
      const ml = article.MedlineCitation?.[0]
      const art = ml?.Article?.[0]
      const pmid = String(ml?.PMID?.[0]?._ || ml?.PMID?.[0] || '')
      if (!pmid) continue
      const titleNode = art?.ArticleTitle?.[0]
      const title = (typeof titleNode === 'object' ? titleNode._ || titleNode['#text'] || '' : String(titleNode || '')).trim()
      if (!title) continue
      const authors = (art?.AuthorList?.[0]?.Author || [])
        .map(a => `${a.ForeName?.[0] || ''} ${a.LastName?.[0] || ''}`.trim()).filter(Boolean)
      const abstract = (art?.Abstract?.[0]?.AbstractText || [])
        .map(p => (typeof p === 'object' ? p._ || p['#text'] || '' : String(p))).join(' ').trim()
      const journal = art?.Journal?.[0]?.Title?.[0] || ''
      const year = art?.Journal?.[0]?.JournalIssue?.[0]?.PubDate?.[0]?.Year?.[0]
        || ml?.DateCompleted?.[0]?.Year?.[0] || ''
      const doi = (art?.ELocationID || []).find(e => e.$?.EIdType === 'doi')?._ || null
      const row = {
        title, authors, journal, year: String(year), doi, pubmed_id: pmid,
        url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        abstract: abstract || null,
        tags: deriveTags(`${title} ${abstract}`),
        source: 'pubmed',
      }
      // Classify at ingest (keyword-based; MeSH enrichment via backfill-mesh.js
      // then apply-facets.js refines these once headings are fetched).
      rows.push({ ...row, ...classify(row, 'papers') })
    } catch { /* skip malformed */ }
  }
  return rows
}

async function upsertRows(sb, rows) {
  const { error } = await sb.from('papers').upsert(rows, { onConflict: 'pubmed_id', ignoreDuplicates: true })
  if (!error) return rows.length
  // A unique conflict (e.g. duplicate DOI) fails the whole batch — retry per row.
  let ok = 0
  for (const r of rows) {
    const { error: e2 } = await sb.from('papers').upsert([r], { onConflict: 'pubmed_id', ignoreDuplicates: true })
    if (!e2) ok++
  }
  return ok
}

async function run() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  console.log('🧠 Collecting PubMed IDs…')
  const allPmids = await esearchAllPmids()
  const pmids = allPmids.slice(0, LIMIT)
  console.log(`   ${allPmids.length.toLocaleString()} matches; fetching ${pmids.length.toLocaleString()}${API_KEY ? '' : ' (no API key — slower)'}...`)
  let ok = 0
  for (let i = 0; i < pmids.length; i += BATCH) {
    const chunk = pmids.slice(i, i + BATCH)
    let rows = []
    try { rows = await efetchByIds(chunk) }
    catch (e) { console.warn(`  chunk @${i} error: ${e.message}`); await sleep(1500); continue }
    if (rows.length) ok += await upsertRows(sb, rows)
    if (i % 4000 === 0) console.log(`  ${Math.min(i + BATCH, pmids.length).toLocaleString()}/${pmids.length.toLocaleString()} · ~${ok.toLocaleString()} upserted`)
    await sleep(PACE)
  }
  console.log(`✓ Backfill complete — processed ${ok.toLocaleString()} papers`)
}

run().catch(e => { console.error(e); process.exit(1) })
