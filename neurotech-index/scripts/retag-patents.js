/**
 * retag-patents.js — one-time: re-derive device-class tags for existing patents
 * from their CPC codes (plus title), so BigQuery rows (no abstract) get tagged.
 *   node --env-file=.env scripts/retag-patents.js
 */
import { createClient } from '@supabase/supabase-js'
import { patentTags } from './backfill-patents.js'

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const rows = []
for (let f = 0; ; f += 1000) {
  const { data, error } = await s.from('patents').select('id,title,cpc_codes,tags').order('id').range(f, f + 999)
  if (error) { console.error(error); process.exit(1) }
  rows.push(...data)
  if (data.length < 1000) break
}
console.log(`re-tagging ${rows.length} patents...`)

const jobs = rows.map(r => {
  const tags = patentTags(r.title, r.cpc_codes)
  const cur = JSON.stringify(r.tags || [])
  return JSON.stringify(tags) !== cur ? { id: r.id, tags } : null
}).filter(Boolean)

let done = 0
for (let i = 0; i < jobs.length; i += 40) {
  await Promise.all(jobs.slice(i, i + 40).map(async j => {
    const { error } = await s.from('patents').update({ tags: j.tags }).eq('id', j.id)
    if (!error) done++
  }))
  process.stdout.write(`\r  updated ${done}/${jobs.length}`)
}
console.log(`\n✓ re-tagged ${done} patents (of ${rows.length}).`)
