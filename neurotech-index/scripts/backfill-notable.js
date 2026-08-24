/**
 * backfill-notable.js — refill the Notable research rail without a full refresh.
 *
 *   node --env-file=.env scripts/backfill-notable.js            # dry run
 *   node --env-file=.env scripts/backfill-notable.js --commit   # write the file
 *
 * Dry-run by default, like every other write script here.
 *
 * WHAT IT IS FOR. The rail is maintained by the nightly run, and it drained
 * anyway: 9 papers on 17 Aug 2026, 5 by the 23rd, on course for none by
 * mid-September, because a paper could not clear impactTrusted until day 60 and
 * nothing looked at it again after the week it was ingested. scripts/lib/notable.js
 * has the arithmetic. The fix is in refresh.js — a nightly sweep of the research
 * rows already in the feed — and this is the same rebuild, runnable on its own
 * when the rail is short and the next cron is a day away.
 *
 * IT SPENDS NOTHING ON A MODEL. `allowModel: false` skips the two steps of
 * syncNotable that score — the topic back-fill for pre-gate entries, and the
 * papers-table top-up — leaving the parts that need only OpenAlex (free) and
 * the percentile and topic judgement already stored on each row. So this can be
 * run any time without a bill, and the nightly run remains the only thing that
 * pays to look at something new.
 *
 * It shares syncNotable with refresh.js rather than restating the gates. A
 * second copy of "what belongs on the rail" is how the rail and the page came
 * to disagree before.
 */
import { syncNotable, NOTABLE_MAX, NOTABLE_PATH } from './refresh.js'
import { readFileSync, existsSync } from 'fs'

const COMMIT = process.argv.includes('--commit')

const before = existsSync(NOTABLE_PATH) ? JSON.parse(readFileSync(NOTABLE_PATH, 'utf8')) : []
console.log(`Notable rail: ${before.length} paper(s) now, ${NOTABLE_MAX} wanted\n`)

const rail = await syncNotable([], { allowModel: false, commit: COMMIT })

console.log()
const key = x => (x.doi || x.pmid || x.url || '').toLowerCase()
const had = new Set(before.map(key))
for (const r of rail) {
  const age = Math.round((Date.now() - new Date(r.publishedAt).getTime()) / 864e5)
  console.log(`  ${had.has(key(r)) ? ' ' : '+'} ${(r.pctile * 100).toFixed(0)}%  cited ${String(r.citedBy).padStart(3)}  ${age}d  ${r.title.slice(0, 60)}`)
}
const lost = before.filter(b => !rail.some(r => key(r) === key(b)))
for (const l of lost) console.log(`  - dropped: ${l.title.slice(0, 60)}`)

if (!COMMIT) console.log('\nDry run. Re-run with --commit to write src/data/notable.json.')
else if (rail.length < NOTABLE_MAX) console.log(`\nWrote ${rail.length}. Short of ${NOTABLE_MAX}: the nightly run's papers-table top-up is the deeper net.`)
