/**
 * verify-homepage.js — can every section of the home page fill its slots, and
 * does every story frame come out with a picture in it?
 *
 *   node --env-file-if-exists=.env scripts/verify-homepage.js
 *   node --env-file-if-exists=.env scripts/verify-homepage.js --strict   # exit 1 on any gap
 *
 * The page has a fixed budget of items split across eight sections (SLOTS in
 * src/lib/homepage.js). A section that cannot fill shrinks the page, silently:
 * nothing errors, nothing logs, the row is just short. That is how "Latest" and
 * "Notable research" came to run half empty without anyone being told.
 *
 * A frame with no picture fails the same silent way, and since 23 Aug 2026 it
 * is a normal outcome rather than a fault: a story card runs a photograph OF
 * the story or it runs the record's own data figure, and there is no longer a
 * pool of technology photographs to fall back on. So the number below is a
 * COVERAGE figure, not a pass mark. What it is really reporting is how well
 * the sourcing step is keeping up, and whether the reviewer's queue is moving.
 *
 * The two rules that are about time rather than about a render are checked
 * here too, because they are the two that fail invisibly:
 *
 *   no photograph beside two stories    checked across the whole ledger, not
 *                                       just this render
 *   the lead changed today              checked against yesterday's entry
 *
 * This asks the same questions the page asks, through the same functions, so
 * the answer cannot drift from what a reader sees:
 *
 *   - the four story slots come out of composeStories over the live feed
 *   - their pictures come out of assignImages and leadPicture, the same two
 *     calls MagazineFeed makes, in the same order over the same list
 *   - notable comes out of pickNotable, AFTER the dedup against the feed above,
 *     which is the step that turns a rail of three into a section of two
 *   - trials, clearances and funding are counted from their own queries
 *
 * The record rails are not asked about pictures on purpose: they carry a data
 * figure by design, and only the story frames are meant to hold a photograph.
 *
 * Run daily, after the image steps that source pictures for the new records. It
 * is a warning by default and the run's own exit code is verify-cron's to give;
 * --strict is for asking the question directly.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { getNewsFeed } from '../src/lib/data.js'
import { SLOTS, composeStories, shownKeys, pickNotable } from '../src/lib/homepage.js'
import { assignImages, leadPicture, usableImage, storyPicture, canLead } from '../src/lib/image.js'
import { ownerOf, lastLead, leadOn, keyOf, recentLeadIds, LEAD_MEMORY_DAYS } from '../src/lib/ledger.js'
import LEDGER from '../src/data/image-ledger.json'
import REVIEW from '../src/data/image-review.json'

const HERE = dirname(fileURLToPath(import.meta.url))
const STRICT = process.argv.includes('--strict')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const notable = JSON.parse(readFileSync(join(HERE, '../src/data/notable.json'), 'utf8'))

// The feed the page asks for — by CALLING what the page calls. This used to
// restate the query as `order by relevance_score limit 120`, which is not what
// getNewsFeed does: that takes a recency window, re-sorts it by the rankScore
// inside a jsonb blob, and appends the photograph-bearing stories below the
// cut. The restatement returned a different set of stories, so this check was
// answering for a page nobody sees.
const feed = await getNewsFeed({ limit: 120 })
if (!feed.length) { console.error('the feed came back empty — is VITE_SUPABASE_URL set?'); process.exit(1) }

const { lead, sidebar, featured, latest } = composeStories(feed || [], 'relevant')
const notablePapers = pickNotable(notable, shownKeys(lead, sidebar, featured, latest))

const { count: trials } = await sb.from('news_feed')
  .select('*', { count: 'exact', head: true }).eq('entry_type', 'trial')
const { data: clearances } = await sb.from('devices')
  .select('id').not('year', 'is', null).order('year', { ascending: false }).limit(SLOTS.clearances)
const { data: rounds } = await sb.from('funding_rounds')
  .select('id').order('round_date', { ascending: false, nullsFirst: false }).limit(SLOTS.funding)

const sections = [
  ['lead',       lead ? 1 : 0,                        SLOTS.lead],
  ['sidebar',    sidebar.length,                      SLOTS.sidebar],
  ['featured',   featured.length,                     SLOTS.featured],
  ['latest',     latest.length,                       SLOTS.latest],
  ['trials',     Math.min(trials || 0, SLOTS.trials), SLOTS.trials],
  ['clearances', clearances?.length || 0,             SLOTS.clearances],
  ['funding',    rounds?.length || 0,                 SLOTS.funding],
  ['notable',    notablePapers.length,                SLOTS.notable],
]

console.log('\nHome page section fill\n')
let short = 0
for (const [name, got, want] of sections) {
  const ok = got >= want
  if (!ok) short++
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(11)} ${String(got).padStart(2)} / ${want}`)
}

const total = sections.reduce((n, [, got, want]) => n + Math.min(got, want), 0)
const budget = sections.reduce((n, [, , want]) => n + want, 0)
console.log(`\n  ${total} of ${budget} slots filled (feed pool: ${feed?.length || 0} rows, rail: ${notable.length} papers)`)

// ── Pictures ────────────────────────────────────────────────────────────────
//
// The same two calls MagazineFeed makes, over the same list in the same order.
// The lead is asked through leadPicture because it holds itself to a picture
// wide enough for an eleven hundred pixel frame, and a card that fails that
// floor is still a card the page shows a plate in.
const stories = [lead, ...featured, ...latest].filter(Boolean)
const pictures = assignImages(stories)
const shown = s => (s === lead ? leadPicture(s, pictures.get(s.id)) : pictures.get(s.id))
const blank = stories.filter(s => !shown(s))

// Every picture shown must be the record's OWN. Anything else on this page is
// a bug rather than a shortfall, so it is counted separately and loudly.
const notItsOwn = stories.filter(s => {
  const img = shown(s)
  return img && (img.subject !== 'item' || img.url !== usableImage(s)?.url)
})

// The same photograph beside two stories, checked two ways: on this render,
// and against every render there has ever been.
const onPage = stories.map(shown).filter(Boolean)
const repeatedNow = onPage.length - new Set(onPage.map(i => keyOf(i.url))).size
const misbound = stories.filter(s => {
  const img = shown(s)
  const owner = img && ownerOf(LEDGER, img.url)
  return owner && owner !== s.id
})

console.log('\nHome page pictures\n')
console.log(`  ${blank.length ? '!' : '✓'} story frames  ${stories.length - blank.length} / ${stories.length} carry a photograph of their own`)
console.log(`    ${blank.length} show the record's own data figure instead`)
console.log(`  ${notItsOwn.length ? '✗' : '✓'} every picture is of the story it sits on`)
console.log(`  ${repeatedNow || misbound.length ? '✗' : '✓'} no photograph appears beside a second story`)
console.log(`    ledger: ${Object.keys(LEDGER.bindings).length} picture(s) spent, ${(REVIEW.pending || []).length} waiting on review`)
for (const s of blank) console.log(`    · data figure: ${String(s.title).slice(0, 72)}`)
for (const s of notItsOwn) console.log(`    ✗ not its own picture: ${String(s.title).slice(0, 60)}`)
for (const s of misbound) console.log(`    ✗ picture belongs to another story: ${String(s.title).slice(0, 56)}`)

// ── Headroom ────────────────────────────────────────────────────────────────
//
// Whether the page fills TOMORROW, which is a different question from whether
// it filled today and the one that gives any warning.
//
// A picture is spent permanently once it is bound, hotlinks rot, and a story
// eventually falls out of the feed. So a page that fills with nothing to spare
// is one dead link away from a blank frame, and the first anyone would know is
// the frame. Printing the margin is what turns that into a week's notice.
//
// The lead has a tighter constraint than the cards and it is worth stating
// separately: it needs a picture wide enough for the largest frame on the
// site, AND a story that has not led inside the memory window. Nine
// lead-worthy stories against a fortnight's memory is nine days of rotation.
const usable = feed.filter(s => storyPicture(s, { ledger: LEDGER }))
const leadable = usable.filter(canLead)
const spentLeads = recentLeadIds(LEDGER, new Date().toISOString().slice(0, 10))
const freeLeads = leadable.filter(s => !spentLeads.has(s.id)).length
const headroom = usable.length - stories.length

console.log('\nHeadroom\n')
console.log(`  ${headroom > 0 ? '✓' : '!'} ${usable.length} stories carry a usable photograph, for ${stories.length} frames (spare: ${headroom})`)
console.log(`  ${freeLeads > 3 ? '✓' : '!'} ${leadable.length} of them can lead, ${freeLeads} not used as a lead in the last ${LEAD_MEMORY_DAYS} days`)

// ── The lead ────────────────────────────────────────────────────────────────
//
// It has to be a different story from yesterday's. The page enforces this on
// its own (chooseLead in src/lib/ledger.js), so a failure here means the
// ledger stopped being written — which is exactly the silent failure worth an
// alarm, since the page would go on showing one story indefinitely.
const previous = lastLead(LEDGER)
const todayEntry = leadOn(LEDGER, new Date().toISOString().slice(0, 10))
const staleLead = Boolean(lead && previous && previous.item === lead.id && previous.date !== todayEntry?.date)

console.log('\nThe lead\n')
console.log(`  today      ${lead ? String(lead.title).slice(0, 64) : '(the feed came back empty)'}`)
console.log(`  last run   ${previous ? `${previous.date}  ${String(previous.title || previous.item).slice(0, 52)}` : '(nothing recorded yet)'}`)
console.log(`  ${staleLead ? '✗' : '✓'} the lead is not the one that ran last`)
console.log(`  ${todayEntry ? '✓' : '!'} today's lead is recorded in the ledger`)

if (short) {
  // The rail is the section that under-fills for a reason worth naming: it is
  // deduped against the feed above, so a paper on the front page is subtracted
  // from it. A rail of exactly four can therefore only ever render four when
  // none of them is also a story.
  const railDropped = notable.length - notablePapers.length
  if (railDropped) console.log(`  note: ${railDropped} rail paper(s) already appear in the feed above and were deduped out`)
  console.log(`\n::warning::${short} home page section(s) cannot fill their slots`)
}

// A frame showing a data figure is not a fault in itself. Running out of
// pictures to put in the frames is, and it is worth saying before the page is
// the thing that says it.
if (blank.length) {
  console.log(`::warning::${blank.length} of ${stories.length} home page story frames have no photograph — work the review queue (npm run images:queue)`)
}
if (headroom <= 0) {
  console.log('::warning::no spare photographs: one dead link is a blank frame. Source and review more before it costs a frame.')
}
if (freeLeads <= 3) {
  console.log(`::warning::only ${freeLeads} unused lead-worthy picture(s) left; the lead cannot keep rotating past that.`)
}

// These three ARE faults. Each one is a rule the page is supposed to make
// impossible, so reaching one means the page and the ledger have come apart.
const broken = notItsOwn.length + repeatedNow + misbound.length + (staleLead ? 1 : 0)
if (notItsOwn.length) console.log(`::warning::${notItsOwn.length} home page picture(s) are not of the story they sit on`)
if (repeatedNow) console.log(`::warning::${repeatedNow} photograph(s) appear beside more than one story on this page`)
if (misbound.length) console.log(`::warning::${misbound.length} home page picture(s) belong to a different story in the ledger`)
if (staleLead) console.log('::warning::the lead has not changed since the last recorded run')

if (!short && !broken) console.log('\nEvery section fills, every picture is its story\'s own, and the lead has moved.')
if ((short || broken) && STRICT) process.exit(1)
