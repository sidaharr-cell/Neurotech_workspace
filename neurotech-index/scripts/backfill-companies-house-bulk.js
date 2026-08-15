/**
 * backfill-companies-house-bulk.js — UK incorporation dates, without an API key.
 *
 *   curl -O https://download.companieshouse.gov.uk/BasicCompanyDataAsOneFile-YYYY-MM-01.zip
 *   unzip -p BasicCompanyDataAsOneFile-*.zip | node --env-file=.env scripts/backfill-companies-house-bulk.js
 *   unzip -p BasicCompanyDataAsOneFile-*.zip | node --env-file=.env scripts/backfill-companies-house-bulk.js --commit
 *
 * Same fact and same rules as backfill-companies-house.js, which uses the search
 * API and needs a key this project declined to register for. The bulk snapshot
 * is a plain download with no account: ~493 MB zipped, one row per UK company.
 *
 * The CSV is read from STDIN and never extracted. `unzip -p` streams it, so the
 * 2.5 GB uncompressed file never touches disk and memory holds only the handful
 * of rows whose names we are actually looking for.
 *
 * This writes incorporated_year (migration 018), NOT founded_year. The register
 * records when a company was REGISTERED, which is the same class of fact as SEC
 * Form D Item 2 and the same distance from "founded": a business can trade for
 * years before registering, and re-registering resets the date.
 *
 * Matching is `pickCompany` from the API version, unchanged and tested there —
 * exactly one entry must survive the name and status filters, because the
 * register is full of namesakes and a wrong match puts another company's date on
 * a page. That is the rule that stops "Aura" becoming "Aura Group".
 *
 * The write invariant: UPDATE scoped by id, touching only the incorporated_*
 * columns. It never inserts, never deletes, and never overwrites a reading
 * already established from an SEC filing.
 */
import { createClient } from '@supabase/supabase-js'
import { createInterface } from 'node:readline'
import { core } from './lib/funding.js'
import { pickCompany } from './backfill-companies-house.js'

const COMMIT = process.argv.includes('--commit')

/** One CSV line into fields, honouring quoted commas. The register quotes any
 *  name containing a comma, and a naive split puts half of it in the next
 *  column. */
export function splitCsvLine(line) {
  const out = []
  let cur = '', quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else quoted = false
      } else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map(s => s.trim())
}

