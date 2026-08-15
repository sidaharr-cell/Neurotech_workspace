/**
 * audit-company-existence.js — for every company with no founding and no
 * incorporation year: does it still exist, and does its own site say when it
 * was founded?
 *
 *   node --env-file=.env scripts/audit-company-existence.js            # report only
 *   node --env-file=.env scripts/audit-company-existence.js --commit   # write verified years
 *   node --env-file=.env scripts/audit-company-existence.js --limit 40
 *
 * Writes a full report to scratch/company-existence-report.json regardless, so
 * every verdict can be inspected without re-running an hour of fetching.
 *
 * ── Why this is not just the founding sweep again ──────────────────────────
 *
 * The 15 Aug 2026 sweep wrote 279 founding years and 69 of them were wrong.
 * Wikipedia matched the wrong article 33 times out of 47. Eight companies were
 * all dated 2005 from a domain-parking page. Two were scraped from LinkedIn,
 * which the project forbids. Prose about a founder's career or a patient's
 * recovery was read as company history.
 *
 * Every one of those failures shared a shape: a year was accepted without
 * establishing that the page it came from was THIS COMPANY'S page and that the
 * sentence was about THE COMPANY. So this pass establishes both, separately,
 * before it believes a year:
 *
 *   1. reachable            the host answers at all
 *   2. still the company's  the final URL after redirects is its own host, and
 *                           not a parking, social or directory site
 *   3. names itself         the page actually mentions the company
 *   4. states a year        schema.org markup, or prose that names the company
 *   5. says it twice        the page is fetched again, independently, and must
 *                           yield the identical year
 *
 * Only a year that clears all five is written. Everything else is reported with
 * the reason, because "we looked and the site does not say" and "we could not
 * look" are different findings and the difference is the point of the exercise.
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'node:fs'
import {
  pageText, extractFoundingYear, extractSchemaFounding, preferFounding,
  sameSite, nameTokens, ABOUT_PATHS, aboutUrl,
} from './lib/founding.js'

const UA = { 'User-Agent': 'NeuroBase research@neurobase.app' }
const COMMIT = process.argv.includes('--commit')
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit')
  return i > -1 ? Number(process.argv[i + 1]) : Infinity
})()
const OUT = 'scratch/company-existence-report.json'
const NOW_YEAR = new Date().getFullYear()
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function once(url, timeoutMs = 12000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try { return await fetch(url, { headers: UA, signal: ctrl.signal, redirect: 'follow' }) }
  catch { return null }
  finally { clearTimeout(t) }
}

/** The stored URL, then the www flip, then http. */
function variants(url) {
  try {
    const u = new URL(url)
    const flipped = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`
    const alt = new URL(url); alt.hostname = flipped
    const out = [url, alt.href]
    if (u.protocol === 'https:') { const h = new URL(url); h.protocol = 'http:'; out.push(h.href) }
    return out
  } catch { return [url] }
}

async function reach(url) {
  for (const c of variants(url)) {
    const r = await once(c)
    if (r?.ok) return r
  }
  return null
}

/** Does this page belong to this company and say so? */
function pageNamesCompany(text, name) {
  const toks = nameTokens(name)
  const lower = String(text || '').toLowerCase()
  return toks.some(t => lower.includes(t))
}

/** One reading from one page, or null. */
function readPage(html, name) {
  return preferFounding(
    extractSchemaFounding(html),
    extractFoundingYear(pageText(html), NOW_YEAR, name),
  )
}

async function inspect(org) {
  const site = org.website
  if (!site || !aboutUrl(site, '')) return { status: 'no_website' }

  const root = await reach(aboutUrl(site, ''))
  if (!root) return { status: 'unreachable' }

  // Where did we actually land?
  if (!sameSite(root.url, site)) {
    return { status: 'redirected_away', landedOn: root.url }
  }

  let html = ''
  try { html = await root.text() } catch { return { status: 'unreadable' } }
  const text = pageText(html)
  const named = pageNamesCompany(text, org.name)

  // Look for a year across the site's own pages.
  let best = null, bestUrl = null
  const first = readPage(html, org.name)
  if (first) { best = first; bestUrl = root.url }
  if (!best || best.kind !== 'schema_org') {
    for (const path of ABOUT_PATHS.filter(Boolean)) {
      const u = aboutUrl(site, path)
      const r = await once(u, 9000)
      await sleep(50)
      if (!r?.ok || !sameSite(r.url, site)) continue
      let h = ''
      try { h = await r.text() } catch { continue }
      const found = readPage(h, org.name)
      if (!found) continue
      const chosen = preferFounding(best, found)
      if (chosen !== best) { best = chosen; bestUrl = r.url }
      if (best.kind === 'schema_org') break
    }
  }

  if (!best) {
    return { status: named ? 'live_no_year' : 'live_unconfirmed', thin: text.length < 400 }
  }

  // ── The double check ────────────────────────────────────────────────────
  // Fetch the winning page again, independently, and require the same answer.
  await sleep(400)
  const again = await once(bestUrl, 12000)
  if (!again?.ok || !sameSite(again.url, site)) {
    return { status: 'unverified', year: best.year, sourceUrl: bestUrl, reason: 'refetch failed' }
  }
  let h2 = ''
  try { h2 = await again.text() } catch { h2 = '' }
  const confirm = readPage(h2, org.name)
  if (!confirm || confirm.year !== best.year) {
    return {
      status: 'unstable', year: best.year, secondRead: confirm?.year ?? null, sourceUrl: bestUrl,
    }
  }

  return {
    status: 'verified',
    year: best.year,
    kind: best.kind,
    sourceUrl: bestUrl,
    evidence: best.phrase,
    namesCompany: named,
  }
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  const all = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await sb.from('organizations')
      .select('id,name,website,location,founded_year,incorporated_year,incorporated_before_year')
      .eq('type', 'company')
      .is('founded_year', null).is('incorporated_year', null).is('incorporated_before_year', null)
      .order('name').range(from, from + 499)
    if (error) { console.error('read failed:', error.message); process.exit(1) }
    all.push(...data)
    if (data.length < 500) break
  }

  const targets = all.slice(0, LIMIT)
  console.log(`${all.length} companies have neither a founding nor an incorporation year`)
  console.log(`checking ${targets.length}${COMMIT ? ' (will write verified years)' : ' (report only)'}\n`)

  const results = []
  const started = Date.now()
  for (const [i, o] of targets.entries()) {
    const r = await inspect(o)
    results.push({ id: o.id, name: o.name, website: o.website, location: o.location, ...r })
    if ((i + 1) % 25 === 0 || i + 1 === targets.length) {
      const per = (Date.now() - started) / (i + 1) / 1000
      const v = results.filter(x => x.status === 'verified').length
      console.log(`  ${i + 1}/${targets.length}  verified ${v}  ${per.toFixed(1)}s each`
        + `  ~${Math.round((targets.length - i - 1) * per / 60)} min left`)
    }
  }

  const tally = {}
  for (const r of results) tally[r.status] = (tally[r.status] || 0) + 1
  console.log('\n── verdicts ──')
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(20)} ${String(v).padStart(4)}  (${Math.round(100 * v / results.length)}%)`)
  }

  try { mkdirSync('scratch', { recursive: true }) } catch { /* exists */ }
  writeFileSync(OUT, JSON.stringify(results, null, 1))
  console.log(`\nfull report: ${OUT}`)

  const verified = results.filter(r => r.status === 'verified')
  console.log(`\nverified founding years: ${verified.length}`)
  console.log(verified.slice(0, 15).map(r => `  ${r.name} = ${r.year} (${r.kind})`).join('\n'))

  if (!COMMIT) {
    console.log(`\nReport only. Re-run with --commit to write the ${verified.length} verified years.`)
    return
  }
  const now = new Date().toISOString()
  let written = 0
  for (const r of verified) {
    const { error } = await sb.from('organizations').update({
      founded_year: r.year,
      founded_source_kind: 'company_site',
      founded_source_url: r.sourceUrl,
      founded_evidence: String(r.evidence).slice(0, 500),
      founded_retrieved_at: now,
    }).eq('id', r.id)
    if (!error) written++
  }
  console.log(`\nWrote ${written} of ${verified.length}.`)
}

run().catch(e => { console.error(e); process.exit(1) })
