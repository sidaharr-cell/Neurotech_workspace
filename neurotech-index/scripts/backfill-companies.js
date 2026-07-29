/**
 * backfill-companies.js — ingest neurotech companies into the `organizations`
 * table as type='company'. Re-runnable: upserts by deterministic id, then prunes
 * rows no source list mentions any more.
 *   node --env-file=.env scripts/backfill-companies.js
 *
 * Sources (union, deduped by normalized name; curated wins on conflict):
 *   1. src/data/companies.json        — the 21 hand-curated flagship companies
 *   2. src/data/companies-extra.json  — notable companies missing from the
 *      NeuroTechX snapshot (e.g. Salvia BioElectronics)
 *   3. scripts/data/neurotechx-industry.json — snapshot of the public
 *      NeuroTechX "Industry" ecosystem Airtable; only rows with
 *      Operating Status = "Active" are imported ("still exists today").
 *
 * Each row is classified through the same deterministic classifier every other
 * ingest uses (facet_* columns) and given device-class focus_areas. Funding is
 * NOT written here — it is owned by scripts/backfill-funding.js, on columns this
 * script must therefore leave alone.
 * rank_score orders the list: funded companies first (log-scaled by $ raised),
 * then everything else by a small quality signal.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { DEVICE_CLASSES } from '../src/lib/taxonomy.js'
import { classify } from '../src/lib/classify.js'
import { fetchSharedView } from './lib/airtable.js'
import { uuidv5 } from './lib/uuid.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const read = p => JSON.parse(readFileSync(resolve(__dir, p), 'utf8'))

// NeuroTechX "Industry" ecosystem shared view.
const INDUSTRY_SHARE = 'shr6ovra8m2OTlXwv'
const SNAPSHOT = '../scripts/data/neurotechx-industry.json'

// Pull the industry table live so the company list auto-updates (new entries,
// status changes). On success the committed snapshot is refreshed; on any
// failure we fall back to it, so a cron run never ends up with no data.
async function loadIndustry() {
  try {
    const { rows } = await fetchSharedView(INDUSTRY_SHARE)
    const mapped = rows
      .filter(r => r['Company Name'])
      .map(r => ({
        name: r['Company Name'],
        status: r['Operating Status'] || null,
        website: r['Website'] || null,
        city: r['City'] || null,
        country: r['Country (-ies)'] || null,
        region: r['Region'] || null,
        type: r['Type'] || [],
        methods: (r['Methods/Technologies'] || []).map(x => x?.foreignRowDisplayName || x),
        applications: (r['Subjects/Applications'] || []).map(x => x?.foreignRowDisplayName || x),
        description: r['Description'] ? String(r['Description']).replace(/\s+/g, ' ').slice(0, 600) : null,
      }))
    writeFileSync(resolve(__dir, SNAPSHOT), JSON.stringify(mapped, null, 0))
    console.log(`Fetched ${mapped.length} industry rows live from NeuroTechX Airtable (snapshot refreshed)`)
    return mapped
  } catch (e) {
    console.warn(`Live Airtable fetch failed (${e.message}); using committed snapshot`)
    return read(SNAPSHOT)
  }
}

// ── name helpers ─────────────────────────────────────────────────────────────
// Normalize for dedup: lowercase, drop trailing "(aka…)/(acquired…)" alias
// parentheticals, drop common company suffixes, collapse punctuation.
const SUFFIX = /\b(inc|incorporated|corp|corporation|co|ltd|limited|llc|gmbh|ag|srl|sa|s\.?a\.?|bv|b\.?v\.?|plc|group|medical|technologies|technology|neurotech|neurotechnologies|neuroelectronics|bioelectronics|health|labs|laboratories)\b/g
function normName(n) {
  return String(n || '')
    .toLowerCase()
    .replace(/\([^)]*\b(aka|acquired|formerly)\b[^)]*\)/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
// Clean the *display* name: strip only alias/acquired parentheticals.
const cleanName = n => String(n || '').replace(/\s*\([^)]*\b(aka|acquired|formerly)\b[^)]*\)\s*/gi, '').trim()

const COUNTRY_ABBR = {
  'United States': 'USA', 'England': 'UK', 'Scotland': 'UK', 'Wales': 'UK',
  'Northern Ireland': 'UK', 'United Kingdom': 'UK', 'Republic of Ireland': 'Ireland',
  'The Netherlands': 'NL', 'Netherlands': 'NL', 'Switzerland': 'Switzerland',
  'Germany': 'Germany', 'France': 'France', 'Canada': 'Canada', 'Israel': 'Israel',
}
const abbr = c => COUNTRY_ABBR[c] || c || ''
function locOf(city, country) {
  return [city, abbr(country)].filter(Boolean).join(', ')
}

const deriveTags = text => {
  const h = (text || '').toLowerCase()
  return DEVICE_CLASSES.filter(c => c.match.some(m => h.includes(m))).map(c => c.id)
}

const withProto = url => {
  const u = String(url || '').trim()
  if (!u) return null
  return /^https?:\/\//i.test(u) ? u : `https://${u}`
}

const trimDesc = (d, n = 340) => {
  const s = String(d || '').replace(/\s+/g, ' ').trim()
  if (s.length <= n) return s
  const cut = s.slice(0, n)
  const sp = cut.lastIndexOf(' ')
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:]$/, '') + '…'
}

// rank_score: funded companies first (log-scaled), then a small tie-breaker so
// the ~1k unfunded companies have a stable, non-random order.
const clamp01 = x => Math.max(0, Math.min(1, x))
function rankScore({ funding, hasDesc, hasWebsite }) {
  if (funding > 0) return 1 + clamp01(Math.log10(1 + funding) / 4) // $10k→~0, $10B→~2.5
  return 0.02 * (hasDesc ? 1 : 0) + 0.01 * (hasWebsite ? 1 : 0)
}

