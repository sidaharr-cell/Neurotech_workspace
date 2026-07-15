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

async function esearchHistory() {
  const url = `${EUTILS}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(QUERY)}&usehistory=y&retmax=0&retmode=json${keyParam}`
  const j = await (await fetch(url, { headers: { 'User-Agent': UA } })).json()
  const e = j.esearchresult
  return { count: parseInt(e.count, 10), webenv: e.webenv, qk: e.querykey }
}

async function efetchBatch(webenv, qk, retstart) {
  const url = `${EUTILS}/efetch.fcgi?db=pubmed&query_key=${qk}&WebEnv=${webenv}&retstart=${retstart}&retmax=${BATCH}&retmode=xml${keyParam}`
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
      rows.push({
        title, authors, journal, year: String(year), doi, pubmed_id: pmid,
        url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        abstract: abstract || null,
        tags: deriveTags(`${title} ${abstract}`),
        source: 'pubmed',
      })
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
  const { count, webenv, qk } = await esearchHistory()
  const target = Math.min(count, LIMIT)
  console.log(`🧠 PubMed neurotech matches: ${count.toLocaleString()}. Backfilling ${target.toLocaleString()}${API_KEY ? '' : ' (no API key — slower)'}...`)
  let ok = 0
  for (let start = 0; start < target; start += BATCH) {
    let rows = []
    try { rows = await efetchBatch(webenv, qk, start) }
    catch (e) { console.warn(`  batch @${start} error: ${e.message}`); await sleep(1500); continue }
    if (rows.length) ok += await upsertRows(sb, rows)
    if (start % 2000 === 0) console.log(`  ${Math.min(start + BATCH, target).toLocaleString()}/${target.toLocaleString()} · upserted ~${ok.toLocaleString()}`)
    await sleep(PACE)
  }
  console.log(`✓ Backfill complete — ~${ok.toLocaleString()} papers in the index`)
}

run().catch(e => { console.error(e); process.exit(1) })
