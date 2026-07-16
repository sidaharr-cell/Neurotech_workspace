/**
 * backfill-funding.js — auto-update company funding from SEC EDGAR Form D
 * filings (free). Resolves each company's own issuer entity, extracts its real
 * rounds, and writes src/data/funding.json { name: { total, latestAmount,
 * latestDate, source } }. Re-runnable; curated figures are the fallback.
 *   node scripts/backfill-funding.js
 */
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, '../src/data')
const companies = JSON.parse(readFileSync(join(dataDir, 'companies.json'), 'utf8')).filter(c => c.type === 'company')

const UA = { headers: { 'User-Agent': 'NeuroBase research@neurobase.app' } }
const BAD = /\b(spv|fund|trust|partners|capital|ventures|holdings|series|lp|l\.p\.)\b/i
const sleep = ms => new Promise(r => setTimeout(r, ms))

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

async function resolve(name) {
  try {
    const d = await (await fetch(`https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(name)}%22&forms=D`, UA)).json()
    const hits = (d.hits?.hits || []).filter(h => {
      const dn = h._source.display_names?.[0] || ''
      return dn.toLowerCase().startsWith(name.toLowerCase()) && !BAD.test(dn)
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
      await sleep(150)
    }
    if (!filings.length) return null
    filings.sort((a, b) => b.date.localeCompare(a.date))
    return { total: Math.round(clusterTotal(filings) / 1e6), latestAmount: Math.round(filings[0].amount / 1e6), latestDate: filings[0].date }
  } catch { return null }
}

async function run() {
  const out = {}
  for (const c of companies) {
    let r = await resolve(c.name)
    // Reject a wrong entity match: SEC filings that predate the company's
    // founding year mean we matched an unrelated namesake.
    const founded = parseInt(c.founded, 10)
    if (r && founded && r.latestDate && new Date(r.latestDate).getUTCFullYear() < founded) r = null
    if (r && r.total > 0) {
      out[c.name] = { total: Math.max(r.total, c.funding || 0), latestAmount: r.latestAmount, latestDate: r.latestDate, source: 'sec' }
      console.log(`  ${c.name}: total ~$${out[c.name].total}M · latest $${r.latestAmount}M (${r.latestDate})`)
    } else {
      out[c.name] = { total: c.funding || 0, source: 'curated' }
      console.log(`  ${c.name}: curated $${c.funding}M (no SEC issuer)`)
    }
    await sleep(300)
  }
  writeFileSync(join(dataDir, 'funding.json'), JSON.stringify(out, null, 2) + '\n')
  console.log(`✓ Wrote funding.json (${Object.keys(out).length} companies)`)
}

run().catch(e => { console.error(e); process.exit(1) })
