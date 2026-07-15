/**
 * backfill-labs.js — ingest neurotech research labs from NIH RePORTER (free)
 * into the `organizations` table as type='lab'. One-time / re-runnable.
 *   node --env-file=.env scripts/backfill-labs.js
 */
import { createClient } from '@supabase/supabase-js'
import { DEVICE_CLASSES } from '../src/lib/taxonomy.js'

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

async function fetchProjects(term, offset) {
  const res = await fetch('https://api.reporter.nih.gov/v2/projects/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      criteria: { advanced_text_search: { operator: 'and', search_field: 'projecttitle,terms,abstracttext', search_text: term } },
      limit: 200, offset,
      include_fields: ['ProjectTitle', 'PrincipalInvestigators', 'Organization', 'FiscalYear'],
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
        const lab = labs.get(key) || { pi, org, city: p.organization?.org_city, state: p.organization?.org_state, titles: [], years: [] }
        if (p.project_title) lab.titles.push(p.project_title)
        if (p.fiscal_year) lab.years.push(p.fiscal_year)
        labs.set(key, lab)
      }
      if (offset + 200 >= total) break
      await sleep(300)
    }
    await sleep(300)
  }

  const rows = [...labs.values()].map(l => {
    const loc = [titleCase(l.city), l.state].filter(Boolean).join(', ')
    const focus = l.titles[0] || 'Neurotechnology research'
    return {
      name: `${titleCase(l.pi)} Lab`,
      type: 'lab',
      location: loc,
      founded: l.years.length ? String(Math.min(...l.years)) : null,
      description: `${titleCase(l.org)} · ${l.titles.length} NIH-funded neurotech project${l.titles.length === 1 ? '' : 's'}. Focus: ${focus}.`,
      focus_areas: deriveTags(l.titles.join(' ')),
      website: null,
      founders: [titleCase(l.pi)],
    }
  })
  console.log(`Aggregated ${rows.length} unique labs from NIH RePORTER`)

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
