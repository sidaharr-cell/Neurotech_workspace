/**
 * apply-duplicate-removals.js — leave one row per company.
 *
 *   node --env-file=.env scripts/apply-duplicate-removals.js            # dry run
 *   node --env-file=.env scripts/apply-duplicate-removals.js --commit
 *
 * Run scripts/audit-duplicate-orgs.js first: it FINDS the pairs, and it copies
 * any field the keeper is missing off the duplicate (`--merge`), so nothing
 * researched is stranded on the row that is about to be hidden. This script
 * only carries out the decision, and like apply-scope-removals.js it hides
 * rather than deletes — `funding_rounds` cascades on delete and /company/:id is
 * a permanent URL.
 *
 * The decisions are written out here rather than derived, because two of the
 * seven pairs the audit reported could not be settled by counting fields.
 *
 * NOT A DUPLICATE, and deliberately left alone: "Boston Scientific" against
 * "Boston Scientific Neuromodulation Corporation". The audit grouped them on a
 * shared brand and a shared bostonscientific.com domain, which is what a
 * SUBSIDIARY hosted on its parent's site looks like. They are different
 * entities in different places with different founding years — Marlborough and
 * 1984 for the parent, Valencia and 1993 for the neuromodulation business,
 * whose 1993 is Advanced Bionics' founding. Collapsing them would re-lose a
 * distinction that took a round of research to establish.
 */
import { createClient } from '@supabase/supabase-js'

const COMMIT = process.argv.includes('--commit')

/** keep → the row that stays; drop → the row hidden as a duplicate of it. */
const PAIRS = [
  { keep: 'Precision Neuroscience', drop: 'PrecisionNeuroscience',
    why: 'Punctuation variant of one name. The keeper holds 16 fields to the duplicate\'s 4, and this pair is what has been blocking apply-search-findings.js, which refuses any finding matching two rows.' },
  { keep: 'Cerebrotech Medical Systems', drop: 'Cerebro Medical Systems',
    why: 'One company in Pleasanton entered twice; the keeper holds 18 fields to 10.' },
  { keep: 'Eodyne Systems', drop: 'Eodyne',
    why: 'Proven mechanically: eodyne.com issues a 302 redirect to eodynesystems.com. Eodyne Systems S.L. of Barcelona is the legal name, so the fuller row keeps the name.' },
  { keep: 'Movement Disorders Diagnostic Technologies (MDDT)', drop: 'MDDT inc',
    why: 'THE AUDIT\'S KEEPER IS OVERRIDDEN HERE. Both rows hold 10 fields, so the tie fell to rank_score and picked the abbreviation. Same domain (mddtinc.ca), same London Ontario location, same description — and the expanded name is the one that tells a reader what the company does.' },
  { keep: 'Incereb', drop: 'Eegapps Medical',
    why: 'One Tallaght company under two top-level domains, incereb.com and incereb.ie. Keeper holds 10 fields to 4.' },
  { keep: 'Braincare', drop: 'Braincare Health Tecnology',
    why: 'One Sao Carlos company at brain4.care and braincare.com.br. Names, domains and brands all differ, which is why only the same-place signal caught it. Keeper holds 10 fields to 9; the dropped name also carries a typo ("Tecnology").' },
]

async function run() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const { data: orgs, error } = await sb.from('organizations')
    .select('id,name,in_scope,total_raised_usd,founded_year')
    .in('name', PAIRS.flatMap(p => [p.keep, p.drop]))
  if (error) { console.error('read failed:', error.message); process.exit(1) }
  const byName = new Map(orgs.map(o => [o.name, o]))

  const writes = []
  for (const p of PAIRS) {
    const keep = byName.get(p.keep), drop = byName.get(p.drop)
    if (!keep || !drop) { console.error(`  ! missing row for ${p.keep} / ${p.drop}`); process.exitCode = 1; continue }
    // Refuse to hide a row holding money the keeper does not have. The audit's
    // --merge should have moved it; if it did not, stop rather than lose it.
    if (drop.total_raised_usd && !keep.total_raised_usd) {
      console.error(`  ! ${p.drop} carries a funding total the keeper lacks — run audit-duplicate-orgs.js --merge first`)
      process.exitCode = 1
      continue
    }
    console.log(`keep  ${p.keep}  (founded ${keep.founded_year ?? '—'})`)
    console.log(`drop  ${p.drop}   ${drop.in_scope === false ? '(already hidden)' : ''}`)
    console.log(`      ${p.why}\n`)
    if (drop.in_scope !== false) writes.push({ id: drop.id, name: p.drop })
  }

  console.log(`${writes.length} duplicate rows to hide`)
  if (!COMMIT) { console.log('Dry run. Re-run with --commit.'); return }

  let done = 0
  for (const w of writes) {
    const { error: e } = await sb.from('organizations')
      .update({ in_scope: false, inclusion_decision: 'exclude', inclusion_basis: null })
      .eq('id', w.id)
    if (e) console.error(`  ! ${w.name}: ${e.message}`)
    else done++
  }
  console.log(`Hid ${done} of ${writes.length}. No rows were deleted.`)
}

run().catch(e => { console.error(e); process.exit(1) })
