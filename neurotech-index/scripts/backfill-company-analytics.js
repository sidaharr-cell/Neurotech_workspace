/**
 * backfill-company-analytics.js — precompute the per-company data that can't be
 * joined live from our own Supabase: the company's OFFICIAL peer-reviewed
 * publications. Writes one static file per company,
 *   public/company-analytics/<company-id>.json
 * served on demand by the company page. (Devices, patents, clinical trials and
 * news mentions are joined live from Supabase in the page — no precompute.)
 *
 *   node --env-file=.env scripts/backfill-company-analytics.js            # all
 *   node --env-file=.env scripts/backfill-company-analytics.js --funded   # funded only
 *   node --env-file=.env scripts/backfill-company-analytics.js --force     # ignore cache
 *
 * Two stages:
 *   1. CANDIDATES — PubMed affiliation search, then verify each paper genuinely
 *      belongs to the company: the name must sit at an ORG BOUNDARY in an author
 *      affiliation (never a substring of a longer org), corroborated by the
 *      company's own city/domain for generic names. This fixes wrong-org matches.
 *   2. OFFICIAL — Claude then judges which candidates are the company's OWN
 *      research output vs. papers that merely have an employee co-author. This is
 *      the intelligent step: companies publish very differently (some rarely and
 *      in-house, others heavily via academic collaborations), so a fixed keyword
 *      rule can't decide it. Falls back to a conservative metadata heuristic when
 *      no API key is set.
 *
 * Incremental: an id present in _checked.json within STALE_DAYS is skipped, so
 * the daily cron only re-indexes new/stale companies.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const __dir = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dir, '../public/company-analytics')
const CHECKED = join(OUT, '_checked.json')
const FUNDING = resolve(__dir, '../src/data/funding.json')
const CURATED = resolve(__dir, '../src/data/companies-funding.json')
const FORCE = process.argv.includes('--force')
const FUNDED_ONLY = process.argv.includes('--funded')
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || 0
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1]?.toLowerCase()
const STALE_DAYS = 30
const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const MAX_ITEMS = 15          // most candidates we send to the judge / display
const MODEL = 'claude-haiku-4-5-20251001'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null

// Common org words: a name made ONLY of these is too generic to trust on an
// affiliation-boundary match alone — it must be corroborated by the company's
// own city or domain in the same affiliation.
const COMMON = new Set(['science', 'sciences', 'corporation', 'corp', 'inc', 'incorporated', 'ltd', 'limited', 'llc', 'co', 'company', 'group', 'medical', 'medicine', 'systems', 'system', 'labs', 'lab', 'laboratory', 'laboratories', 'technologies', 'technology', 'tech', 'neuro', 'neurotech', 'neurotechnology', 'neurotechnologies', 'neuroscience', 'bio', 'biosciences', 'bioscience', 'biotech', 'health', 'healthcare', 'therapeutics', 'pharma', 'pharmaceutical', 'pharmaceuticals', 'devices', 'device', 'life', 'data', 'digital', 'brain', 'mind', 'neural', 'precision', 'vision', 'sensor', 'sensors', 'solutions', 'research', 'global', 'advanced', 'general', 'institute', 'center', 'centre', 'international', 'the', 'and'])
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const LEGAL = 'inc|incorporated|corp|corporation|ltd|limited|llc|co|company|gmbh|ag|sa|bv|nv|plc|pbc|oy|ab|as|srl|spa'
// The company name must be a COMPLETE org unit in the affiliation: start it (line
// start or after a comma/semicolon/colon/paren) AND end it (immediately, or after
// one legal suffix). Rejects the tail case ("Posit Science Corporation") and the
// prefix case ("Neuralink Foundation").
const orgBoundaryRe = name =>
  new RegExp(`(^|[,;:(]\\s*)${esc(name)}(\\s*,?\\s*(${LEGAL})\\b\\.?)?(?=\\s*[,;.)]|\\s*$)`, 'i')
const isDistinctive = name => name.split(/\s+/).some(t => { const w = t.toLowerCase().replace(/[^a-z0-9]/g, ''); return w.length >= 6 && !COMMON.has(w) })
const searchable = n => n.replace(/[^a-z0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim().length >= 4

const tag = (block, t) => block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1]
const strip = s => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

// Stage 1 — candidates genuinely affiliated with the company (org-verified).
async function candidates(name, { city, host }) {
  const term = encodeURIComponent(`"${name}"[Affiliation]`)
  const es = await (await fetch(`${EUTILS}/esearch.fcgi?db=pubmed&term=${term}&retmax=40&sort=date&retmode=json`)).json()
  const ids = es.esearchresult?.idlist || []
  if (!ids.length) return []
  await sleep(350)
  const xml = await (await fetch(`${EUTILS}/efetch.fcgi?db=pubmed&id=${ids.join(',')}&retmode=xml`)).text()

  const re = orgBoundaryRe(name)
  const distinctive = isDistinctive(name)
  const cityL = (city || '').toLowerCase()
  const atCompany = aff => {
    if (!re.test(aff)) return false
    if (distinctive) return true
    const al = aff.toLowerCase()
    return (cityL && al.includes(cityL)) || (host && al.includes(host))
  }

  const out = []
  for (const block of xml.split('<PubmedArticle>').slice(1)) {
    const authors = [...block.matchAll(/<Author\b[^>]*>([\s\S]*?)<\/Author>/g)].map(m => {
      const affs = [...m[1].matchAll(/<Affiliation>([\s\S]*?)<\/Affiliation>/g)].map(x => strip(x[1]))
      return { affs, company: affs.some(atCompany) }
    })
    if (!authors.some(a => a.company)) continue // no author truly at the company

    const pmid = tag(block, 'PMID')
    const title = strip(tag(block, 'ArticleTitle'))
    if (!pmid || !title) continue
    const journal = strip(tag(tag(block, 'Journal') || '', 'Title'))
    const year = strip(tag(tag(block, 'PubDate') || '', 'Year')) || (strip(tag(block, 'MedlineDate')) || '').slice(0, 4)
    const abstract = [...block.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map(m => strip(m[1])).join(' ').slice(0, 320)
    const withAff = authors.filter(a => a.affs.length)
    const frac = withAff.length ? withAff.filter(a => a.company).length / withAff.length : 0
    // Per-author affiliation tag, in order (company or the institution's lead token).
    const affLine = authors.map(a => a.company ? name : (a.affs[0] ? a.affs[0].split(',')[0].slice(0, 28) : '—')).join(' | ').slice(0, 400)
    out.push({
      pmid, title: title.replace(/\.$/, ''), journal, year, abstract,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      affLine, frac,
      first: authors[0]?.company || false,
      last: authors[authors.length - 1]?.company || false,
    })
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

// Stage 2a — Claude judges which candidates are the company's OWN publications.
async function judge(name, description, cands) {
  const list = cands.map(c =>
    `[${c.pmid}] "${c.title}" — ${c.journal || 'n/a'}, ${c.year || 'n/a'}. Authors' affiliations (in order): ${c.affLine}. Abstract: ${c.abstract || '(none)'}`
  ).join('\n\n')
  const prompt = `You curate the OFFICIAL research publications of a company for a neurotechnology database.

An "official publication" reports the COMPANY'S OWN research, technology, devices, methods, or clinical results — a paper the company itself would list as its publication. Companies publish very differently: some hardware startups publish rarely or never; others publish often through academic collaborations. Judge each paper on whether the work is genuinely the company's own.

INCLUDE only when the company is a primary originator: its team leads the work (first and/or senior authors at the company, or most authors at the company) AND the subject is the company's technology/products/trials.
EXCLUDE when: a company employee is merely a co-author on work led by an academic lab or other institution; the paper is basic science or off-topic and just lists a company affiliation; or the company is a minor collaborator. When unsure, EXCLUDE.

Company: ${name}${description ? ` — ${description}` : ''}

Candidates (each has ≥1 author affiliated with the company):
${list}

Return ONLY a JSON array of the pmids (as strings) that are official publications of this company. If none qualify, return [].`
  const res = await anthropic.messages.create({ model: MODEL, max_tokens: 400, messages: [{ role: 'user', content: prompt }] })
  const text = res.content[0]?.text || ''
  // Claude may add prose around the array — extract the first [...] and parse it.
  const m = text.match(/\[[\s\S]*?\]/)
  if (!m) throw new Error(`no JSON array in response: ${text.slice(0, 60)}`)
  const keep = new Set(JSON.parse(m[0]).map(String))
  return cands.filter(c => keep.has(String(c.pmid)))
}

// Stage 2b — fallback with no API key: keep only high-confidence company-led
// papers (all affiliated authors at the company, or both first AND last author).
const heuristic = cands => cands.filter(c => c.frac >= 0.999 || (c.first && c.last))

async function official(name, description, cands) {
  if (!cands.length) return []
  if (anthropic) {
    try { return await judge(name, description, cands) }
    catch (e) { console.warn(`  ! judge ${name}: ${e.message} — falling back to heuristic`) }
  }
  return heuristic(cands)
}

async function loadCompanies() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('organizations').select('id,name,description,location,website').eq('type', 'company').range(from, from + 999)
    if (error) throw new Error(error.message)
    all.push(...data)
    if (data.length < 1000) break
  }
  return all
}

const cityOf = loc => { const c = String(loc || '').split(',')[0].trim(); return c.length >= 4 ? c : '' }
const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } }
const clean = ({ pmid, title, journal, year, url }) => ({ pmid, title, journal, year, url })

async function run() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })
  if (!anthropic) console.warn('⚠ No ANTHROPIC_API_KEY — using conservative metadata heuristic instead of the LLM judge.')
  let checked = {}
  try { checked = JSON.parse(readFileSync(CHECKED, 'utf8')) } catch { /* first run */ }
  const fresh = t => t && (Date.now() - new Date(t)) / 864e5 < STALE_DAYS

  let companies = await loadCompanies()
  if (FUNDED_ONLY) {
    const sec = JSON.parse(readFileSync(FUNDING, 'utf8'))
    const cur = JSON.parse(readFileSync(CURATED, 'utf8'))
    const funded = new Set([
      ...Object.entries(sec).filter(([, v]) => (v.total || 0) > 0).map(([k]) => k),
      ...Object.keys(cur),
    ])
    companies = companies.filter(c => funded.has(c.name))
  }
  if (ONLY) companies = companies.filter(c => c.name.toLowerCase().includes(ONLY))
  if (LIMIT) companies = companies.slice(0, LIMIT)
  console.log(`Indexing publications for ${companies.length} companies…`)

  let wrote = 0, empty = 0, skipped = 0
  for (const c of companies) {
    if (!FORCE && fresh(checked[c.id])) { skipped++; continue }
    let items = []
    if (searchable(c.name)) {
      try {
        const cands = await candidates(c.name, { city: cityOf(c.location), host: hostOf(c.website) })
        if (cands.length) items = (await official(c.name, c.description, cands)).map(clean)
      } catch (e) { console.warn(`  ! ${c.name}: ${e.message}`) }
      await sleep(350)
    }
    checked[c.id] = new Date().toISOString()
    if (items.length) {
      writeFileSync(join(OUT, `${c.id}.json`), JSON.stringify({ name: c.name, publications: { total: items.length, items }, generatedAt: checked[c.id] }))
      wrote++
      if (wrote % 25 === 0) console.log(`  …${wrote} companies with official publications so far`)
    } else empty++
  }
  writeFileSync(CHECKED, JSON.stringify(checked))
  console.log(`✓ analytics: ${wrote} companies with official publications, ${empty} none, ${skipped} skipped (fresh)`)
}

run().catch(e => { console.error(e); process.exit(1) })