/** "05/04/2011" -> 2011. The register writes dates day-first. */
export function yearOfCreation(value) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value || '').trim())
  if (m) return Number(m[3])
  const iso = /^(\d{4})-\d{2}-\d{2}/.exec(String(value || '').trim())
  return iso ? Number(iso[1]) : null
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }
  if (process.stdin.isTTY) {
    console.error('Nothing on stdin. Pipe the register CSV in:')
    console.error('  unzip -p BasicCompanyDataAsOneFile-*.zip | node --env-file=.env scripts/backfill-companies-house-bulk.js')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  // Companies with no incorporation reading yet. A value already established
  // from an SEC filing is not re-litigated against a UK register.
  const wanted = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await sb.from('organizations')
      .select('id,name,location,incorporated_year,incorporated_before_year')
      .eq('type', 'company')
      .is('incorporated_year', null).is('incorporated_before_year', null)
      .order('name').range(from, from + 499)
    if (error) {
      console.error('read failed:', error.message)
      if (/incorporated_/.test(error.message)) console.error('Run migration 018 first.')
      process.exit(1)
    }
    wanted.push(...data)
    if (data.length < 500) break
  }

  // core(name) -> our rows. A collision on our own side is left unresolved for
  // the same reason a collision on the register's side is.
  const byCore = new Map()
  for (const o of wanted) {
    const k = core(o.name)
    if (!k) continue
    if (!byCore.has(k)) byCore.set(k, [])
    byCore.get(k).push(o)
  }
  console.error(`${wanted.length} companies with no incorporation year; ${byCore.size} distinct names to look for`)
  console.error(`reading the register from stdin${COMMIT ? '' : '  (dry run)'}...`)

  // Only rows whose name we are looking for are kept, so memory stays flat
  // across 5.5 million register entries.
  const candidates = new Map()
  let header = null, seen = 0
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line) continue
    if (!header) {
      header = splitCsvLine(line).map(h => h.replace(/^﻿/, ''))
      const need = ['CompanyName', 'CompanyNumber', 'CompanyStatus', 'IncorporationDate']
      const missing = need.filter(h => !header.includes(h))
      if (missing.length) {
        console.error(`register CSV is missing ${missing.join(', ')} — header was: ${header.slice(0, 6).join(' | ')}`)
        process.exit(1)
      }
      continue
    }
    seen++
    if (seen % 1_000_000 === 0) console.error(`  ${(seen / 1e6).toFixed(0)}M register rows read`)
    // Cheap reject before the expensive split: most rows are not for us.
    const firstComma = line.indexOf(',')
    const rawName = line.startsWith('"') ? null : line.slice(0, firstComma)
    if (rawName !== null && !byCore.has(core(rawName))) continue

    const f = splitCsvLine(line)
    const row = Object.fromEntries(header.map((h, i) => [h, f[i]]))
    const k = core(row.CompanyName)
    if (!byCore.has(k)) continue
    if (!candidates.has(k)) candidates.set(k, [])
    candidates.get(k).push({
      title: row.CompanyName,
      company_number: row.CompanyNumber,
      company_status: String(row.CompanyStatus || '').toLowerCase(),
      date_of_creation: row.IncorporationDate,
    })
  }
  console.error(`read ${seen.toLocaleString()} register rows; ${candidates.size} of our names appear in it`)

  const now = new Date().toISOString()
  const updates = []
  const stats = { matched: 0, ambiguous: 0, absent: 0, ourNameCollides: 0 }
  const samples = []

  for (const [k, rows] of byCore) {
    if (rows.length > 1) { stats.ourNameCollides++; continue }
    const o = rows[0]
    const found = candidates.get(k)
    if (!found) { stats.absent++; continue }
    const hit = pickCompany(o.name, found)
    if (!hit) { stats.ambiguous++; continue }
    const year = yearOfCreation(hit.date_of_creation)
    if (!(year >= 1900 && year <= new Date().getFullYear())) { stats.absent++; continue }
    stats.matched++
    if (samples.length < 15) {
      samples.push(`  ${o.name} = ${year}  (${hit.company_number}, ${hit.company_status}, ${o.location || 'no location'})`)
    }
    updates.push({
      id: o.id,
      incorporated_year: year,
      incorporated_before_year: null,
      incorporated_source_url:
        `https://find-and-update.company-information.service.gov.uk/company/${hit.company_number}`,
      incorporated_retrieved_at: now,
    })
  }

  console.log(`\nmatched exactly one register entry : ${stats.matched}`)
  console.log(`name found but ambiguous           : ${stats.ambiguous}  (left alone on purpose)`)
  console.log(`not in the UK register             : ${stats.absent}`)
  console.log(`our own name collides              : ${stats.ourNameCollides}`)
  if (samples.length) console.log(`\nsample:\n${samples.join('\n')}`)

  if (!COMMIT) {
    console.log(`\nDry run. ${updates.length} rows would be written. Re-run with --commit.`)
    return
  }

  let written = 0
  const failures = []
  for (const { id, ...cols } of updates) {
    const { error } = await sb.from('organizations').update(cols).eq('id', id)
    if (error) failures.push(`${id}: ${error.message}`)
    else written++
  }
  console.log(`\nWrote ${written} of ${updates.length} rows.`)
  if (failures.length) {
    console.error(`${failures.length} failed:`)
    for (const f of failures.slice(0, 10)) console.error(`  ${f}`)
    process.exit(1)
  }
}

if (process.argv[1] && process.argv[1].endsWith('backfill-companies-house-bulk.js')) {
  run().catch(e => { console.error(e); process.exit(1) })
}
