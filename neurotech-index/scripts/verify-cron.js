/**
 * verify-cron.js — did the nightly refresh do its job without destroying anything?
 *
 *   node --env-file=.env scripts/verify-cron.js
 *
 * Exists because of 29 July 2026, when the cron deleted every company row and
 * re-inserted it, taking 205 funding totals, 667 rounds, 90 stages, 63 inclusion
 * decisions and every status with it (docs/funding-data-loss-2026-07-29.md).
 * Nothing noticed. The data was simply gone the next time somebody looked.
 *
 * The failure was silent because every individual pipeline reported success:
 * the companies backfill really did write 1,084 rows. What nobody checked was
 * whether the rows another pipeline owned had survived. So this checks exactly
 * that, and it checks the shape of the table rather than the exit code of a job.
 *
 * Floors, not exact counts. Real ingestion moves these numbers up and down by a
 * few every night, and a check that cries wolf at +1 company gets ignored, which
 * is the state that let the original loss run undetected. A floor only trips on
 * the kind of collapse that means something broke.
 *
 * Exits non-zero on any failure, so it can gate a workflow or a git hook.
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
  process.exit(2)
}
const sb = createClient(url, key)

/**
 * Baselines taken 29 Jul 2026, after the restore and the stray-row cleanup.
 * Each floor sits meaningfully below its baseline: enough headroom for ordinary
 * churn, not enough to hide a wipe. Raise them when the real numbers grow.
 */
const CHECKS = [
  { label: 'companies',            floor: 1000, baseline: 1084, q: t => t.eq('type', 'company') },
  { label: 'labs',                 floor: 2200, baseline: 2426, q: t => t.eq('type', 'lab') },
  { label: 'sourced totals',       floor: 180,  baseline: 205,  q: t => t.not('total_raised_usd', 'is', null) },
  { label: 'inclusion decisions',  floor: 190,  baseline: 210,  q: t => t.not('inclusion_decision', 'is', null) },
  { label: 'inclusion bases',      floor: 100,  baseline: 113,  q: t => t.not('inclusion_basis', 'is', null) },
  { label: 'verified stages',      floor: 80,   baseline: 90,   q: t => t.not('furthest_stage', 'is', null) },
  { label: 'researched statuses',  floor: 15,   baseline: 20,   q: t => t.not('status', 'is', null) },
  { label: 'checked-at stamps',    floor: 1000, baseline: 1084, q: t => t.not('funding_checked_at', 'is', null) },
]

const fail = []
const warn = []

async function count(q) {
  const { count: n, error } = await q
  if (error) throw new Error(error.message)
  return n
}

