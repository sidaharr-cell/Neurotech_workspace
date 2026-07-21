/**
 * seed-patents.js — populate the patents table with a real neurotech sample
 * from Google Patents (reachable without a key). This is a BOUNDED seed for
 * immediate content and verification; backfill-patents.js (PatentsView, by CPC)
 * is the comprehensive source. Both upsert into the same `patents` table.
 *
 *   node --env-file=.env scripts/seed-patents.js [pagesPerTerm]
 */
import { createClient } from '@supabase/supabase-js'
import { DEVICE_CLASSES } from '../src/lib/taxonomy.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const PAGES = process.argv[2] ? Number(process.argv[2]) : 3

const TERMS = [
  'brain computer interface', 'neural implant', 'deep brain stimulation',
  'neurostimulation', 'neural interface', 'cochlear implant', 'neuroprosthesis',
  'spinal cord stimulation', 'vagus nerve stimulation', 'electroencephalography electrode',
  'transcranial magnetic stimulation', 'retinal implant', 'neural decoding',
  'closed-loop neurostimulation', 'intracortical electrode',
]

const stripTags = s => (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim()
const deriveTags = text => {
  const h = (text || '').toLowerCase()
  return DEVICE_CLASSES.filter(c => c.match.some(m => h.includes(m))).map(c => c.id)
}

async function fetchPage(term, page) {
  const inner = `q=${encodeURIComponent('"' + term + '"')}&type=PATENT&num=100&page=${page}`
  const url = `https://patents.google.com/xhr/query?url=${encodeURIComponent(inner)}&exp=`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh)' } })
    if (!res.ok) { console.warn(`  Google Patents ${res.status} for "${term}" p${page}`); return [] }
    const data = await res.json()
    return data?.results?.cluster?.[0]?.result || []
  } catch (e) { console.warn('  fetch error:', e.message); return [] }
}

function toRow(item) {
  const p = item.patent || {}
  const num = p.publication_number
  if (!num) return null
  const title = stripTags(p.title)
  return {
    patent_number: num,
    title: title || '(untitled)',
    abstract: stripTags(p.snippet) || null,
    assignee: p.assignee || null,
    grant_date: p.grant_date || p.publication_date || null,
    cpc_codes: [],
    tags: deriveTags(`${title} ${p.snippet}`),
    url: `https://patents.google.com/patent/${num}`,
    source: 'google-patents',
  }
}

const seen = new Set()
const rows = []
for (const term of TERMS) {
  let got = 0
  for (let pg = 0; pg < PAGES; pg++) {
    const results = await fetchPage(term, pg)
    if (!results.length) break
    for (const it of results) {
      const row = toRow(it)
      if (!row || seen.has(row.patent_number)) continue
      seen.add(row.patent_number); rows.push(row); got++
    }
    await sleep(600)
  }
  console.log(`  ${term}: +${got} (total ${rows.length})`)
}

console.log(`Upserting ${rows.length} unique patents...`)
for (let i = 0; i < rows.length; i += 500) {
  const { error } = await supabase.from('patents').upsert(rows.slice(i, i + 500), { onConflict: 'patent_number', ignoreDuplicates: false })
  if (error && !error.message.includes('duplicate')) console.warn('upsert error:', error.message)
}
console.log(`✓ Seeded ${rows.length} neurotech patents from Google Patents.`)
