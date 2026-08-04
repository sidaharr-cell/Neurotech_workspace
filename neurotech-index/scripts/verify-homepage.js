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
 * A frame with no picture fails the same silent way. The story cards fill from
 * the reviewed pool at render time (assignImages in src/lib/image.js), so this
 * is not something the pipeline writes and then hopes about — but the pool is
 * finite, hotlinks rot, and a day's feed can be wider than what is left. When
 * that happens the card falls back to its data figure, which is exactly the
 * placeholder this page is not supposed to show.
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
import { SLOTS, composeStories, shownKeys, pickNotable } from '../src/lib/homepage.js'
import { assignImages, leadPicture, usableImage } from '../src/lib/image.js'
import CLASS_POOL from '../src/data/class-images.json'

const HERE = dirname(fileURLToPath(import.meta.url))
const STRICT = process.argv.includes('--strict')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const notable = JSON.parse(readFileSync(join(HERE, '../src/data/notable.json'), 'utf8'))

// The feed the page asks for: getNewsFeed({ limit: 120 }), which is every
// non-trial row by rank. No facets and no recency, because that is the page a
// reader lands on.
const { data: feed, error } = await sb.from('news_feed')
  .select('id,title,entry_type,published_at,summary,source,relevance_score,metadata,facet_function,facet_access,facet_application,in_scope')
  .neq('entry_type', 'trial')
  .order('relevance_score', { ascending: false })
  .order('published_at', { ascending: false, nullsFirst: false })
  .limit(120)
if (error) { console.error('feed query failed:', error.message); process.exit(1) }

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

// What the fill has left to work with. It goes dry silently, one card at a
// time, so the headroom is worth printing on a good day too.
const poolSize = new Set(Object.values(CLASS_POOL).flatMap(c => (c.images || []).map(i => i.url))).size
// A frame counts as borrowed when what it shows is not the record's own
// picture, which covers both a record that had none and a record whose own
// picture was already spent on the card above it.
const borrowed = stories.filter(s => shown(s) && shown(s).url !== usableImage(s)?.url).length

console.log('\nHome page pictures\n')
console.log(`  ${blank.length ? '✗' : '✓'} story frames  ${stories.length - blank.length} / ${stories.length} carry a photograph`)
console.log(`    ${borrowed} filled from the reviewed pool, which holds ${poolSize} pictures`)
for (const s of blank) console.log(`    ✗ no picture: ${String(s.title).slice(0, 72)}`)

if (short) {
  // The rail is the section that under-fills for a reason worth naming: it is
  // deduped against the feed above, so a paper on the front page is subtracted
  // from it. A rail of exactly four can therefore only ever render four when
  // none of them is also a story.
  const railDropped = notable.length - notablePapers.length
  if (railDropped) console.log(`  note: ${railDropped} rail paper(s) already appear in the feed above and were deduped out`)
  console.log(`\n::warning::${short} home page section(s) cannot fill their slots`)
}

if (blank.length) {
  // Only two things get here: the pool ran dry, or the day's stories all landed
  // on the same few technologies and their pictures were spent on the cards
  // above. Both are fixed by adding pictures to the reviewed pool
  // (scripts/data/class-images.json, npm run images:classes), not by relaxing
  // anything here.
  console.log(`::warning::${blank.length} home page story frame(s) have no picture and will show a data figure`)
}

if (!short && !blank.length) console.log('\nEvery section fills, and every story frame has a picture.')
if ((short || blank.length) && STRICT) process.exit(1)
