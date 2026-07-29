/**
 * backfill-labs.js — ingest neurotech research labs into the `organizations`
 * table as type='lab' (the single owner of all lab rows). Re-runnable: upserts
 * by deterministic id, then prunes rows no source mentions any more.
 *   node --env-file=.env scripts/backfill-labs.js
 *
 * Three sources, unioned and deduped by normalized lab name:
 *   1. NIH RePORTER (free, live)      — US NIH-funded labs, ranked by award $.
 *   2. NeuroTechX "Academic Labs"     — global academic labs (with real
 *      homepages), fetched live from the shared Airtable, snapshot fallback.
 *   3. src/data/labs-extra.json       — hand-curated institutes and consortia
 *      that neither source lists (the Allen Institute, BrainGate, APL). The
 *      companies ingest has had companies-extra.json for this all along; labs
 *      had no equivalent, so six seeded rows sat under types nothing queries.
 * Every row is classified through the shared classifier so the Labs facet
 * filter works immediately after a fresh backfill.
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
const ACADEMIC_SHARE = 'shrWbISXIhaOKKUvz'
const ACADEMIC_SNAPSHOT = '../scripts/data/neurotechx-academic-labs.json'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const TERMS = [
  'brain computer interface', 'neural prosthesis', 'deep brain stimulation',
  'neurostimulation', 'neural interface', 'cochlear implant', 'spinal cord stimulation',
  'neural implant', 'brain machine interface',
]

function deriveTags(text) {
  const h = (text || '').toLowerCase()
  return DEVICE_CLASSES.filter(c => c.match.some(m => h.includes(m))).map(c => c.id)
}
const titleCase = s => (s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/\bLlc\b/i, 'LLC').replace(/\bUc\b/, 'UC')

const normLabName = n => String(n || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\blab(oratory)?\b|\bgroup\b/g, ' ').replace(/\s+/g, ' ').trim()
const withProto = u => { u = String(u || '').trim(); return u ? (/^https?:\/\//i.test(u) ? u : `https://${u}`) : null }

// NeuroTechX "Academic Labs" — global academic labs with real homepages.
// Fetched live so the list auto-updates; falls back to the committed snapshot.
async function loadAcademicLabs() {
  let src
  try {
    const { rows } = await fetchSharedView(ACADEMIC_SHARE)
    src = rows.filter(r => r['Lab Name']).map(r => ({
      labName: r['Lab Name'], university: r['University'], pi: r['Principal Investigator'],
      city: r['City'], country: r['Country'], website: r['Website'], faculty: r['Faculty'] || null,
      subjects: r['Subject(s)'] || [], methods: r['Method(s)'] || [],
    }))
    writeFileSync(resolve(__dir, ACADEMIC_SNAPSHOT), JSON.stringify(src, null, 0))
    console.log(`Fetched ${src.length} academic labs live from NeuroTechX Airtable (snapshot refreshed)`)
  } catch (e) {
    console.warn(`Live academic-labs fetch failed (${e.message}); using committed snapshot`)
    src = JSON.parse(readFileSync(resolve(__dir, ACADEMIC_SNAPSHOT), 'utf8'))
  }
  return src.map(l => {
    const focusList = (l.subjects.length ? l.subjects : l.methods).slice(0, 4).join(', ')
    const head = [l.university, l.faculty].filter(Boolean).join(' · ') || 'Academic neurotech lab'
    return {
      name: l.labName,
      type: 'lab',
      location: [l.city, l.country].filter(Boolean).join(', ') || null,
      founded: null,
      description: `${head}. Focus: ${focusList || 'Neurotechnology research'}.`,
      focus_areas: deriveTags([l.labName, l.subjects.join(' '), l.methods.join(' ')].join(' ')),
      website: withProto(l.website),
      founders: l.pi ? [l.pi] : [],
      // No NIH award signal; rank on breadth of listed subjects/methods so these
      // interleave sensibly below the best-funded NIH labs.
      rank_score: 0.12 + Math.min(0.2, (l.subjects.length + l.methods.length) * 0.02),
    }
  })
}

async function fetchProjects(term, offset) {
  const res = await fetch('https://api.reporter.nih.gov/v2/projects/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      criteria: { advanced_text_search: { operator: 'and', search_field: 'projecttitle,terms,abstracttext', search_text: term } },
      limit: 200, offset,
      include_fields: ['ProjectTitle', 'PrincipalInvestigators', 'Organization', 'FiscalYear', 'AwardAmount'],
    }),
  })
  if (!res.ok) return { results: [], total: 0 }
  const d = await res.json()
  return { results: d.results || [], total: d.meta?.total || 0 }
}

async function run() {
  const ALLOW_SHRINK = process.argv.includes('--allow-shrink')

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const labs = new Map() // key: pi|org
  for (const term of TERMS) {
    for (let offset = 0; offset < 600; offset += 200) {
      const { results, total } = await fetchProjects(term, offset)
      for (const p of results) {
        const pi = p.principal_investigators?.[0]?.full_name
        const org = p.organization?.org_name
        if (!pi || !org) continue
        const key = `${pi}|${org}`.toLowerCase()
        const lab = labs.get(key) || { pi, org, city: p.organization?.org_city, state: p.organization?.org_state, titles: [], years: [], funding: 0 }
        if (p.project_title) lab.titles.push(p.project_title)
        if (p.fiscal_year) lab.years.push(p.fiscal_year)
        lab.funding += p.award_amount || 0
        labs.set(key, lab)
      }
      if (offset + 200 >= total) break
      await sleep(300)
    }
    await sleep(300)
  }

  // Rank labs on native NIH signals: total award funding, project volume, and
  // how recently they were funded (active vs dormant). All normalized 0–1.
  const clamp01 = x => Math.max(0, Math.min(1, x))
  const thisYear = new Date().getFullYear()
  const fmtUSD = n => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${n}`)
  const labScore = l => {
    const funding = clamp01(Math.log10(1 + l.funding) / 7.5)          // ~$30M → 1
    const projects = clamp01(Math.log10(1 + l.titles.length) / 1.5)   // ~30 projects → 1
    const latest = l.years.length ? Math.max(...l.years) : thisYear - 10
    const recency = Math.exp(-Math.max(0, thisYear - latest) * Math.LN2 / 3) // 3-year half-life
    return 0.45 * funding + 0.30 * projects + 0.25 * recency
  }

  const nihRows = [...labs.values()].map(l => {
    const loc = [titleCase(l.city), l.state].filter(Boolean).join(', ')
    const focus = l.titles[0] || 'Neurotechnology research'
    const fundStr = l.funding > 0 ? `${fmtUSD(l.funding)} in NIH funding · ` : ''
    return {
      name: `${titleCase(l.pi)} Lab`,
      type: 'lab',
      location: loc,
      founded: l.years.length ? String(Math.min(...l.years)) : null,
      description: `${titleCase(l.org)} · ${fundStr}${l.titles.length} NIH-funded neurotech project${l.titles.length === 1 ? '' : 's'}. Focus: ${focus}.`,
      focus_areas: deriveTags(l.titles.join(' ')),
      website: null,
      founders: [titleCase(l.pi)],
      rank_score: labScore(l),
    }
  })
  console.log(`Aggregated ${nihRows.length} unique labs from NIH RePORTER`)

  const extraRows = JSON.parse(readFileSync(resolve(__dir, '../src/data/labs-extra.json'), 'utf8'))
    .map(l => ({
      name: l.name,
      type: 'lab',
      location: l.location || null,
      founded: null,
      description: l.description,
      focus_areas: deriveTags([l.name, l.description].join(' ')),
      website: l.website,
      founders: [],
      // Above the unfunded academic rows: these are named institutes rather
      // than single labs, and they are curated rather than scraped.
      rank_score: 0.34,
    }))
  console.log(`Loaded ${extraRows.length} curated institutes from labs-extra.json`)

  const academicRows = await loadAcademicLabs()
  console.log(`Loaded ${academicRows.length} academic labs from NeuroTechX`)

  // Union + dedup by normalized name; NIH (funding-ranked) wins on collision.
  const byKey = new Map()
  // Curated rows win a name collision, which is why they go first.
  for (const r of [...extraRows, ...nihRows, ...academicRows]) {
    const k = normLabName(r.name)
    if (k && !byKey.has(k)) byKey.set(k, r)
  }
  // Classify every row so facet columns are populated, and give each one an id
  // derived from its name.
  //
  // Labs used to be inserted with no id at all, so Postgres minted a fresh
  // gen_random_uuid() on every nightly rebuild and every /lab/:id URL broke
  // overnight. Companies solved this long ago with a deterministic UUIDv5; labs
  // simply never got the same treatment. Deriving the id from the normalised
  // name makes it stable, which is also what lets this script upsert instead of
  // deleting and re-inserting.
  //
  // This changes every existing lab id ONCE. Links shared before this ran will
  // not resolve; from here they are permanent.
  const rows = [...byKey.values()].map(r => ({
    id: uuidv5(`lab:${normLabName(r.name)}`),
    ...r,
    ...classify(r, 'organizations'),
  }))
  console.log(`Total ${rows.length} labs after dedup (${rows.filter(r => r.in_scope).length} classified in-scope)`)

  // Upsert, never delete-and-insert. See docs/funding-data-loss-2026-07-29.md:
  // the companies script did exactly that and destroyed every column another
  // pipeline owned on those rows. Labs carry no funding today, but the table has
  // more than one owner and the rule is the same.
  let ok = 0
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('organizations').upsert(rows.slice(i, i + 500), { onConflict: 'id' })
    if (error) console.warn('lab upsert error:', error.message)
    else ok += Math.min(500, rows.length - i)
  }

  const live = new Set(rows.map(r => r.id))
  const existing = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('organizations')
      .select('id').eq('type', 'lab').range(from, from + 999)
    if (error) { console.warn('prune read failed:', error.message); break }
    existing.push(...data)
    if (data.length < 1000) break
  }
  const stale = existing.filter(o => !live.has(o.id)).map(o => o.id)
  // Same floor as the companies backfill: a source set that has collapsed is a
  // broken source, not a real shrink, and must not empty the table.
  if (!ALLOW_SHRINK && existing.length && rows.length < existing.length * 0.6) {
    console.error(`\n✗ Refusing to prune. Built ${rows.length} lab rows against ${existing.length} stored. ` +
      'That is a source problem. The upserts above are applied; nothing was deleted. ' +
      'Pass --allow-shrink if this shrink is intended.')
    process.exit(1)
  }
  for (let i = 0; i < stale.length; i += 200) {
    const { error } = await sb.from('organizations').delete().in('id', stale.slice(i, i + 200))
    if (error) console.warn('prune delete failed:', error.message)
  }
  console.log(`✓ Labs backfill complete — ${ok.toLocaleString()} upserted, ${stale.length} pruned`)
}

run().catch(e => { console.error(e); process.exit(1) })
