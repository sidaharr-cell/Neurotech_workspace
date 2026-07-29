/**
 * backfill-org-status.js — establish which companies are publicly traded, from
 * SEC primary data, so the Form D branch has something real to branch on.
 *
 *   node --env-file=.env scripts/backfill-org-status.js            # dry run
 *   node --env-file=.env scripts/backfill-org-status.js --commit
 *
 * Source: https://www.sec.gov/files/company_tickers.json, the SEC's own list of
 * issuers with a listed ticker. A company on that list is publicly traded, the
 * list is the citation, and the EDGAR issuer page is stored as
 * status_source_url. The CIK comes along with it, which the funding pipeline
 * then uses to skip a search it does not need.
 *
 * What this script deliberately does NOT do:
 *
 *   It never writes `private`. Absence from a US ticker list is not evidence of
 *   being private: Onward Medical is listed on Euronext and will never appear
 *   there. Inferring private from absence would put a wrong badge on the chart
 *   for every foreign-listed company.
 *
 *   It never writes `acquired` or `defunct`. EDGAR records that a company
 *   stopped filing, not why. Axonics was acquired by Boston Scientific and Pear
 *   Therapeutics went through bankruptcy, and nothing in the filing history
 *   distinguishes those two outcomes. Both need a human with a source, and both
 *   show up in scripts/verify-funding.js as missing status until someone does
 *   that work.
 *
 * So this fills in one status value, the one that can be proven from a primary
 * document, and leaves the rest null.
 */
import { createClient } from '@supabase/supabase-js'
import { core, issuerUrl } from './lib/funding.js'

const COMMIT = process.argv.includes('--commit')
const PIPELINE = 'status-phase2'
const UA = { headers: { 'User-Agent': 'NeuroBase research@neurobase.app' } }
const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json'
const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Industry codes a neurotechnology company could plausibly file under: medical
 * and surgical instruments, electromedical devices, diagnostics, pharma and
 * biologicals, software, semiconductors, and research services.
 *
 * This exists because name matching alone is not enough. Our database holds a
 * neurotech company called GAIA; the ticker GAIA belongs to a streaming media
 * company. The names normalise identically and nothing about the string says
 * they are different businesses. The issuer's own SIC code does.
 */
const PLAUSIBLE_SIC = [/^38/, /^28[34]/, /^737/, /^367/, /^873/, /^80/, /^5047/, /^5122/]

/** The issuer's self-reported industry, from its EDGAR submissions record. */
async function issuerProfile(cik) {
  try {
    const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, UA)
    if (!res.ok) return null
    const body = await res.json()
    return { sic: body.sic, sicDescription: body.sicDescription, name: body.name }
  } catch { return null }
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  const res = await fetch(TICKERS_URL, UA)
  if (!res.ok) { console.error(`SEC ticker file: ${res.status}`); process.exit(1) }
  const listed = Object.values(await res.json())
  console.log(`SEC ticker file: ${listed.length} listed issuers`)

  // core(name) -> { cik, ticker, title }. Collisions are dropped rather than
  // guessed at: two listed issuers normalising to the same name means we cannot
  // tell which one a database row refers to.
  const byCore = new Map()
  const collided = new Set()
  for (const row of listed) {
    const k = core(row.title)
    if (!k) continue
    if (byCore.has(k)) { collided.add(k); continue }
    byCore.set(k, row)
  }
  for (const k of collided) byCore.delete(k)

  const orgs = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('organizations')
      .select('id,name,status,cik').eq('type', 'company').range(from, from + 999)
    if (error) { console.error('read failed:', error.message); process.exit(1) }
    orgs.push(...data)
    if (data.length < 1000) break
  }

  const now = new Date().toISOString()
  const updates = []
  const rejected = []
  for (const o of orgs) {
    const hit = byCore.get(core(o.name))
    if (!hit) continue
    if (o.status === 'public' && o.cik) continue
    const cik = String(hit.cik_str).padStart(10, '0')

    // Confirm the listed issuer is in a business a neurotech company could be
    // in. A name match alone would hand our GAIA the media company's ticker.
    const profile = await issuerProfile(cik)
    await sleep(120)
    if (profile && profile.sic && !PLAUSIBLE_SIC.some(re => re.test(String(profile.sic)))) {
      rejected.push(`${o.name} -> ${hit.ticker} (${profile.sicDescription || profile.sic})`)
      continue
    }

    updates.push({
      id: o.id, name: o.name,
      status: 'public',
      status_source_url: issuerUrl(cik),
      status_verified_at: now,
      cik,
      pipeline_version: PIPELINE,
    })
    console.log(`  ${o.name} -> public (${hit.ticker}, CIK ${cik})`)
  }

  if (rejected.length) {
    console.log('\nName matched a ticker but the industry does not fit, so left alone:')
    for (const r of rejected) console.log(`  ✗ ${r}`)
  }
  console.log(`\n${updates.length} company/companies resolved to public.`)
  console.log(`${orgs.length - updates.length} left as-is: not on the US ticker list, which is not ` +
    'evidence of being private.')

  if (!COMMIT) {
    console.log('\nDry run. Nothing written. Re-run with --commit to apply.')
    return
  }
  for (let i = 0; i < updates.length; i += 100) {
    const { error } = await sb.from('organizations').upsert(updates.slice(i, i + 100), { onConflict: 'id' })
    if (error) { console.error('upsert failed:', error.message); process.exit(1) }
  }
  console.log(`✓ wrote ${updates.length} status values.`)
}

run().catch(e => { console.error(e); process.exit(1) })
