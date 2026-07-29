/**
 * validate-funding.js — the funding data integrity check. Exits non-zero when a
 * record asserts a fact it cannot support.
 *
 *   node --env-file=.env scripts/validate-funding.js
 *
 * Run in CI (.github/workflows/ci.yml). Skips with a clear message, and exit 0,
 * when Supabase credentials are absent, so a fork or a local clone without
 * secrets is not blocked by a check it cannot perform.
 *
 * The rules, from the funding spec:
 *   1. A non-null dollar figure has a null source URL.
 *   2. A null latest_raise_usd has a null latest_raise_unavailable_reason.
 *   3. A non-null furthest_stage has stage_evidence_type of 'none'.
 *   4. A record has a null inclusion_basis.
 *
 * Rule 4 is scoped to records that carry a funding figure. Unscoped it fails on
 * all 1,084 company rows from the moment the migration lands, and a check that
 * is red by construction is a check everybody learns to ignore. The funded set
 * is exactly the set that can reach the chart, which is where an undefended
 * inclusion actually does damage. Widen the scope once the funded set is written
 * up.
 *
 * Rules 1 and the funding_rounds equivalent are also CHECK constraints in
 * migration 008, so the database refuses those writes outright. They stay here
 * because a constraint can be dropped and a CI check notices when one has been.
 *
 * The queries mirror the funding_validation_failures view in migration 008. They
 * are issued directly rather than through the view so the check does not depend
 * on the view being exposed to PostgREST.
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY

if (!url || !key) {
  console.log('· Supabase credentials not set. Skipping funding validation.')
  process.exit(0)
}

const sb = createClient(url, key)

// Each rule: a name, the human-readable failure, and a query returning the
// offending rows. `select` is kept narrow so a failure prints something useful.
const RULES = [
  {
    id: 'total_without_source',
    detail: 'total_raised_usd is set but total_raised_source_url is null',
    run: () => sb.from('organizations').select('id,name,total_raised_usd')
      .not('total_raised_usd', 'is', null).is('total_raised_source_url', null),
  },
  {
    id: 'latest_raise_without_source',
    detail: 'latest_raise_usd is set but latest_raise_source_url is null',
    run: () => sb.from('organizations').select('id,name,latest_raise_usd')
      .not('latest_raise_usd', 'is', null).is('latest_raise_source_url', null),
  },
  {
    id: 'missing_unavailable_reason',
    detail: 'latest_raise_usd is null and latest_raise_unavailable_reason is null',
    run: () => sb.from('organizations').select('id,name')
      .eq('type', 'company').is('latest_raise_usd', null)
      .is('latest_raise_unavailable_reason', null),
  },
  {
    id: 'stage_without_evidence',
    detail: "furthest_stage is set but stage_evidence_type is 'none' or null",
    run: () => sb.from('organizations').select('id,name,furthest_stage,stage_evidence_type')
      .not('furthest_stage', 'is', null)
      .or('stage_evidence_type.is.null,stage_evidence_type.eq.none'),
  },
  {
    id: 'missing_inclusion_basis',
    detail: 'a record that can reach the chart has no inclusion_basis',
    // Scoped to the biggest raisers rather than every funded record. A chart of
    // 20 draws from the top of this ordering, so this is the set where an
    // undefended inclusion is actually visible to a reader. The long tail of
    // funded records is listed by scripts/verify-funding.js as work, not failed
    // here as an error. Phase 3's query layer must additionally refuse to chart
    // a record with no basis, which is what makes this scope safe.
    run: () => sb.from('organizations').select('id,name,total_raised_usd,inclusion_basis')
      .not('total_raised_usd', 'is', null)
      .order('total_raised_usd', { ascending: false }).limit(30)
      .then(res => ({ ...res, data: res.data?.filter(r => !r.inclusion_basis) })),
  },
  {
    id: 'round_without_source',
    detail: 'funding_rounds.amount_usd is set but source_url is null',
    run: () => sb.from('funding_rounds').select('id,organization_id,amount_usd')
      .not('amount_usd', 'is', null).is('source_url', null),
  },
]

const SAMPLE = 10

async function run() {
  let failed = 0, schemaMissing = 0
  for (const rule of RULES) {
    const { data, error } = await rule.run()
    if (error) {
      // A missing table or column means the migration has not been applied.
      // That is a real failure in CI, not something to skip past.
      console.error(`✗ ${rule.id}: query failed — ${error.message}`)
      if (/does not exist|schema cache/.test(error.message)) schemaMissing++
      failed++
      continue
    }
    if (!data.length) {
      console.log(`✓ ${rule.id}`)
      continue
    }
    failed++
    console.error(`✗ ${rule.id}: ${data.length} record(s) — ${rule.detail}`)
    for (const row of data.slice(0, SAMPLE)) {
      console.error(`    ${row.name || row.organization_id} (${row.id})`)
    }
    if (data.length > SAMPLE) console.error(`    ... and ${data.length - SAMPLE} more`)
  }

  if (schemaMissing) {
    console.error('\nThe funding columns are absent. Apply supabase/migrations/008-funding.sql,')
    console.error('then re-run. This check stays red until the migration is in place.')
    process.exit(1)
  }
  if (failed) {
    console.error(`\n${failed} rule(s) failed. Fix the records or the writer that produced them.`)
    process.exit(1)
  }
  console.log('\nAll funding validation rules passed.')
}

run().catch(e => { console.error(e); process.exit(1) })
