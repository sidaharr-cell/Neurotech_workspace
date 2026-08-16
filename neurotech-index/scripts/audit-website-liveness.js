/**
 * audit-website-liveness.js — which stored websites still answer, and how.
 *
 *   node --env-file=.env scripts/audit-website-liveness.js          # all companies
 *   node --env-file=.env scripts/audit-website-liveness.js --limit 100
 *
 * Reports only. Never writes, because deciding what to do about a dead domain is
 * a judgement: some belong to companies that are simply gone, and some belong to
 * companies that merely moved.
 *
 * Written because the founding-year sweep found a dead or repurposed domain in
 * EVERY batch of nine, and a person had to discover each one by hand. What can
 * be automated is the sorting, not the judgement.
 *
 * READ THIS BEFORE TRUSTING A CLEAN RESULT. The worst failures in this index
 * pass every check here:
 *
 *   energizekids.com answers 200 from its own host and serves a Dutch
 *   school-movement platform that has nothing to do with the company.
 *
 *   lucine.io answers 200 and serves a Telegram bot business that KEPT THE
 *   COMPANY NAME and carries a "© 2026 Lucine" footer.
 *
 * Both are `ok` below. A resold domain that keeps its hostname is invisible to
 * any check that does not read the page, which is exactly the work this script
 * cannot do. Treat `ok` as "worth a person's time", not as "verified".
 *
 * Fetches are HEAD-then-GET with a short timeout and a small concurrency cap,
 * because the point is a survey, not a crawl.
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { classify, STATUS } from './lib/liveness.js'
import { siteUrl } from '../src/lib/website.js'

const LIMIT = Number(process.argv[process.argv.indexOf('--limit') + 1]) || Infinity
const CONCURRENCY = 8
const TIMEOUT_MS = 12_000

async function probe(url) {
  const requestedHost = new URL(url).hostname
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    // Some hosts refuse HEAD but answer GET, so fall through rather than
    // recording a refusal that only describes our own request method.
    let res
    try { res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctl.signal }) }
    catch { res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctl.signal }) }
    return classify({ requestedHost, finalUrl: res.url || url, status: res.status, errorCode: null })
  } catch (e) {
    const code = e?.cause?.code || e?.code || (e?.name === 'AbortError' ? 'ETIMEDOUT' : String(e?.message || e))
    return classify({ requestedHost, finalUrl: null, status: null, errorCode: String(code) })
  } finally {
    clearTimeout(timer)
  }
}

async function run() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const rows = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await sb.from('organizations').select('id,name,website')
      .eq('type', 'company').order('id').range(from, from + 499)
    if (error) { console.error('read failed:', error.message); process.exit(1) }
    rows.push(...data)
    if (data.length < 500) break
  }

  const targets = rows.slice(0, LIMIT === Infinity ? rows.length : LIMIT)
  console.log(`probing ${targets.length} of ${rows.length} companies, ${CONCURRENCY} at a time\n`)

  const out = []
  let done = 0
  const queue = [...targets]
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const row = queue.shift()
      if (!row) return
      const url = siteUrl(row.website)
      const r = url ? await probe(url) : { status: STATUS.NO_URL, detail: null }
      out.push({ id: row.id, name: row.name, website: row.website, ...r })
      if (++done % 100 === 0) console.log(`  ${done}/${targets.length}`)
    }
  }))

  const by = {}
  for (const r of out) (by[r.status] ||= []).push(r)
  console.log('')
  for (const k of Object.values(STATUS)) {
    if (by[k]) console.log(`${String(by[k].length).padStart(5)}  ${k}`)
  }

  // Print the ones a person should look at, loudest first. `ok` is not printed:
  // it is the majority and, per the header, is not a verdict anyway.
  for (const k of [STATUS.PARKED, STATUS.OFF_HOST, STATUS.DNS, STATUS.TLS, STATUS.REFUSED, STATUS.HTTP_ERROR]) {
    if (!by[k]?.length) continue
    console.log(`\n--- ${k} (${by[k].length}) ---`)
    for (const r of by[k]) console.log(`  ${r.name.padEnd(38)} ${r.website}${r.detail ? `  ->  ${r.detail}` : ''}`)
  }

  try { mkdirSync('scratch', { recursive: true }) } catch { /* exists */ }
  writeFileSync('scratch/website-liveness.json', JSON.stringify(out, null, 1))
  console.log(`\nfull report: scratch/website-liveness.json`)
  console.log('Reports only. A dead domain may mean the company is gone or merely moved,')
  console.log('and an "ok" may still be a resold domain serving somebody else entirely.')
}

run().catch(e => { console.error(e); process.exit(1) })
