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
 * Two sources, strongest first.
 *
 *   wikidata      inception (P571) on an item whose official website (P856)
 *                 matches the domain we already store. Third-party, referenced,
 *                 stable URL.
 *   company_site  the company's own About page. SELF-REPORTED: nobody checked
 *                 it, it can change without notice, and it is a weaker class of
 *                 evidence than anything else in this index. It is here because
 *                 measured on a sample of 40, Wikidata alone reaches 3% of the
 *                 companies without a CIK and the About page reaches 10%.
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
  pageText, extractFoundingYear, preferFounding, ABOUT_PATHS, aboutUrl,
} from './lib/founding.js'

const UA = { 'User-Agent': 'NeuroBase research@neurobase.app' }
const COMMIT = process.argv.includes('--commit')
const WIKIDATA_ONLY = process.argv.includes('--wikidata-only')
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit')
  return i > -1 ? Number(process.argv[i + 1]) : Infinity
})()

const NOW_YEAR = new Date().getFullYear()
const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Company sites are arbitrary and some never answer. A dead host must cost a
 *  few seconds, not the run. */
async function get(url, timeoutMs = 8000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try { return await fetch(url, { headers: UA, signal: ctrl.signal, redirect: 'follow' }) }
  catch { return null }
  finally { clearTimeout(t) }
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

/** The company's own account of itself, from its About page. */
async function fromCompanySite(website) {
  let best = null, bestUrl = null
  for (const path of ABOUT_PATHS) {
    const url = aboutUrl(website, path)
    if (!url) return null
    const res = await get(url)
    await sleep(60)
    if (!res?.ok) continue
    let html = ''
    try { html = await res.text() } catch { continue }
    const found = extractFoundingYear(pageText(html), NOW_YEAR)
    if (!found) continue
    const chosen = preferFounding(best, found)
    if (chosen !== best) { best = chosen; bestUrl = res.url || url }
    if (best.kind === 'founded') break        // strongest claim; stop asking
  }
  if (!best) return null
  return { year: best.year, kind: 'company_site', sourceUrl: bestUrl, evidence: best.phrase }
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  const BASE = 'id,name,website'
  const select = cols => sb.from('organizations').select(cols)
    .eq('type', 'company').not('website', 'is', null).order('name').limit(1200)

  let { data: orgs, error } = await select(`${BASE},founded_year`)
  if (error && /founded_year/.test(error.message)) {
    if (COMMIT) {
      console.error('Migration 019 has not been applied, so there is nothing to write to.')
      console.error('Apply supabase/migrations/019-founded-year.sql, then re-run.')
      process.exit(1)
    }
    console.warn('Migration 019 not applied. Reading anyway, since a dry run writes nothing.\n')
    ;({ data: orgs, error } = await select(BASE))
  }
  if (error) { console.error('read failed:', error.message); process.exit(1) }

  const targets = orgs.slice(0, LIMIT)
  console.log(`${targets.length} companies with a website${COMMIT ? '' : '  (dry run)'}\n`)

  const now = new Date().toISOString()
  const updates = []
  const stats = { wikidata: 0, company_site: 0, none: 0 }
  const samples = []

  for (const o of targets) {
    const hit = (await fromWikidata(o.name, o.website))
      || (WIKIDATA_ONLY ? null : await fromCompanySite(o.website))
    if (!hit) { stats.none++; continue }
    stats[hit.kind]++
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
  console.log(`company's own site        : ${pct(stats.company_site)}`)
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
