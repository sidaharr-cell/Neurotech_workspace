/**
 * verify-funding.js — the funding work queue.
 *
 *   node --env-file=.env scripts/verify-funding.js            # what needs checking
 *   node --env-file=.env scripts/verify-funding.js --all      # include clean records
 *   node --env-file=.env scripts/verify-funding.js --limit 40
 *
 * Lists records whose funding facts are stale or were never verified, biggest
 * raiser first, because a wrong figure on the most visible company does the most
 * damage. "Stale" is older than 90 days; "never verified" is any confidence
 * still reading `unverified`, which is the default every record starts at.
 *
 * It also reports the switch condition for the default sort. `trailing_24mo` is
 * the better default but it cannot be switched on until the rounds table holds
 * real history: at least a three-year span for 80 percent of funded records.
 * Reporting it here means the condition checks itself instead of being
 * remembered by whoever read the spec.
 */
import { createClient } from '@supabase/supabase-js'
import { needsVerification, trailingSortReadiness, STALE_DAYS, TRAILING_SORT_MIN_SPAN_YEARS } from './lib/funding.js'

const arg = name => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : null
}
const ALL = process.argv.includes('--all')
const LIMIT = Number(arg('--limit')) || 30

const usd = n => (n == null ? '—' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${Math.round(n / 1e6)}M`)
const day = t => (t ? String(t).slice(0, 10) : 'never')

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const now = new Date().toISOString()

  const orgs = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('organizations')
      .select('id,name,status,total_raised_usd,total_raised_confidence,latest_raise_usd,' +
        'latest_raise_confidence,latest_raise_unavailable_reason,inclusion_basis,modality,' +
        'furthest_stage,last_verified_at')
      .eq('type', 'company').range(from, from + 999)
    if (error) { console.error('read failed:', error.message); process.exit(1) }
    orgs.push(...data)
    if (data.length < 1000) break
  }

  const rounds = {}
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('funding_rounds')
      .select('organization_id,round_date').range(from, from + 999)
    if (error) { console.error('read rounds failed:', error.message); process.exit(1) }
    for (const r of data) (rounds[r.organization_id] ||= []).push({ date: r.round_date })
    if (data.length < 1000) break
  }

  const funded = orgs.filter(o => o.total_raised_usd != null)
  const queue = (ALL ? orgs : orgs.filter(o => needsVerification(o, now)))
    .sort((a, b) => (b.total_raised_usd || 0) - (a.total_raised_usd || 0))

  console.log(`Funding verification queue — ${queue.length} record(s) need attention ` +
    `of ${orgs.length} companies. Stale is older than ${STALE_DAYS} days.\n`)

  const head = ['#', 'Company', 'Total', 'Latest', 'Status', 'Verified', 'Missing'].join('\t')
  console.log(head)
  console.log('-'.repeat(head.length + 40))

  queue.slice(0, LIMIT).forEach((o, i) => {
    const missing = []
    if (!o.inclusion_basis) missing.push('basis')
    if (!o.status) missing.push('status')
    if (!o.modality) missing.push('modality')
    if (!o.furthest_stage) missing.push('stage')
    if (o.total_raised_confidence === 'unverified') missing.push('total')
    if (o.latest_raise_confidence === 'unverified' && o.latest_raise_usd != null) missing.push('latest')
    console.log([
      i + 1,
      o.name.slice(0, 32),
      usd(o.total_raised_usd),
      o.latest_raise_usd != null ? usd(o.latest_raise_usd) : (o.latest_raise_unavailable_reason || '—'),
      o.status || 'unknown',
      day(o.last_verified_at),
      missing.join(',') || 'nothing',
    ].join('\t'))
  })
  if (queue.length > LIMIT) console.log(`... and ${queue.length - LIMIT} more`)

  // ── The default-sort switch condition ─────────────────────────────────────
  const fundedRounds = Object.fromEntries(funded.map(o => [o.id, rounds[o.id] || []]))
  const readiness = trailingSortReadiness(fundedRounds)

  console.log('\n─── default sort: trailing_24mo switch condition ───')
  console.log(`funded records:                 ${readiness.total}`)
  console.log(`with >= ${TRAILING_SORT_MIN_SPAN_YEARS} years of round history:  ${readiness.qualifying}` +
    ` (${Math.round(readiness.share * 100)}%)`)
  console.log(`threshold:                      80%`)
  console.log(readiness.ready
    ? 'READY. Switch DEFAULT_SORT to trailing_24mo.'
    : 'NOT READY. DEFAULT_SORT stays total_raised.')

  // ── Coverage of the reasons an amount is absent ───────────────────────────
  const reasons = {}
  for (const o of orgs) {
    if (o.latest_raise_usd == null) {
      const r = o.latest_raise_unavailable_reason || 'null'
      reasons[r] = (reasons[r] || 0) + 1
    }
  }
  console.log('\n─── why a latest raise is absent ───')
  for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${r.padEnd(28)} ${n}`)
  }
}

run().catch(e => { console.error(e); process.exit(1) })
