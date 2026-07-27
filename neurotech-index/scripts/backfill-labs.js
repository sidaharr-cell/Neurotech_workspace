/**
 * backfill-labs.js — ingest neurotech research labs into the `organizations`
 * table as type='lab' (the single owner of all lab rows). One-time / re-runnable.
 *   node --env-file=.env scripts/backfill-labs.js
 *
 * Two sources, unioned and deduped by normalized lab name:
 *   1. NIH RePORTER (free, live)      — US NIH-funded labs, ranked by award $.
 *   2. NeuroTechX "Academic Labs"     — global academic labs (with real
 *      homepages), fetched live from the shared Airtable, snapshot fallback.
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

  const academicRows = await loadAcademicLabs()
  console.log(`Loaded ${academicRows.length} academic labs from NeuroTechX`)

  // Union + dedup by normalized name; NIH (funding-ranked) wins on collision.
  const byKey = new Map()
  for (const r of [...nihRows, ...academicRows]) {
    const k = normLabName(r.name)
    if (k && !byKey.has(k)) byKey.set(k, r)
  }
  // Classify every row so facet columns are populated on insert.
  const rows = [...byKey.values()].map(r => ({ ...r, ...classify(r, 'organizations') }))
  console.log(`Total ${rows.length} labs after dedup (${rows.filter(r => r.in_scope).length} classified in-scope)`)

  await sb.from('organizations').delete().eq('type', 'lab')
  let ok = 0
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('organizations').insert(rows.slice(i, i + 500))
    if (error) console.warn('lab insert error:', error.message)
    else ok += Math.min(500, rows.length - i)
  }
  console.log(`✓ Labs backfill complete — ${ok.toLocaleString()} labs`)
}

run().catch(e => { console.error(e); process.exit(1) })
