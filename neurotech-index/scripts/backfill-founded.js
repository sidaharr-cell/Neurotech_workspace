/**
 * backfill-founded.js — a sourced founding year for companies EDGAR cannot reach.
 *
 *   node --env-file=.env scripts/backfill-founded.js                # dry run
 *   node --env-file=.env scripts/backfill-founded.js --commit
 *   node --env-file=.env scripts/backfill-founded.js --limit 40
 *   node --env-file=.env scripts/backfill-founded.js --wikidata-only
 *
 * Requires migration 019. The parse is `extractFoundingYear` in
 * scripts/lib/founding.js, which is pure and tested; this is the sweep.
 *
 * Four sources, strongest first. Requires migration 020 for the last two.
 *
 *   wikidata            inception (P571) on an item whose official website
 *                       (P856) matches the domain we already store.
 *                       Third-party, referenced, stable URL.
 *   wikipedia           an infobox founding year on a page whose text carries
 *                       the company's own domain. Reaches companies that have
 *                       no structured P571 claim.
 *   company_site        the company's own site: schema.org foundingDate first,
 *                       then About-page prose. SELF-REPORTED — nobody checked
 *                       it and it can change without notice.
 *   record_description  a founding year already sitting in this index, inside
 *                       organizations.description. Free, no request, and it
 *                       structures a sentence the company page already shows.
 *                       It carries NO source URL, because organizations.source_url
 *                       is null for every company, and that is why it is last
 *                       and why the UI renders it differently.
 *
 * Incorporation dates are NOT collected here. The UK register's date_of_creation
 * is the same class of fact as SEC Form D and belongs in incorporated_year from
 * migration 018 — see scripts/backfill-companies-house.js.
 *
 * Every value is stored with its source URL, its source CLASS, and the sentence
 * it was read from, and the company page prints the class beside the year. A
 * reader is told where a number came from rather than left to assume.
 *
 * The domain guard on Wikidata is load-bearing, not defensive. There are two
 * Wikidata items named "MindMaze": the domain-verified one gives 2012 and the
 * other gives 1993. Matching on label alone would have taken the wrong one, and
 * this repo already lost $205M to a namesake once (see `core` in lib/funding.js).
 *
 * What this deliberately does NOT do:
 *
 *   It never writes `founded`, the unsourced legacy column, or reads it as
 *   evidence. It never treats an incorporation sentence as a founding year —
 *   that fact has a better source in Form D and its own column from 018.
 *
 * The write invariant: UPDATE scoped by id, touching only the five founded_*
 * columns this script owns. It never inserts and never deletes.
 */
import { createClient } from '@supabase/supabase-js'
import {
  pageText, extractFoundingYear, extractSchemaFounding, preferFounding, ABOUT_PATHS, aboutUrl,
} from './lib/founding.js'

const UA = { 'User-Agent': 'NeuroBase research@neurobase.app' }
const COMMIT = process.argv.includes('--commit')
const WIKIDATA_ONLY = process.argv.includes('--wikidata-only')
/** Re-read only organizations.description. No network at all, so it is cheap to
 *  re-run whenever the extractor learns a new phrasing — which is exactly what
 *  happened when it learned to read "founded in June 2010". */
const DESCRIPTIONS_ONLY = process.argv.includes('--descriptions-only')
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit')
  return i > -1 ? Number(process.argv[i + 1]) : Infinity
})()

const NOW_YEAR = new Date().getFullYear()
const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Company sites are arbitrary and a third of them defeated the first version of
 * this fetcher. Measured on 30 sampled sites: 10 failed outright — DNS, TLS, or
 * an 8-second timeout — which was the single largest bucket of misses, larger
 * than sites that genuinely never state a founding year.
 *
 * So: a longer budget, one retry, and the obvious host variants. Small company
 * sites are slow, often redirect www to apex or the reverse, and a surprising
 * number still answer only on http.
 */
const TIMEOUT_MS = 15000

