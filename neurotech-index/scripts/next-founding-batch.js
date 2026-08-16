/**
 * next-founding-batch.js — the next companies to search for a founding year.
 *
 *   node --env-file=.env scripts/next-founding-batch.js [n]
 *
 * Picks companies with no age_year, highest rank_score first, skipping any name
 * already recorded in scripts/data/founding-findings.json or
 * founding-unresolved.json. A name in the unresolved file has been looked at and
 * the honest answer was not a year — searching it again would burn a turn to
 * reach the same place.
 *
 * Prints one company per line as `name | website | location` so a search agent
 * can be briefed without a second read. Website and location are what
 * disambiguate a generic name: "Neuros" alone finds nothing.
 *
 * .order('id') after .order('rank_score') is not decoration. Paginating on
 * rank_score alone once served 23 rows twice and skipped 23 entirely, which is
 * where a phantom "nine duplicates" finding came from.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { core } from './lib/funding.js'

const N = Number(process.argv[2]) || 15
const seen = new Set()
for (const f of ['founding-findings.json', 'founding-unresolved.json']) {
  const rows = JSON.parse(readFileSync(`scripts/data/${f}`, 'utf8'))
  for (const r of rows) if (r.name) seen.add(core(r.name))
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const out = []
for (let from = 0; out.length < N; from += 200) {
  const { data, error } = await sb.from('organizations')
    .select('id,name,website,location,description,age_year,rank_score')
    .eq('type', 'company').is('age_year', null)
    .order('rank_score', { ascending: false }).order('id')
    .range(from, from + 199)
  if (error) { console.error('read failed:', error.message); process.exit(1) }
  for (const r of data) {
    if (seen.has(core(r.name))) continue
    out.push(r)
    if (out.length >= N) break
  }
  if (data.length < 200) break
}

for (const r of out) {
  console.log(`${r.name} | ${r.website || 'no site'} | ${r.location || 'no location'}`)
}
console.error(`\n${out.length} companies; ${seen.size} names already recorded.`)
