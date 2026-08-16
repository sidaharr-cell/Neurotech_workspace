/**
 * audit-scope.js — which rows in the companies index may not be companies, or
 * may not be neurotech?
 *
 *   node --env-file=.env scripts/audit-scope.js
 *
 * Reports only. It never deletes and never writes: removing an index entry is a
 * judgement about the world, like asserting a funding figure, and belongs to a
 * person. The rules are in scripts/lib/scope.js and are tested there.
 *
 * Prompted by three live rows: Society for Neuroscience sorts as the
 * third-oldest "company" in the index, ApexNeuro is a six-person
 * neurorehabilitation clinic, and BrainCom at braincom.fr is a communications
 * agency that shares a name with an EU research project.
 *
 * Writes scratch/scope-audit.json so the flags can be worked through without
 * re-running anything.
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { scopeVerdict } from './lib/scope.js'

async function run() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const rows = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await sb.from('organizations')
      .select('id,name,description,website,rank_score,total_raised_usd,age_year')
      .eq('type', 'company').order('rank_score', { ascending: false }).range(from, from + 499)
    if (error) { console.error('read failed:', error.message); process.exit(1) }
    rows.push(...data)
    if (data.length < 500) break
  }

  const judged = rows.map(r => ({ ...r, ...scopeVerdict(r) }))
  const tally = {}
  for (const j of judged) tally[j.verdict] = (tally[j.verdict] || 0) + 1

  console.log(`companies in the index: ${rows.length}\n`)
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(10)} ${String(v).padStart(4)}  (${Math.round(100 * v / rows.length)}%)`)
  }

  const reasons = {}
  for (const j of judged) for (const f of j.flags) reasons[f] = (reasons[f] || 0) + 1
  console.log('\nreasons:')
  for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${k}`)
  }

  // The ones that matter most: flagged AND prominent enough to be seen.
  const prominent = judged
    .filter(j => j.verdict === 'review')
    .sort((a, b) => (b.total_raised_usd || 0) - (a.total_raised_usd || 0) || (b.rank_score || 0) - (a.rank_score || 0))
  console.log(`\nflagged for review, most prominent first:`)
  for (const j of prominent.slice(0, 20)) {
    console.log(`  ${j.name} — ${j.flags[0]}`)
  }

  try { mkdirSync('scratch', { recursive: true }) } catch { /* exists */ }
  writeFileSync('scratch/scope-audit.json', JSON.stringify(
    judged.filter(j => j.verdict !== 'in_scope')
      .map(({ id, name, website, verdict, flags, description }) =>
        ({ id, name, website, verdict, flags, description: String(description || '').slice(0, 200) })),
    null, 1))
  console.log(`\nfull report: scratch/scope-audit.json (nothing was changed)`)
}
run().catch(e => { console.error(e); process.exit(1) })
