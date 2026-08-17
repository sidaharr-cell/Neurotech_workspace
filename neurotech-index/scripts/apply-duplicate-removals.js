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

  // ── Pairs no signal in audit-duplicate-orgs.js can reach ──────────────────
  // Both of these share no name, no domain, no brand and no location with their
  // keeper, which is the alias-list gap that script's header calls out. They are
  // here because a person read the companies' histories.
  { keep: 'Neurovalens', drop: 'ModiusHealth',
    why: 'ONE COMPANY. Both rows resolve to NEUROVALENS LIMITED, Northern Ireland company number NI617853, incorporated 12 April 2013 — the ModiusHealth row was verified against that exact number in an earlier round. Modius is the PRODUCT LINE (Modius Sleep, FDA 510(k) October 2023; Modius Stress), not a separate business. Neurovalens is the keeper: it is the company name, it carries the correct Belfast location against ModiusHealth\'s wrong "San Diego, USA", it points at the company site rather than a product page, and it holds 11 relationship edges and a cleared_510k stage to ModiusHealth\'s none. The founding year travels the other way, since only ModiusHealth had one.' },
  { keep: 'Onward Medical', drop: 'G-therapeutics',
    why: 'The first name of one company. G-Therapeutics SA of Lausanne became GTX Medical and then ONWARD Medical of Eindhoven. The dropped row holds nothing — no year, no funding, no relationships, no stage — so this is a pure name-history collapse.' },
  { keep: 'Onward Medical', drop: 'NeuroRecovery Technologies',
    why: 'Merged into GTX Medical on 22 October 2019, and the merged entity is ONWARD Medical. Reggie Edgerton\'s UCLA spinal-stimulation patents assigned to NRT went with it. FUNDING DELIBERATELY NOT TRANSFERRED — see fundingStaysBehind.',
    // The guard below refuses to hide a row holding money the keeper lacks,
    // because that is how researched funding gets stranded silently. Here it is
    // overridden ON PURPOSE and the reason is recorded rather than suppressed:
    // NRT's $3.04M and its one funding_rounds row are ITS OWN raise, sourced to
    // its own filing. Onward Medical is Euronext-listed and has raised far more;
    // moving $3.04M onto it would not fill a gap, it would assert a total that is
    // wrong by an order of magnitude and attach NRT's source URL to it. The row
    // is hidden, not deleted, so the round keeps its organization_id and nothing
    // is lost — but Onward's own funding is now a known blank worth researching.
    fundingStaysBehind: true, mergedIn: true },
]

/** Field groups worth carrying from a hidden row onto its keeper. Provenance
 *  travels with its value: a year without its source would be a bare claim. */
const CARRY = [
  ['founded_year', 'founded_source_kind', 'founded_source_url', 'founded_evidence',
    'founded_retrieved_at', 'founded_conflict'],
  ['incorporated_year', 'incorporated_before_year', 'incorporated_source_url',
    'incorporated_retrieved_at'],
  ['website'], ['location'], ['description'], ['status'], ['modality'],
  ['furthest_stage', 'stage_evidence_type', 'stage_evidence_id'],
]

async function run() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const { data: orgs, error } = await sb.from('organizations').select('*')
    .in('name', PAIRS.flatMap(p => [p.keep, p.drop]))
  if (error) { console.error('read failed:', error.message); process.exit(1) }
  const byName = new Map(orgs.map(o => [o.name, o]))
  const set = v => v != null && v !== ''

  const writes = []
  const patches = []
  for (const p of PAIRS) {
    // Re-read the keeper from the patch queue, so a second pair merging into the
    // same keeper sees what the first one already gave it.
    const keep = byName.get(p.keep), drop = byName.get(p.drop)
    if (!keep || !drop) { console.error(`  ! missing row for ${p.keep} / ${p.drop}`); process.exitCode = 1; continue }
    // Refuse to hide a row holding money the keeper does not have. That is how
    // researched funding gets stranded without anyone noticing. Overridable, but
    // only by an explicit flag carrying its reason — never by default.
    if (drop.total_raised_usd && !keep.total_raised_usd && !p.fundingStaysBehind) {
      console.error(`  ! ${p.drop} carries a funding total the keeper lacks — run audit-duplicate-orgs.js --merge first`)
      process.exitCode = 1
      continue
    }
    // Carry anything the keeper is missing, whole group at a time — but ONLY for
    // a rename. A renamed company's earlier dates are its own dates. A company
    // that MERGED IN is a different business whose history stops at the merger:
    // carrying NeuroRecovery Technologies' incorporation year onto Onward would
    // assert that Onward was incorporated when a company it later absorbed was.
    const patch = {}
    const carried = []
    for (const cols of (p.mergedIn ? [] : CARRY)) {
      if (cols.some(c => set(keep[c]))) continue
      if (!cols.some(c => set(drop[c]))) continue
      for (const c of cols) { patch[c] = drop[c]; keep[c] = drop[c] }
      carried.push(cols[0])
    }
    console.log(`keep  ${p.keep}  (founded ${keep.founded_year ?? '—'})`)
    console.log(`drop  ${p.drop}${drop.in_scope === false ? '  (already hidden)' : ''}`)
    if (carried.length) console.log(`carry ${carried.join(', ')}  ->  ${p.keep}`)
    if (p.fundingStaysBehind && drop.total_raised_usd) {
      console.log(`  ! $${(drop.total_raised_usd / 1e6).toFixed(2)}M stays on the hidden row by decision, not by accident`)
    }
    console.log(`      ${p.why}\n`)
    if (Object.keys(patch).length) patches.push({ id: keep.id, name: p.keep, patch, carried })
    if (drop.in_scope !== false) writes.push({ id: drop.id, name: p.drop })
  }

  console.log(`${patches.length} keepers gain a field; ${writes.length} duplicate rows to hide`)
  if (!COMMIT) { console.log('Dry run. Re-run with --commit.'); return }

  // Carry first, hide second. The other order would briefly leave a fact visible
  // on no row at all.
  let moved = 0
  for (const p of patches) {
    const { error: e } = await sb.from('organizations').update(p.patch).eq('id', p.id)
    if (e) console.error(`  ! ${p.name}: ${e.message}`)
    else moved++
  }
  let done = 0
  for (const w of writes) {
    const { error: e } = await sb.from('organizations')
      .update({ in_scope: false, inclusion_decision: 'exclude', inclusion_basis: null })
      .eq('id', w.id)
    if (e) console.error(`  ! ${w.name}: ${e.message}`)
    else done++
  }
  console.log(`Carried onto ${moved} keepers, hid ${done} of ${writes.length}. No rows were deleted.`)
}

run().catch(e => { console.error(e); process.exit(1) })