// ── build the row set ────────────────────────────────────────────────────────
const funding = read('../src/data/companies-funding.json')

function curatedRow(c) {
  const text = [c.name, c.description, c.category].filter(Boolean).join(' \n ')
  const row = {
    name: cleanName(c.name),
    type: 'company',
    location: c.location || null,
    founded: c.founded || null,
    description: c.description || null,
    focus_areas: deriveTags(text),
    website: withProto(c.website),
    founders: [],
  }
  return { row, source: 'curated' }
}

function airtableRow(r) {
  const name = cleanName(r.name)
  const methods = (r.methods || []).join(' ')
  const apps = (r.applications || []).join(' ')
  const desc = r.description
    ? trimDesc(r.description)
    : [methods, apps].filter(Boolean).join(' · ') || null
  const text = [name, r.description, methods, apps].filter(Boolean).join(' \n ')
  const row = {
    name,
    type: 'company',
    location: locOf(r.city, r.country) || null,
    founded: null,
    description: desc,
    focus_areas: deriveTags(text),
    website: withProto(r.website),
    founders: [],
  }
  return { row, source: 'airtable' }
}

function build(industryRows) {
  const curated = [
    ...read('../src/data/companies.json').filter(c => c.type === 'company').map(curatedRow),
    ...read('../src/data/companies-extra.json').map(curatedRow),
  ]
  const active = industryRows
    .filter(r => r.status === 'Active' && r.name)
    .map(airtableRow)

  const byKey = new Map()
  // curated first so they win on collision
  for (const { row } of curated) {
    const k = normName(row.name)
    if (k) byKey.set(k, row)
  }
  for (const { row } of active) {
    const k = normName(row.name)
    if (!k || byKey.has(k)) continue
    byKey.set(k, row)
  }

  // classify + score + attach facets. Deterministic id keyed on name so the
  // company's /company/:id URL survives the nightly delete+insert.
  const rows = [...byKey.values()].map(row => {
    const f = classify(row, 'organizations')
    const fund = funding[row.name]?.total || 0
    return {
      id: uuidv5(row.name),
      ...row,
      ...f,
      rank_score: rankScore({ funding: fund, hasDesc: !!row.description, hasWebsite: !!row.website }),
    }
  })
  return rows
}

async function run() {
  const industryRows = await loadIndustry()
  const rows = build(industryRows)
  const funded = rows.filter(r => (funding[r.name]?.total || 0) > 0).length
  const inScope = rows.filter(r => r.in_scope).length
  console.log(`Built ${rows.length} company rows (${funded} with funding, ${inScope} classified in-scope)`)

  if (process.argv.includes('--dry')) {
    const missing = Object.keys(funding).filter(n => !rows.some(r => r.name === n))
    console.log('Sample rows:')
    for (const r of [...rows].sort((a, b) => b.rank_score - a.rank_score).slice(0, 8))
      console.log(`  [${r.rank_score.toFixed(2)}] ${r.name} — ${r.location || '—'} — facets:${r.facet_function.concat(r.facet_access, r.facet_application).length} — ${(r.description || '').slice(0, 60)}`)
    if (missing.length) console.log('⚠ funding-map names with no matching entity:', missing)
    return
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  // Upsert, never delete-and-insert.
  //
  // This script used to `delete().eq('type','company')` and re-insert. That was
  // safe while this script was the only writer of a company row and the ids were
  // deterministic. It stopped being safe the moment migration 008 put funding on
  // this table: the nightly run silently destroyed every column written by the
  // funding pipeline, and funding_rounds.organization_id cascades, so it took
  // 629 sourced rounds with it. Observed 29 Jul 2026, wiping 205 totals, 90
  // stages, 63 inclusion decisions and every status.
  //
  // An upsert only touches the columns in the payload, so anything another
  // pipeline owns survives. Companies that leave the source lists are pruned
  // below rather than by wiping the table first.
  let ok = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { error } = await sb.from('organizations').upsert(chunk, { onConflict: 'id' })
    if (error) console.warn(`upsert error @${i}:`, error.message)
    else ok += chunk.length
  }

  // Prune: company rows that no source list mentions any more. Done by id
  // difference rather than a blanket delete, so a row is only removed when it
  // has genuinely left the sources.
  const live = new Set(rows.map(r => r.id))
  const existing = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('organizations')
      .select('id,name,total_raised_usd').eq('type', 'company').range(from, from + 999)
    if (error) { console.warn('prune read failed:', error.message); break }
    existing.push(...data)
    if (data.length < 1000) break
  }
  const stale = existing.filter(o => !live.has(o.id))
  const staleFunded = stale.filter(o => o.total_raised_usd != null)
  if (staleFunded.length) {
    // Deleting these would discard sourced funding, so say so rather than doing
    // it quietly. A company that has left the source lists but has filings on
    // record is a curation question, not a cleanup.
    console.log(`\n⚠ ${staleFunded.length} company/companies left the source lists but carry a funding figure. Kept:`)
    for (const o of staleFunded.slice(0, 10)) console.log(`    ${o.name}`)
  }
  const removable = stale.filter(o => o.total_raised_usd == null).map(o => o.id)
  for (let i = 0; i < removable.length; i += 200) {
    const { error } = await sb.from('organizations').delete().in('id', removable.slice(i, i + 200))
    if (error) console.warn('prune delete failed:', error.message)
  }

  console.log(`✓ Companies backfill complete — ${ok.toLocaleString()} upserted, ${removable.length} pruned`)
}

run().catch(e => { console.error(e); process.exit(1) })
