/**
 * clean-dashes.js — one-time pass to remove em/en dashes from NeuroBase's own
 * text: AI-generated summaries and significance paragraphs (in the DB and
 * notable.json) and curated company/lab/researcher descriptions. External
 * source titles are left untouched. The scoring prompt already avoids dashes
 * going forward. Rules: "a — b" and "a – b" become "a, b"; a tight en dash
 * (brain–computer, 2006–present) becomes a hyphen.
 *
 *   node --env-file=.env scripts/clean-dashes.js
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const dir = dirname(fileURLToPath(import.meta.url))

function clean(t) {
  if (typeof t !== 'string' || !t) return t
  return t
    .replace(/ *— */g, ', ')  // em dash as punctuation → comma
    .replace(/ +– +/g, ', ')  // spaced en dash → comma
    .replace(/–/g, '-')       // tight en dash (compound/range) → hyphen
    .replace(/ +,/g, ',').replace(/,(?: *,)+/g, ',').replace(/ {2,}/g, ' ').trim()
}

// 1) DB: news_feed summary + metadata.significance (skip titles — source data)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const rows = []
for (let f = 0; ; f += 1000) {
  const { data, error } = await supabase.from('news_feed').select('id,summary,metadata').neq('entry_type', 'trial').order('id').range(f, f + 999)
  if (error) { console.error(error); process.exit(1) }
  rows.push(...data)
  if (data.length < 1000) break
}
let n = 0
for (const r of rows) {
  const summary = clean(r.summary)
  const significance = clean(r.metadata?.significance)
  if (summary !== r.summary || significance !== (r.metadata?.significance ?? significance)) {
    await supabase.from('news_feed').update({ summary, metadata: { ...r.metadata, significance } }).eq('id', r.id)
    n++
  }
}
console.log(`DB: cleaned ${n} feed rows (summary + significance)`)

// 2) notable.json: clean significance + journal only (titles are source data)
const npath = join(dir, '../src/data/notable.json')
const notable = JSON.parse(readFileSync(npath, 'utf8'))
notable.forEach(p => { p.significance = clean(p.significance); p.journal = clean(p.journal) })
writeFileSync(npath, JSON.stringify(notable, null, 2) + '\n')

// 3) Curated data files: clean prose fields only
const cpath = join(dir, '../src/data/companies.json')
const companies = JSON.parse(readFileSync(cpath, 'utf8'))
companies.forEach(c => { if (c.description) c.description = clean(c.description) })
writeFileSync(cpath, JSON.stringify(companies, null, 2) + '\n')

const rpath = join(dir, '../src/data/researchers.json')
const researchers = JSON.parse(readFileSync(rpath, 'utf8'))
researchers.forEach(x => {
  if (x.bio) x.bio = clean(x.bio)
  if (Array.isArray(x.notableWork)) x.notableWork = x.notableWork.map(clean)
  if (Array.isArray(x.expertise)) x.expertise = x.expertise.map(clean)
})
writeFileSync(rpath, JSON.stringify(researchers, null, 2) + '\n')

console.log('Files: cleaned notable.json, companies.json, researchers.json')
