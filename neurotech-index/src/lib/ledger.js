/**
 * ledger.js — which photograph belongs to which story, permanently.
 *
 * Two rules the page cannot enforce on its own, because both are about time
 * rather than about a single render:
 *
 *   one photograph, one story    A picture that has run beside a story is that
 *                                story's picture for good. It is never offered
 *                                to a second story, not on the same page and
 *                                not eleven months later. Deduplicating within
 *                                a render is not enough: a reader who comes
 *                                back on Thursday recognises Monday's picture,
 *                                and a photograph doing duty for two different
 *                                findings quietly says they are the same
 *                                finding.
 *
 *   the lead changes every day   The top of the page is the one picture every
 *                                reader sees. A story that led yesterday does
 *                                not lead today, even if it is still the best
 *                                story in the index.
 *
 * Both need memory, so both live in `src/data/image-ledger.json`, written by
 * the daily run and committed. This module is the whole vocabulary for reading
 * and amending that file, and it is PURE: every function takes the ledger as
 * its first argument and returns a new value. The page imports the JSON and
 * calls in; the scripts read the file off disk and call in. Neither restates
 * the rule, which is how the page and the pipeline stayed in agreement about
 * cropping (src/lib/crop.js) and how they stay in agreement about this.
 *
 * There is deliberately no unbinding. A binding is a promise that a picture
 * will not turn up elsewhere, and a promise a nightly job can revoke is not
 * one. A story that loses its picture (the link rots, the licence turns out to
 * be wrong) is given a different one; the dead URL stays spent.
 */

/** The shape of an empty ledger, for a first run and for tests. */
export const EMPTY = { version: 1, bindings: {}, leads: [] }

/**
 * The key a URL is remembered under.
 *
 * Two things make the same picture arrive under different URLs, and both would
 * hand a bound photograph back to the pool if the raw string were the key.
 *
 * Wikimedia serves every file through a thumbnail renderer, so the same file
 * is `.../thumb/a/ab/Name.jpg/1280px-Name.jpg` today and `/2000px-Name.jpg`
 * after the resolution floor is raised. Collapsing the size segment means
 * re-sourcing a picture larger does not make it free again.
 *
 * The rest is ordinary noise: scheme, a `www.` host prefix, a trailing slash,
 * and the tracking parameters publishers append to their own image URLs.
 */
