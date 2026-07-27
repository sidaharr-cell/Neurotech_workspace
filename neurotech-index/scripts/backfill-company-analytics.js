/**
 * backfill-company-analytics.js — precompute the per-company data that can't be
 * joined live from our own Supabase: peer-reviewed publications affiliated with
 * the company (PubMed, free E-utilities). Writes one static file per company,
 *   public/company-analytics/<company-id>.json
 * served on demand by the company page. (Devices, patents, clinical trials and
 * news mentions are joined live from Supabase in the page — no precompute.)
 *
 *   node --env-file=.env scripts/backfill-company-analytics.js            # all
 *   node --env-file=.env scripts/backfill-company-analytics.js --funded   # funded only
 *   node --env-file=.env scripts/backfill-company-analytics.js --force     # ignore cache
 *
 * Incremental: an id present in _checked.json within STALE_DAYS is skipped, so
 * the daily cron only re-indexes new/stale companies.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const __dir = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dir, '../public/company-analytics')
const CHECKED = join(OUT, '_checked.json')
const FUNDING = resolve(__dir, '../src/data/funding.json')
const CURATED = resolve(__dir, '../src/data/companies-funding.json')
const FORCE = process.argv.includes('--force')
const FUNDED_ONLY = process.argv.includes('--funded')
const STALE_DAYS = 30
const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const MAX_ITEMS = 15
const sleep = ms => new Promise(r => setTimeout(r, ms))

// Common org words: a name made ONLY of these is too generic to trust on an
// affiliation-boundary match alone — it must be corroborated by the company's
// own city or domain in the same affiliation.
const COMMON = new Set(['science', 'sciences', 'corporation', 'corp', 'inc', 'incorporated', 'ltd', 'limited', 'llc', 'co', 'company', 'group', 'medical', 'medicine', 'systems', 'system', 'labs', 'lab', 'laboratory', 'laboratories', 'technologies', 'technology', 'tech', 'neuro', 'neurotech', 'neurotechnology', 'neurotechnologies', 'neuroscience', 'bio', 'biosciences', 'bioscience', 'biotech', 'health', 'healthcare', 'therapeutics', 'pharma', 'pharmaceutical', 'pharmaceuticals', 'devices', 'device', 'life', 'data', 'digital', 'brain', 'mind', 'neural', 'precision', 'vision', 'sensor', 'sensors', 'solutions', 'research', 'global', 'advanced', 'general', 'institute', 'center', 'centre', 'international', 'the', 'and'])
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const LEGAL = 'inc|incorporated|corp|corporation|ltd|limited|llc|co|company|gmbh|ag|sa|bv|nv|plc|pbc|oy|ab|as|srl|spa'
// The company name must be a COMPLETE org unit in the affiliation: it must start
// the unit (line start or after a comma/semicolon/colon/paren) AND end it
// (immediately, or after one legal suffix like "Inc"/"Corp"), bounded by a
// delimiter or the end. This rejects both the tail case ("Posit Science
// Corporation") and the prefix case ("Neuralink Foundation") — only the company
// itself (± a legal suffix) matches.
const orgBoundaryRe = name =>
  new RegExp(`(^|[,;:(]\\s*)${esc(name)}(\\s*,?\\s*(${LEGAL})\\b\\.?)?(?=\\s*[,;.)]|\\s*$)`, 'i')
const isDistinctive = name => name.split(/\s+/).some(t => { const w = t.toLowerCase().replace(/[^a-z0-9]/g, ''); return w.length >= 6 && !COMMON.has(w) })
const searchable = n => n.replace(/[^a-z0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim().length >= 4

const tag = (block, t) => block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1]
const strip = s => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

// Relevance gate: a paper must read as neuro / bio / medical / device work in
// its title or journal. This drops the rare genuinely-affiliated-but-off-topic
// paper (e.g. a company employee's environmental-methods toolbox) while keeping
// the company's actual output. Deliberately broad so real papers survive.
const RELEVANT = /\b(neuro|neural|neuron|brain|cortex|cortic|cerebr|cranial|spine|spinal|nerve|synap|axon|glia|eeg|ecog|emg|meg|fnirs|electroenceph|electrophysiolog|electrode|microelectrode|implant|stimulat|neuromod|modulation|prosthe|bci|brain-computer|brain-machine|biosens|bioelectron|retina|ocular|ophthalm|visual|vision|cochlea|auditory|hearing|olfact|somatosens|seizure|epilep|parkinson|tremor|dystonia|stroke|paralys|plegia|amputat|movement|motor|rehabilit|deep brain|\bdbs\b|vagus|ultrasound|optogenetic|closed-loop|probe|array|wearable|wireless|neurostim|cognit|psychiatr|depress|mental|sleep|\bpain\b|tinnitus|migraine|headache|consciousness|memory|clinical|patient|device|therap|surg|biomed|implantable|physiolog|cellular|tissue|in vivo|imaging|decod|sensor|health|medic)\b/i
const relevant = (title, journal) => RELEVANT.test(`${title} ${journal}`)

async function pubmed(name, { city, host }) {
  const term = encodeURIComponent(`"${name}"[Affiliation]`)
  const es = await (await fetch(`${EUTILS}/esearch.fcgi?db=pubmed&term=${term}&retmax=40&sort=date&retmode=json`)).json()
  const ids = es.esearchresult?.idlist || []
  if (!ids.length) return { total: 0, items: [] }
  await sleep(350)
  const xml = await (await fetch(`${EUTILS}/efetch.fcgi?db=pubmed&id=${ids.join(',')}&retmode=xml`)).text()

  const re = orgBoundaryRe(name)
  const distinctive = isDistinctive(name)
  const cityL = (city || '').toLowerCase()
  const items = []
  for (const block of xml.split('<PubmedArticle>').slice(1)) {
    const affs = [...block.matchAll(/<Affiliation>([\s\S]*?)<\/Affiliation>/g)].map(m => strip(m[1]))
    // The company must appear at an org boundary in an affiliation, and — unless
    // its name is distinctive — that same affiliation must also carry the
    // company's city or domain (kills same-named but unrelated organizations).
    const ok = affs.some(a => {
      if (!re.test(a)) return false
      if (distinctive) return true
      const al = a.toLowerCase()
      return (cityL && al.includes(cityL)) || (host && al.includes(host))
    })
    if (!ok) continue
    const pmid = tag(block, 'PMID')
    const title = strip(tag(block, 'ArticleTitle'))
    const journal = strip(tag(tag(block, 'Journal') || '', 'Title'))
    const year = strip(tag(tag(block, 'PubDate') || '', 'Year')) || (strip(tag(block, 'MedlineDate')) || '').slice(0, 4)
    if (!pmid || !title) continue
    if (!relevant(title, journal)) continue // genuine affiliation, but off-topic
    items.push({ pmid, title: title.replace(/\.$/, ''), journal, year, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` })
    if (items.length >= MAX_ITEMS) break
  }
  return { total: items.length, items }
}

async function loadCompanies() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('organizations').select('id,name,location,website').eq('type', 'company').range(from, from + 999)
    if (error) throw new Error(error.message)
    all.push(...data)
    if (data.length < 1000) break
  }
  return all
}

// City for corroboration = the first location segment ("Alameda, CA" → "alameda").
// Skip 2-letter state/country codes and bare country names — too weak to help.
const cityOf = loc => {
  const c = String(loc || '').split(',')[0].trim()
  return c.length >= 4 ? c : ''
}
const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } }

async function run() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })
  let checked = {}
  try { checked = JSON.parse(readFileSync(CHECKED, 'utf8')) } catch { /* first run */ }
  const fresh = t => t && (Date.now() - new Date(t)) / 864e5 < STALE_DAYS

  let companies = await loadCompanies()
  if (FUNDED_ONLY) {
    const sec = JSON.parse(readFileSync(FUNDING, 'utf8'))
    const cur = JSON.parse(readFileSync(CURATED, 'utf8'))
    // Only companies with a real figure (SEC-resolved or curated), not the
    // negative "source:none" markers that exist for every company.
    const funded = new Set([
      ...Object.entries(sec).filter(([, v]) => (v.total || 0) > 0).map(([k]) => k),
      ...Object.keys(cur),
    ])
    companies = companies.filter(c => funded.has(c.name))
  }
  console.log(`Indexing publications for ${companies.length} companies…`)

  let wrote = 0, empty = 0, skipped = 0
  for (const c of companies) {
    if (!FORCE && fresh(checked[c.id])) { skipped++; continue }
    let pubs = { total: 0, items: [] }
    if (searchable(c.name)) {
      try { pubs = await pubmed(c.name, { city: cityOf(c.location), host: hostOf(c.website) }) } catch (e) { console.warn(`  ! ${c.name}: ${e.message}`) }
      await sleep(350)
    }
    checked[c.id] = new Date().toISOString()
    if (pubs.total > 0) {
      writeFileSync(join(OUT, `${c.id}.json`), JSON.stringify({ name: c.name, publications: pubs, generatedAt: checked[c.id] }))
      wrote++
      if (wrote % 25 === 0) console.log(`  …${wrote} companies with publications so far`)
    } else empty++
  }
  writeFileSync(CHECKED, JSON.stringify(checked))
  console.log(`✓ analytics: ${wrote} companies with publications, ${empty} none, ${skipped} skipped (fresh)`)
}

run().catch(e => { console.error(e); process.exit(1) })
