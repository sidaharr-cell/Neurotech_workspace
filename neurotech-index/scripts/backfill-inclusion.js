/**
 * backfill-inclusion.js — apply the inclusion decisions and modality values in
 * scripts/data/inclusion-basis.json.
 *
 *   node --env-file=.env scripts/backfill-inclusion.js            # dry run
 *   node --env-file=.env scripts/backfill-inclusion.js --commit
 *
 * inclusion_basis is what lets a record appear on the funding chart. A company
 * with no basis is not charted, which is how the excluded entries in that file
 * stay off it: they are marked with a reason and given no basis, rather than
 * deleted. Deleting them would lose the fact that they were considered.
 *
 * The file is a decision record, not a data source. It is small, hand-written,
 * reviewed in a diff, and every entry cites which record in this database
 * supports it. Re-running is idempotent.
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const COMMIT = process.argv.includes('--commit')
const PIPELINE = 'inclusion-phase2'
const MAX_BASIS = 200

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  // Migration 010 adds inclusion_decision, which is what lets the database tell
  // "nobody has looked at this" from "we looked and the answer was no". Probe
  // for it so this script works either side of the migration.
  const probe = await sb.from('organizations').select('inclusion_decision').limit(1)
  const hasDecision = !probe.error
  if (!hasDecision) {
    console.log('· migration 010 not applied; recording the basis only, not the decision.\n')
  }

  const file = JSON.parse(readFileSync(join(__dirname, 'data/inclusion-basis.json'), 'utf8'))
  const entries = Object.entries(file).filter(([k]) => !k.startsWith('_'))

  const tooLong = entries.filter(([, v]) => (v.basis || '').length > MAX_BASIS)
  if (tooLong.length) {
    console.error(`${tooLong.length} basis string(s) exceed ${MAX_BASIS} characters:`)
    for (const [n, v] of tooLong) console.error(`  ${n} (${v.basis.length})`)
    process.exit(1)
  }

  const names = entries.map(([n]) => n)
  const { data: orgs, error } = await sb.from('organizations')
    .select('id,name,inclusion_basis,modality' + (hasDecision ? ',inclusion_decision' : '')).eq('type', 'company').in('name', names)
  if (error) { console.error('read failed:', error.message); process.exit(1) }
  const byName = Object.fromEntries(orgs.map(o => [o.name, o]))

  const updates = []
  const missing = []
  let included = 0, excluded = 0, revoked = 0
  for (const [name, d] of entries) {
    const org = byName[name]
    if (!org) { missing.push(name); continue }
    if (d.decision === 'exclude') {
      excluded++
      // A decision can be reversed. If this company was included before, it
      // carries a basis in the database, and that basis is exactly what lets it
      // onto the chart. Withdrawing the decision has to withdraw the basis too,
      // or the reversal changes this file and nothing else.
      if (org.inclusion_basis) {
        updates.push({
          id: org.id, name: org.name,
          inclusion_basis: null,
          modality: null,
          modality_secondary: null,
          ...(hasDecision ? { inclusion_decision: 'exclude' } : {}),
          pipeline_version: PIPELINE,
        })
        revoked++
        console.log(`  ↩ ${name}: was included, now excluded — clearing its basis. ${d.reason}`)
      } else if (hasDecision && org.inclusion_decision !== 'exclude') {
        // No basis to clear, but the ruling itself is worth storing: it is what
        // stops the validation view flagging a deliberate exclusion as an
        // undecided record.
        updates.push({
          id: org.id, name: org.name,
          inclusion_decision: 'exclude',
          pipeline_version: PIPELINE,
        })
        console.log(`  ✗ ${name}: ${d.reason}`)
      } else {
        console.log(`  ✗ ${name}: ${d.reason}`)
      }
      continue
    }
    included++
    updates.push({
      id: org.id, name: org.name,
      inclusion_basis: d.basis,
      modality: d.modality || null,
      modality_secondary: d.modality_secondary || null,
      ...(hasDecision ? { inclusion_decision: 'include' } : {}),
      pipeline_version: PIPELINE,
    })
    console.log(`  ✓ ${name} [${d.modality}] ${d.basis}`)
  }

  console.log(`\n${included} included, ${excluded} excluded, ${entries.length} decided.` +
    (revoked ? ` ${revoked} previously-included record(s) had a basis withdrawn.` : ''))
  if (missing.length) {
    console.log(`\n${missing.length} name(s) in the file with no matching company row:`)
    for (const n of missing) console.log(`  ? ${n}`)
  }

  if (!COMMIT) {
    console.log('\nDry run. Nothing written. Re-run with --commit to apply.')
    return
  }
  for (let i = 0; i < updates.length; i += 100) {
    const { error: e } = await sb.from('organizations').upsert(updates.slice(i, i + 100), { onConflict: 'id' })
    if (e) { console.error('upsert failed:', e.message); process.exit(1) }
  }
  console.log(`✓ wrote ${updates.length} inclusion decision(s).`)
}

run().catch(e => { console.error(e); process.exit(1) })