export function keyOf(url) {
  if (!url) return ''
  let s = String(url).trim()
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
  s = s.replace(/[?#].*$/, '')
  // Wikimedia: /thumb/<a>/<ab>/<Name>/<N>px-<Name> collapses to the file itself.
  s = s.replace(/\/thumb\/((?:[0-9a-f]\/[0-9a-f]{2}\/)?[^/]+)\/\d+px-[^/]+$/i, '/$1')
  return s.replace(/\/+$/, '').toLowerCase()
}

/** The story a picture already belongs to, or null. */
export function ownerOf(ledger, url) {
  return ledger?.bindings?.[keyOf(url)]?.item ?? null
}

/**
 * May this item run this picture?
 *
 * Free means the picture is unspoken for, or already this item's. Anything
 * else is somebody else's photograph.
 */
export function isFree(ledger, url, itemId) {
  if (!url) return false
  const owner = ownerOf(ledger, url)
  return owner === null || owner === itemId
}

/** The picture bound to an item, or null. Built by scan, because the file is
 *  keyed by picture: the binding is a fact about the picture, and an item that
 *  has lost one picture and been given another has two rows pointing at it. */
export function imageFor(ledger, itemId) {
  if (!itemId) return null
  const rows = Object.entries(ledger?.bindings || {}).filter(([, b]) => b.item === itemId)
  if (!rows.length) return null
  rows.sort((a, b) => String(b[1].at || '').localeCompare(String(a[1].at || '')))
  return rows[0][1].url || rows[0][0]
}

/**
 * Bind a picture to a story. Returns a new ledger; the old one is untouched.
 *
 * Binding a picture that is already this story's is a no-op rather than an
 * error, because the daily run re-asserts every assignment it made yesterday
 * and there is nothing wrong with that. Binding one that belongs to a
 * DIFFERENT story throws: the caller was supposed to check isFree, and
 * silently overwriting would break the only promise this file makes.
 */
export function bind(ledger, url, { item, title = null, at = null } = {}) {
  const key = keyOf(url)
  if (!key || !item) return ledger
  const held = ledger?.bindings?.[key]
  if (held && held.item !== item) {
    throw new Error(`image already bound to ${held.item}: ${url}`)
  }
  return {
    ...ledger,
    bindings: {
      ...ledger.bindings,
      [key]: { item, title: title || held?.title || null, url, at: held?.at || at || null },
    },
  }
}

// ── The lead ────────────────────────────────────────────────────────────────

/** How far back a story is remembered as having led. A fortnight is long
 *  enough that a reader does not meet the same top story twice in a visit
 *  pattern, and short enough that a thin week is not left with nothing that
 *  qualifies. */
export const LEAD_MEMORY_DAYS = 14

const day = d => String(d).slice(0, 10)

/** The lead recorded for a given day, or null. */
export function leadOn(ledger, date) {
  const d = day(date)
  return (ledger?.leads || []).find(l => day(l.date) === d) || null
}

/** The most recent lead recorded, whenever it was. */
export function lastLead(ledger) {
  const leads = [...(ledger?.leads || [])].sort((a, b) => day(a.date).localeCompare(day(b.date)))
  return leads[leads.length - 1] || null
}

/**
 * The stories that may not lead today: everyone who has led inside the memory
 * window, today's own entry excepted.
 *
 * Today is excepted so that reading the ledger back is stable. Once the daily
 * run has written today's lead, that story is pinned rather than banned, and
 * every OTHER recent lead stays out of the running.
 */
export function recentLeadIds(ledger, date, days = LEAD_MEMORY_DAYS) {
  const today = day(date)
  const floor = day(new Date(new Date(`${today}T00:00:00Z`).getTime() - days * 86400000).toISOString())
  return new Set(
    (ledger?.leads || [])
      .filter(l => day(l.date) >= floor && day(l.date) !== today)
      .map(l => l.item)
      .filter(Boolean),
  )
}

/**
 * Record today's lead. Returns a new ledger.
 *
 * One entry per day: re-running the daily job replaces the day's entry rather
 * than appending a second, so a retry after a failure does not read as two
 * different stories having led.
 */
export function recordLead(ledger, { date, item, image = null, title = null }) {
  const d = day(date)
  const leads = (ledger?.leads || []).filter(l => day(l.date) !== d)
  leads.push({ date: d, item, image, title })
  leads.sort((a, b) => day(a.date).localeCompare(day(b.date)))
  return { ...ledger, leads: leads.slice(-400) }
}

/**
 * When each of these stories last led, as a date string per id, with '' for a
 * story that never has. Today's own entry is not history — it is the thing
 * being decided — so it does not count.
 */
function lastLedById(ledger, list, date) {
  const today = day(date)
  const seen = new Map(list.map(c => [c.id, '']))
  for (const l of ledger?.leads || []) {
    const d = day(l.date)
    if (d === today || !seen.has(l.item)) continue
    if (d > seen.get(l.item)) seen.set(l.item, d)
  }
  return seen
}

/**
 * Choose the lead for a day from a list of candidates already in preference
 * order.
 *
 * Pinned first: if the daily run has already decided today, the page shows
 * what it decided, so the top of the page does not change under a reader as
 * the feed re-sorts. Otherwise the first candidate that has not led recently
 * wins, which is what makes the lead change even on a day the job never ran.
 *
 * The last resort — every story on offer has led inside the fortnight — is the
 * one that led LONGEST ago, not the first in the list. Taking the first was
 * taking the highest-ranked, and the highest-ranked is the story that led
 * yesterday, so the fallback re-elected the incumbent every single day and the
 * page stopped moving. It did exactly that from 29 to 31 Aug 2026. Ties keep
 * the caller's order, so among equally stale candidates the best one still
 * wins.
 *
 * This is a floor, not the mechanism: with a healthy candidate pool it is
 * never reached, and rankLead in lib/sources.js is what keeps the pool wide
 * enough that it is not.
 */
export function chooseLead(ledger, candidates, date) {
  const list = (candidates || []).filter(Boolean)
  if (!list.length) return null
  const pinned = leadOn(ledger, date)
  if (pinned) {
    const found = list.find(c => c.id === pinned.item)
    if (found) return found
  }
  const banned = recentLeadIds(ledger, date)
  const free = list.find(c => !banned.has(c.id))
  if (free) return free
  const led = lastLedById(ledger, list, date)
  return list.reduce((best, c) => (led.get(c.id) < led.get(best.id) ? c : best), list[0])
}