async function once(url, timeoutMs) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try { return await fetch(url, { headers: UA, signal: ctrl.signal, redirect: 'follow' }) }
  catch { return null }
  finally { clearTimeout(t) }
}

/** Host variants worth trying when the stored URL does not answer. */
function variants(url) {
  try {
    const u = new URL(url)
    const host = u.hostname
    const flipped = host.startsWith('www.') ? host.slice(4) : `www.${host}`
    const out = [url]
    const alt = new URL(url); alt.hostname = flipped; out.push(alt.href)
    if (u.protocol === 'https:') {
      const http = new URL(url); http.protocol = 'http:'; out.push(http.href)
    }
    return out
  } catch { return [url] }
}

async function get(url, timeoutMs = TIMEOUT_MS) {
  for (const candidate of variants(url)) {
    const res = await once(candidate, timeoutMs)
    if (res?.ok) return res
    // One retry on the stored URL only: a slow host often answers the second
    // time, a wrong host never does.
    if (candidate === url) {
      const again = await once(candidate, timeoutMs)
      if (again?.ok) return again
    }
  }
  return null
}

const domainOf = u => {
  try { return new URL(String(u)).hostname.replace(/^www\./, '').toLowerCase() } catch { return null }
}

/**
 * Wikidata inception, but only for an item we can tie to this company by its
 * official website. Anything else is a name that happens to collide.
 */
async function fromWikidata(name, website) {
  const ours = domainOf(website)
  if (!ours) return null
  const s = await get('https://www.wikidata.org/w/api.php?action=wbsearchentities'
    + `&search=${encodeURIComponent(name)}&language=en&type=item&limit=5&format=json&origin=*`)
  await sleep(120)
  if (!s?.ok) return null
  let hits = []
  try { hits = (await s.json()).search || [] } catch { return null }

  for (const hit of hits.slice(0, 3)) {
    const e = await get(`https://www.wikidata.org/wiki/Special:EntityData/${hit.id}.json`)
    await sleep(120)
    if (!e?.ok) continue
    let ent
    try { ent = (await e.json()).entities?.[hit.id] } catch { continue }
    const time = ent?.claims?.P571?.[0]?.mainsnak?.datavalue?.value?.time
    if (!time) continue
    const sites = (ent?.claims?.P856 || [])
      .map(c => domainOf(c.mainsnak?.datavalue?.value)).filter(Boolean)
    if (!sites.includes(ours)) continue                     // the namesake guard
    const year = Number(String(time).slice(1, 5))
    if (!(year >= 1900 && year <= NOW_YEAR)) continue
    return {
      year,
      kind: 'wikidata',
      sourceUrl: `https://www.wikidata.org/wiki/${hit.id}`,
      evidence: `Wikidata ${hit.id} inception ${year}, official website ${ours}`,
    }
  }
  return null
}

/**
 * The company's own account of itself.
 *
 * The homepage is fetched FIRST and on its own, and a host that cannot answer it
 * ends the company there. Without that, a dead domain costs three host variants
 * times a retry times twenty seconds, on each of eight paths — minutes per
 * company, on the companies least likely to yield anything. Reachability is
 * decided once; only then is it worth asking for sub-pages.
 */
async function fromCompanySite(website) {
  const root = aboutUrl(website, '')
  if (!root) return null
  const rootRes = await get(root)
  if (!rootRes) return null                 // host is dead: do not try /about on it

  let best = null, bestUrl = null
  for (const path of ABOUT_PATHS) {
    const url = aboutUrl(website, path)
    if (!url) break
    // The homepage is already in hand; sub-pages get one quick attempt each,
    // since the host has proven it answers.
    const res = path === '' ? rootRes : await once(url, 9000)
    await sleep(60)
    if (!res?.ok) continue
    let html = ''
    try { html = await res.text() } catch { continue }
    // Machine-written markup first: it needs no interpretation and it survives
    // on JavaScript-rendered sites whose served HTML has no prose at all.
    const found = preferFounding(
      extractSchemaFounding(html),
      extractFoundingYear(pageText(html), NOW_YEAR),
    )
    if (!found) continue
    const chosen = preferFounding(best, found)
    if (chosen !== best) { best = chosen; bestUrl = res.url || url }
    if (best.kind === 'schema_org') break     // nothing on a later page beats it
  }
  if (!best) return null
  return { year: best.year, kind: 'company_site', sourceUrl: bestUrl, evidence: best.phrase }
}

