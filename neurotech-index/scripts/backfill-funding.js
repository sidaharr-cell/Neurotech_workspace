/**
 * backfill-funding.js — auto-update company funding from SEC EDGAR Form D
 * filings (free) for EVERY company in the database, not just the curated few.
 * Resolves each company's own issuer entity, extracts its real rounds, and
 * writes src/data/funding.json { name: { total, latestAmount, latestDate,
 * source, checkedAt } }.
 *
 *   node --env-file=.env scripts/backfill-funding.js          # DB company set
 *   node --env-file=.env scripts/backfill-funding.js --force  # re-check all
 *
 * Company set comes from the organizations table (type='company'); falls back
 * to companies.json when Supabase isn't configured. Curated figures are NOT
 * written here — they live in companies-funding.json and win in the overlay
 * (src/lib/companyFunding.js).
 *
 * Incremental: an entry checked within STALE_DAYS is kept as-is (including
 * negative "source:none" markers), so the daily cron only resolves new or
 * stale companies. That keeps the SEC crawl fast after the first full pass.
 */
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, '../src/data')
const FORCE = process.argv.includes('--force')
const VERIFY = process.argv.includes('--verify')
const STALE_DAYS = 21

const UA = { headers: { 'User-Agent': 'NeuroBase research@neurobase.app' } }
const BAD = /\b(spv|fund|trust|partners|capital|ventures|holdings|series|lp|l\.p\.)\b/i
const sleep = ms => new Promise(r => setTimeout(r, ms))
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
// Issuer "core": drop the (CIK …) suffix and legal-entity words only, so a match
// requires the *same* company, not a bigger namesake. "RefleXion Medical Inc"
// (core: reflexionmedical) no longer matches "Reflexion", but "Nalu Medical,
// Inc." (core: nalumedical) still matches "Nalu Medical".
const LEGAL = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|lp|llp|plc|gmbh|ag|sa|bv|nv|oy|ab|as|srl|spa|pbc|holdings|group|the)\b/gi
const core = s => norm(String(s || '').replace(/\(cik[^)]*\)/gi, ' ').replace(LEGAL, ' '))

// Load the company set: prefer the live DB (all ~1k companies), else the
// curated JSON. { name, founded } — founded (when known) rejects namesakes.
async function loadCompanies() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY
  if (url && key) {
    const sb = createClient(url, key)
    const all = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('organizations').select('name,founded')
        .eq('type', 'company').range(from, from + 999)
      if (error) { console.warn('DB load failed, using companies.json:', error.message); break }
      all.push(...data)
      if (data.length < 1000) return all
    }
    if (all.length) return all
  }
  return JSON.parse(readFileSync(join(dataDir, 'companies.json'), 'utf8'))
    .filter(c => c.type === 'company').map(c => ({ name: c.name, founded: c.founded }))
}

async function filingAmount(cik, adsh) {
  const url = `https://www.sec.gov/Archives/edgar/data/${cik.replace(/^0+/, '')}/${adsh.replace(/-/g, '')}/primary_doc.xml`
  try {
    const xml = await (await fetch(url, UA)).text()
    const sold = +(xml.match(/<totalAmountSold>([^<]+)</)?.[1] || 0)
    const off = +(xml.match(/<totalOfferingAmount>([^<]+)</)?.[1] || 0)
    return Math.max(sold, off)
  } catch { return 0 }
}

// Group filings into distinct rounds (gap > 120 days), max amount per round.
function clusterTotal(filings) {
  const sorted = [...filings].sort((a, b) => a.date.localeCompare(b.date))
  let total = 0, cur = null
  for (const f of sorted) {
    if (!cur || (new Date(f.date) - new Date(cur.last)) / 864e5 > 120) {
      if (cur) total += cur.max
      cur = { max: f.amount, last: f.date }
    } else { cur.max = Math.max(cur.max, f.amount); cur.last = f.date }
  }
  if (cur) total += cur.max
  return total
}

// Same 120-day clustering, but return one { date, amount } per round (the
// cluster's peak amount, dated at its latest filing).
function clusterRounds(filings) {
  const sorted = [...filings].sort((a, b) => a.date.localeCompare(b.date))
  const rounds = []
  let cur = null
  for (const f of sorted) {
    if (!cur || (new Date(f.date) - new Date(cur.date)) / 864e5 > 120) {
      cur = { date: f.date, amount: f.amount }
      rounds.push(cur)
    } else { cur.amount = Math.max(cur.amount, f.amount); cur.date = f.date }
  }
  return rounds
}

