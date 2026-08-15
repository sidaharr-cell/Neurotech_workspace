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
  //
  // This is the one full scan of the table, so it also carries funding_checked_at
  // for the EDGAR sweep block at the bottom, which needs the whole distribution
  // rather than one ordered row.
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('organizations')
      .select('type, funding_checked_at').range(from, from + 999)
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

  // Whether the EDGAR sweep is keeping up. Read the OLDEST stamp for that, not
  // the newest.
  //
  // The newest was the only thing checked here until 15 Aug 2026, and it is a
  // metric that cannot fail: it resets to 0d the moment ONE company is checked.
  // A sweep degraded to a handful a night while the rest of the table rotted at
  // sixty days would print "0d ago" and pass — the same shape as the two failures
  // this file already exists for, a job reporting success over data nobody looked
  // at. The back of the queue is what says the sweep is covering the population.
  //
  // Still not pass/fail. backfill-funding.js re-checks a company once it passes
  // STALE_DAYS = 21, oldest first, MAX_PER_RUN = 300 a night, so with ~1,084
  // companies a full cycle legitimately takes four nights and the last of them is
  // read at 21 + 3 = 24 days. The threshold sits above that with room for a couple
  // of failed nights: it should trip on a sweep that is not keeping up, not on one
  // that is halfway through a catch-up.
  const OLDEST_MAX_DAYS = 30
  const STALE_DAYS = 21

  const stamps = all.filter(r => r.type === 'company').map(r => r.funding_checked_at)
  const dated = stamps.filter(Boolean).sort()
  const ageDays = t => Math.floor((Date.now() - new Date(t)) / 864e5)
  const fmt = t => `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')}Z`

  if (dated.length) {
    const newestAge = ageDays(dated[dated.length - 1])
    const oldestAge = ageDays(dated[0])
    // Never-checked rows are the worst case of "behind", so they count as backlog.
    const backlog = stamps.filter(t => !t || ageDays(t) >= STALE_DAYS).length
    const oldestOk = oldestAge <= OLDEST_MAX_DAYS

    console.log(`\n  most recent EDGAR check: ${fmt(dated[dated.length - 1])} (${newestAge}d ago)`)
    console.log(`  ${oldestOk ? '✓' : '!'} oldest EDGAR check:    ${fmt(dated[0])} (${oldestAge}d ago, max ${OLDEST_MAX_DAYS}d)`)
    console.log(`    ${backlog} of ${stamps.length} companies are due a re-check (>=${STALE_DAYS}d)`)

    if (!oldestOk) {
      warn.push(`a company has gone ${oldestAge} days without an EDGAR check and ${backlog} are due; ` +
        'the sweep is not keeping up with the population')
    }
  } else warn.push('no company carries a funding_checked_at stamp; the EDGAR sweep has never run')

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