/**
 * Wikipedia's infobox, guarded the same way Wikidata is.
 *
 * The guard here is that the article text must contain the company's own
 * domain — almost always as the infobox `website` field. Without it, "Calm" or
 * "Synchron" match an article about something else entirely.
 */
async function fromWikipedia(name, website) {
  const ours = domainOf(website)
  if (!ours) return null
  const sr = await get('https://en.wikipedia.org/w/api.php?action=query&list=search'
    + `&srsearch=${encodeURIComponent(name)}&srlimit=3&format=json&origin=*`)
  await sleep(120)
  if (!sr?.ok) return null
  let hits = []
  try { hits = (await sr.json()).query?.search || [] } catch { return null }

  for (const hit of hits) {
    const wr = await get('https://en.wikipedia.org/w/api.php?action=parse'
      + `&page=${encodeURIComponent(hit.title)}&prop=wikitext&format=json&origin=*`)
    await sleep(120)
    if (!wr?.ok) continue
    let wikitext = ''
    try { wikitext = (await wr.json()).parse?.wikitext?.['*'] || '' } catch { continue }
    if (!wikitext.toLowerCase().includes(ours)) continue        // the namesake guard

    // Infobox first: "| founded = 2015" or "| foundation = 2015 in Boston".
    const box = wikitext.match(/\|\s*(?:founded|foundation|formed|established)\s*=\s*([^\n|]{0,80})/i)
    let year = null, how = null
    if (box) {
      const m = box[1].match(/((?:19|20)\d{2})/)
      if (m) { year = Number(m[1]); how = `infobox ${box[1].trim().slice(0, 60)}` }
    }
    if (!year) {
      // Fall back to the article's own prose, through the same tested reader.
      const prose = extractFoundingYear(wikitext.replace(/\{\{[^}]*\}\}/g, ' ').replace(/[[\]']/g, ' '), NOW_YEAR)
      if (prose) { year = prose.year; how = prose.phrase.slice(0, 80) }
    }
    if (!year || !(year >= 1900 && year <= NOW_YEAR)) continue
    return {
      year,
      kind: 'wikipedia',
      sourceUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
      evidence: `Wikipedia "${hit.title}": ${how}`,
    }
  }
  return null
}

/**
 * A founding year already in this index, inside the description we display.
 *
 * Free and instant. It carries no source URL because organizations.source_url
 * is null for every company row, so it is the last source asked and the only
 * one migration 020 exempts from the URL requirement.
 */
function fromDescription(description) {
  const hit = extractFoundingYear(description || '', NOW_YEAR)
  if (!hit) return null
  return {
    year: hit.year,
    kind: 'record_description',
    sourceUrl: null,
    evidence: `NeuroBase record description: ${hit.phrase}`,
  }
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  const BASE = 'id,name,website,description'

  /**
   * Paged, because Supabase caps rows per request and a bare .limit() past that
   * cap is silently truncated. An unpaged read returned 1000 of 1084 companies
   * and reported nothing wrong: 84 would have been dropped from the sweep and
   * counted as having no founding year.
   */
  async function readAll(cols) {
    const rows = []
    for (let from = 0; ; from += 500) {
      const { data, error: e } = await sb.from('organizations').select(cols)
        .eq('type', 'company').order('name').order('id').range(from, from + 499)
      if (e) return { error: e }
      rows.push(...data)
      if (data.length < 500) return { rows }
    }
  }

  let { rows: orgs, error } = await readAll(`${BASE},founded_year,founded_source_kind`)
  if (error && /founded_year/.test(error.message)) {
    if (COMMIT) {
      console.error('Migration 019 has not been applied, so there is nothing to write to.')
      console.error('Apply supabase/migrations/019-founded-year.sql, then re-run.')
      process.exit(1)
    }
    console.warn('Migration 019 not applied. Reading anyway, since a dry run writes nothing.\n')
    ;({ rows: orgs, error } = await readAll(BASE))
  }
  if (error) { console.error('read failed:', error.message); process.exit(1) }

  const targets = orgs.slice(0, LIMIT)
  console.log(`${targets.length} companies${COMMIT ? '' : '  (dry run)'}\n`)

  const now = new Date().toISOString()
  const updates = []
  const stats = { wikidata: 0, wikipedia: 0, company_site: 0, record_description: 0, none: 0 }
  const samples = []

  /**
   * Progress, because this is a two-hour job and the first version printed
   * nothing until it finished. A run that has silently died and a run that is
   * working look identical without it.
   */
  const started = Date.now()
  let done = 0
  const tick = () => {
    done++
    if (done % 25 && done !== targets.length) return
    const per = (Date.now() - started) / done / 1000
    const left = Math.round((targets.length - done) * per / 60)
    const got = stats.wikidata + stats.wikipedia + stats.company_site + stats.record_description
    console.log(`  ${done}/${targets.length}  found ${got}  ${per.toFixed(1)}s each  ~${left} min left`)
  }

  for (const o of targets) {
    // A description is the weakest source there is. It never displaces a year
    // already established from a filing, a press report or Wikidata.
    if (DESCRIPTIONS_ONLY && o.founded_year && o.founded_source_kind !== 'record_description') {
      stats.none++; tick(); continue
    }
    const hit = DESCRIPTIONS_ONLY ? fromDescription(o.description)
      : (await fromWikidata(o.name, o.website))
      || (WIKIDATA_ONLY ? null : await fromWikipedia(o.name, o.website))
      || (WIKIDATA_ONLY ? null : await fromCompanySite(o.website))
      || fromDescription(o.description)
    if (!hit) { stats.none++; tick(); continue }
    stats[hit.kind]++
    tick()
    if (samples.length < 15) samples.push(`  ${o.name} = ${hit.year} (${hit.kind}) — ${hit.evidence.slice(0, 90)}`)
    updates.push({
      id: o.id,
      founded_year: hit.year,
      founded_source_url: hit.sourceUrl,
      founded_source_kind: hit.kind,
      founded_evidence: hit.evidence.slice(0, 500),
      founded_retrieved_at: now,
    })
  }

  const n = targets.length
  const pct = k => `${k} (${n ? Math.round((100 * k) / n) : 0}%)`
  console.log(`wikidata, domain-verified : ${pct(stats.wikidata)}`)
  console.log(`wikipedia, domain-verified: ${pct(stats.wikipedia)}`)
  console.log(`company's own site        : ${pct(stats.company_site)}`)
  console.log(`our own description       : ${pct(stats.record_description)}`)
  console.log(`no founding year found    : ${pct(stats.none)}`)
  console.log(`\nsample of what would be written:\n${samples.join('\n')}`)

  if (!COMMIT) {
    console.log(`\nDry run. ${updates.length} rows would be written. Re-run with --commit.`)
    return
  }

  let written = 0
  const failures = []
  for (const { id, ...cols } of updates) {
    const { error: wErr } = await sb.from('organizations').update(cols).eq('id', id)
    if (wErr) failures.push(`${id}: ${wErr.message}`)
    else written++
  }
  console.log(`\nWrote ${written} of ${updates.length} rows.`)
  if (failures.length) {
    console.error(`${failures.length} failed:`)
    for (const f of failures.slice(0, 10)) console.error(`  ${f}`)
    process.exit(1)
  }
}

run().catch(e => { console.error(e); process.exit(1) })
