/**
 * bind-home-images.js — write down which photograph is which story's, and
 * which story leads today.
 *
 *   node --env-file-if-exists=.env scripts/bind-home-images.js            # DRY RUN
 *   node --env-file-if-exists=.env scripts/bind-home-images.js --commit
 *
 * Two of the home page's rules are about time rather than about a render, so
 * neither can be enforced by the page alone:
 *
 *   no photograph appears beside two different stories, ever
 *   the story at the top is not the story that was at the top yesterday
 *
 * The page can hold both only because this script remembers. It composes the
 * home page THROUGH THE PAGE'S OWN CODE — composeStories, assignImages,
 * leadPicture, the same three calls MagazineFeed makes, in the same order over
 * the same list — takes the answer, and writes it to src/data/image-ledger.json.
 * Asking through the page's own functions is what stops the ledger and the
 * page disagreeing about what ran; it is the same reason verify-homepage.js is
 * built this way, and it is why this runs under vite-node.
 *
 * Binding is one-way. A picture bound to a story is that story's for good,
 * even after the link rots, because the promise is that a reader will not meet
 * it beside something else. src/lib/ledger.js has no unbind and should not
 * grow one.
 *
 * The workflow's commit step must stage src/data/image-ledger.json, or the
 * day's bindings are thrown away and the same photographs are handed out again
 * tomorrow.
 */
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { getNewsFeed } from '../src/lib/data.js'
import { SLOTS, composeStories, today } from '../src/lib/homepage.js'
import { assignImages, leadPicture } from '../src/lib/image.js'
import { bind, recordLead, ownerOf, lastLead, keyOf } from '../src/lib/ledger.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const LEDGER_PATH = join(HERE, '../src/data/image-ledger.json')
const COMMIT = process.argv.includes('--commit')
const DATE = process.env.LEDGER_DATE || today()

let ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'))

// The feed the page asks for — asked by CALLING the page's own data layer
// rather than by restating its query. getNewsFeed is not a simple top-N: it
// takes a recency window, re-sorts it by the rankScore inside a jsonb blob,
// and then appends every photograph-bearing story below the cut so the feed
// has pictures to feature. A hand-written `order by relevance_score` looks
// like the same thing and returns a different set of stories, which is how
// this script came to be sourcing and binding pictures for rows the page does
// not show while missing rows it does.
const feed = await getNewsFeed({ limit: 120 })
if (!feed.length) { console.error('the feed came back empty — is VITE_SUPABASE_URL set?'); process.exit(1) }

// Composed against the ledger AS IT STANDS, which is what makes the lead
// rotate: yesterday's lead is already in it and is excluded here.
const { lead, featured, latest } = composeStories(feed || [], { ledger, date: DATE })
const stories = [lead, ...featured, ...latest].filter(Boolean)
const pictures = assignImages(stories, { ledger })
const shown = s => (s === lead ? leadPicture(s, pictures.get(s.id) ?? null) : pictures.get(s.id))

// ── The lead ────────────────────────────────────────────────────────────────

const previous = lastLead(ledger)
console.log(`\nLead for ${DATE}`)
console.log(`  yesterday  ${previous ? `${previous.date}  ${String(previous.title || previous.item).slice(0, 60)}` : '(nothing recorded)'}`)
console.log(`  today      ${lead ? String(lead.title).slice(0, 60) : '(the feed came back empty)'}`)
if (lead && previous && previous.item === lead.id && previous.date !== DATE) {
  // Reachable only when every story on the page has led inside the memory
  // window, which means the feed has stopped moving. Worth saying out loud.
  console.log('  ::warning::the lead has not changed — every candidate has led recently')
}

// ── Bindings ────────────────────────────────────────────────────────────────

console.log('\nStory pictures\n')
let bound = 0, already = 0, blank = 0
for (const s of stories) {
  const img = shown(s)
  const label = String(s.title).slice(0, 58).padEnd(60)
  if (!img) { blank++; console.log(`  ·  ${label} data figure`); continue }
  const owner = ownerOf(ledger, img.url)
  if (owner === s.id) { already++; console.log(`  =  ${label} ${keyOf(img.url).split('/').pop().slice(0, 34)}`); continue }
  if (owner) {
    // assignImages should have withheld this. If it did not, the two are
    // reading the ledger differently and that is worth failing loudly over
    // rather than quietly overwriting a promise.
    console.error(`\nrefusing to rebind a picture held by ${owner}: ${img.url}`)
    process.exit(1)
  }
  ledger = bind(ledger, img.url, { item: s.id, title: s.title, at: DATE })
  bound++
  console.log(`  ●  ${label} ${keyOf(img.url).split('/').pop().slice(0, 34)}`)
}

if (lead) ledger = recordLead(ledger, { date: DATE, item: lead.id, image: shown(lead)?.url || null, title: lead.title })

console.log(`\n${bound} new binding(s), ${already} already held, ${blank} frame(s) showing a data figure`)
console.log(`  ledger now holds ${Object.keys(ledger.bindings).length} picture(s) and ${ledger.leads.length} day(s) of leads`)
if (blank > stories.length / 2) {
  console.log(`::warning::${blank} of ${stories.length} story frames have no photograph — the sourcing step is not keeping up`)
}
console.log(`  (story slots: ${SLOTS.lead + SLOTS.featured + SLOTS.latest})`)

if (COMMIT) {
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n')
  console.log('\nWrote src/data/image-ledger.json.')
} else {
  console.log('\nDry run. Re-run with --commit to write.')
}