async function resolve(name) {
  const cn = core(name)
  if (cn.length < 4) return null // too generic to disambiguate an issuer
  try {
    const d = await (await fetch(`https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(name)}%22&forms=D`, UA)).json()
    const hits = (d.hits?.hits || []).filter(h => {
      const dn = h._source.display_names?.[0] || ''
      if (BAD.test(dn)) return false
      // Require the issuer to be the SAME company (equal once legal suffixes are
      // stripped), not just a name-prefix — kills bigger-namesake false matches.
      return core(dn) === cn
    })
    if (!hits.length) return null
    // Lock to the single most-frequent clean issuer CIK.
    const freq = {}
    hits.forEach(h => { const c = h._source.ciks?.[0]; if (c) freq[c] = (freq[c] || 0) + 1 })
    const cik = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]
    const own = hits.filter(h => h._source.ciks?.[0] === cik)
    const filings = []
    for (const h of own) {
      const amount = await filingAmount(cik, h._source.adsh)
      if (amount > 0) filings.push({ date: h._source.file_date, amount })
      await sleep(120)
    }
    if (!filings.length) return null
    filings.sort((a, b) => b.date.localeCompare(a.date))
    // Dated rounds (deduped by 120-day cluster) for the funding-per-year chart.
    const rounds = clusterRounds(filings).map(r => ({ date: r.date, amount: Math.round(r.amount / 1e6) })).filter(r => r.amount > 0)
    return { total: Math.round(clusterTotal(filings) / 1e6), latestAmount: Math.round(filings[0].amount / 1e6), latestDate: filings[0].date, rounds }
  } catch { return null }
}

async function run() {
  const path = join(dataDir, 'funding.json')
  let prev = {}
  try { prev = JSON.parse(readFileSync(path, 'utf8')) } catch { /* first run */ }
  const fresh = e => e?.checkedAt && (Date.now() - new Date(e.checkedAt)) / 864e5 < STALE_DAYS

  // --verify: re-check ONLY companies currently marked source:'sec' (cheap pass
  // to purge namesake false positives after a matcher change). Keeps the rest.
  if (VERIFY) {
    const out = { ...prev }
    let kept = 0, dropped = 0
    for (const name of Object.keys(prev).filter(k => prev[k]?.source === 'sec')) {
      const r = await resolve(name)
      if (r && r.total > 0) {
        out[name] = { total: r.total, latestAmount: r.latestAmount, latestDate: r.latestDate, rounds: r.rounds, source: 'sec', checkedAt: new Date().toISOString() }
        kept++
      } else {
        out[name] = { source: 'none', checkedAt: new Date().toISOString() }
        dropped++
        console.log(`  ✗ dropped ${name} (no longer a same-name issuer match)`)
      }
      await sleep(150)
    }
    const sorted = Object.fromEntries(Object.keys(out).sort().map(k => [k, out[k]]))
    writeFileSync(path, JSON.stringify(sorted, null, 2) + '\n')
    console.log(`✓ verify: ${kept} kept, ${dropped} dropped`)
    return
  }

  const companies = await loadCompanies()
  const out = {}
  let resolved = 0, reused = 0, checked = 0
  for (const c of companies) {
    if (!FORCE && fresh(prev[c.name])) { out[c.name] = prev[c.name]; reused++; continue }
    checked++
    let r = await resolve(c.name)
    const founded = parseInt(c.founded, 10)
    // Reject a wrong entity: filings predating the company's founding = namesake.
    if (r && founded && r.latestDate && new Date(r.latestDate).getUTCFullYear() < founded) r = null
    if (r && r.total > 0) {
      out[c.name] = { total: r.total, latestAmount: r.latestAmount, latestDate: r.latestDate, rounds: r.rounds, source: 'sec', checkedAt: new Date().toISOString() }
      resolved++
      console.log(`  ✓ ${c.name}: ~$${r.total}M · latest $${r.latestAmount}M (${r.latestDate})`)
    } else {
      out[c.name] = { source: 'none', checkedAt: new Date().toISOString() }
    }
    await sleep(200)
  }
  // Deterministic key order.
  const sorted = Object.fromEntries(Object.keys(out).sort().map(k => [k, out[k]]))
  writeFileSync(path, JSON.stringify(sorted, null, 2) + '\n')
  console.log(`✓ funding.json: ${Object.keys(out).length} companies (${resolved} resolved this run, ${reused} reused, ${checked} checked)`)
}

run().catch(e => { console.error(e); process.exit(1) })