async function run() {
  console.log('NeuroBase post-cron integrity check\n')

  for (const c of CHECKS) {
    const n = await count(c.q(sb.from('organizations').select('id', { count: 'exact', head: true })))
    const ok = n >= c.floor
    const drift = n - c.baseline
    console.log(`  ${ok ? '✓' : '✗'} ${c.label.padEnd(22)} ${String(n).padStart(5)}` +
      `   floor ${String(c.floor).padStart(5)}   ${drift >= 0 ? '+' : ''}${drift} vs baseline`)
    if (!ok) fail.push(`${c.label}: ${n}, below the floor of ${c.floor}`)
  }

  const rounds = await count(sb.from('funding_rounds').select('id', { count: 'exact', head: true }))
  const roundsOk = rounds >= 600
  console.log(`  ${roundsOk ? '✓' : '✗'} ${'funding rounds'.padEnd(22)} ${String(rounds).padStart(5)}` +
    `   floor ${String(600).padStart(5)}   ${rounds - 667 >= 0 ? '+' : ''}${rounds - 667} vs baseline`)
  if (!roundsOk) fail.push(`funding_rounds: ${rounds}, below the floor of 600`)

  // Only two types are real. Anything else is an older ingest leaking rows that
  // no query filters for and no prune removes; twelve of them accumulated
  // unnoticed before 29 Jul.
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('organizations').select('type').range(from, from + 999)
    if (error) throw new Error(error.message)
    all.push(...data)
    if (data.length < 1000) break
  }
  const stray = all.filter(r => r.type !== 'company' && r.type !== 'lab')
  console.log(`  ${stray.length ? '✗' : '✓'} ${'stray-typed rows'.padEnd(22)} ${String(stray.length).padStart(5)}   expected     0`)
  if (stray.length) fail.push(`${stray.length} rows carry a type that nothing queries`)

  // Lab ids must be stable, or every /lab/:id URL breaks overnight. This id is
  // uuidv5 of the normalised name, so it is the same forever or the scheme
  // regressed to a random default.
  const { data: allen } = await sb.from('organizations')
    .select('id').eq('name', 'Allen Institute for Brain Science').eq('type', 'lab').maybeSingle()
  const STABLE = '4dcf29b1-bdd9-5a8d-866d-fda7af05d1ca'
  const idOk = allen?.id === STABLE
  console.log(`  ${idOk ? '✓' : '✗'} ${'lab id stability'.padEnd(22)} ${idOk ? 'unchanged' : (allen?.id || 'row missing')}`)
  if (!idOk) fail.push('a known lab id changed, so /lab/:id links have broken')

  // The feed had no floor at all until 10 Aug 2026, which is the whole reason a
  // blanket 7-day delete could hold news at thirty rows for weeks without anyone
  // noticing: every job reported success, and nothing here looked at the table
  // they were writing to. This is the same lesson as the funding loss, applied to
  // the other half of the database — check the shape of what should be there, not
  // the exit code of the job that put it there.
  //
  // The floors are deliberately far below the post-expansion baselines. News
  // legitimately swings with what the world published that week; only a collapse
  // should trip this.
  for (const t of [
    // News is never pruned, so this floor only ever moves UP. A fall means
    // something deleted rows it does not own — which is the exact failure this
    // whole file exists to catch.
    { label: 'news items', type: 'news', floor: 250 },
    { label: 'feed research', type: 'paper', floor: 40 },
    { label: 'trials', type: 'trial', floor: 6000 },
  ]) {
    const n = await count(sb.from('news_feed').select('id', { count: 'exact', head: true }).eq('entry_type', t.type))
    const ok = n >= t.floor
    console.log(`  ${ok ? '✓' : '✗'} ${t.label.padEnd(22)} ${String(n).padStart(5)}   floor ${String(t.floor).padStart(5)}`)
    if (!ok) fail.push(`${t.label}: ${n}, below the floor of ${t.floor}`)
  }

  // A feed that stopped ingesting looks identical to a healthy one by row count
  // alone for as long as retention holds the old rows. Freshness is what tells
  // the two apart.
  const { data: newest } = await sb.from('news_feed')
    .select('first_seen').eq('entry_type', 'news')
    .order('first_seen', { ascending: false }).limit(1)
  const seen = newest?.[0]?.first_seen
  if (seen) {
    const days = Math.floor((Date.now() - new Date(seen)) / 864e5)
    const freshOk = days <= 2
    console.log(`  ${freshOk ? '✓' : '✗'} ${'newest news item'.padEnd(22)} ${String(days).padStart(5)}d   max        2d`)
    if (!freshOk) fail.push(`no news item ingested in ${days} days; the media pipeline is not running`)
  } else fail.push('no news items carry a first_seen stamp')

  const { data: bad, error: vErr } = await sb.from('funding_validation_failures').select('rule')
  if (vErr) warn.push(`validation view unreadable: ${vErr.message}`)
  else {
    console.log(`  ${bad.length ? '✗' : '✓'} ${'validation failures'.padEnd(22)} ${String(bad.length).padStart(5)}   expected     0`)
    if (bad.length) fail.push(`${bad.length} funding validation failures`)
  }

  // How recently the sweep actually touched anything. Not a pass/fail: with a
  // 21-day freshness window most nights legitimately check nobody.
  const { data: fresh } = await sb.from('organizations')
    .select('funding_checked_at').eq('type', 'company')
    .not('funding_checked_at', 'is', null)
    .order('funding_checked_at', { ascending: false }).limit(1)
  const last = fresh?.[0]?.funding_checked_at
  if (last) {
    const days = Math.floor((Date.now() - new Date(last)) / 864e5)
    console.log(`\n  most recent EDGAR check: ${new Date(last).toISOString().slice(0, 16).replace('T', ' ')}Z (${days}d ago)`)
    if (days > 25) warn.push(`no company checked against EDGAR in ${days} days; the sweep may be failing`)
  }

  for (const w of warn) console.log(`\n  ! ${w}`)

  if (fail.length) {
    console.error(`\n✗ ${fail.length} check(s) failed:`)
    for (const f of fail) console.error(`    ${f}`)
    console.error('\nIf counts collapsed, suspect a pipeline that deletes rows it does not own.')
    console.error('See docs/funding-data-loss-2026-07-29.md.')
    process.exit(1)
  }
  console.log('\nAll checks passed. The nightly run did not destroy anything.')
}

run().catch(e => { console.error(e.message); process.exit(2) })
