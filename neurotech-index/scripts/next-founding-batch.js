/**
 * next-founding-batch.js — the next companies to search for a founding year.
 *
 *   node --env-file=.env scripts/next-founding-batch.js [n]
 *
 * Picks companies with no FOUNDED_YEAR, highest rank_score first, skipping any
 * name already recorded in scripts/data/founding-findings.json or
 * founding-unresolved.json. A name in the unresolved file has been looked at and
 * the honest answer was not a year — searching it again would burn a turn to
 * reach the same place.
 *
 * IT USED TO GATE ON age_year, AND THAT WAS A SILENT BLIND SPOT. age_year is a
 * generated coalesce of founded_year, incorporated_year and
 * incorporated_before_year (migration 022), so a company holding nothing but an
 * incorporation date already had a non-null age_year and was never offered for
 * search — not once in eleven rounds. The picker reported "0 companies" and the
 * sweep was declared complete while 107 companies still had no founding year at
 * all.
 *
 * The bias was not random, which is what makes it worth this much comment. An
 * incorporation year mostly arrives from an SEC Form D, so the companies hidden
 * by the old gate were disproportionately the FUNDED ones — 79 of the 108 on the
 * funding board, whose ages size the points in CapitalStageScatter. The most
 * visible figure on the site was the worst covered, and the gate is why.
 *
 * Incorporation is not founding: that rule is applied everywhere else in this
 * sweep, and the picker is now consistent with it.
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
    .select('id,name,website,location,description,age_year,incorporated_year,'
      + 'incorporated_before_year,rank_score,inclusion_decision')
    .eq('type', 'company').is('founded_year', null)
    .order('rank_score', { ascending: false }).order('id')
    .range(from, from + 199)
  if (error) { console.error('read failed:', error.message); process.exit(1) }
  for (const r of data) {
    if (seen.has(core(r.name))) continue
    // A company ruled out of the index is not worth a search turn.
    if (r.inclusion_decision === 'exclude') continue
    out.push(r)
    if (out.length >= N) break
  }
  if (data.length < 200) break
}

for (const r of out) {
  // Surface any incorporation date the row already holds. It is not the answer,
  // but a searcher who does not know it exists cannot tell the useful case
  // ("founded 2011, incorporated 2013") from the trap ("aggregator says 2013
  // because that is the incorporation date"), and will report the trap.
  const inc = r.incorporated_year ? `incorporated ${r.incorporated_year}`
    : r.incorporated_before_year ? `incorporated by ${r.incorporated_before_year}`
      : 'no incorporation date'
  console.log(`${r.name} | ${r.website || 'no site'} | ${r.location || 'no location'} | ${inc}`)
}
console.error(`\n${out.length} companies; ${seen.size} names already recorded.`)
