/**
 * homepage.js — what the home page is allowed to show, and in what order.
 *
 * The page holds forty-three items. That is a fixed budget, split across the
 * sections below, and the split lives here rather than in the component so it
 * can be counted by a test instead of by eye. Sections that come back empty
 * (Supabase absent, a filter that nothing matches) shrink the page; nothing
 * ever grows it past the budget.
 *
 * The budget was thirty-two while every entity rail was a row of four picture
 * cards, which is as many as a four-across grid of 4:3 images can hold before
 * the page is all pictures. The rails are now list rows — a 96px thumbnail
 * beside the text rather than a card built around an image — and two rails sit
 * side by side, so six entries cost less height than four cards did. The extra
 * slots went where the supply is: the feed pool is 120 rows deep and the trial,
 * device and funding tables run to thousands. Notable is the one section that
 * cannot be grown on demand, since it is capped upstream at NOTABLE_MAX and
 * then deduped against the feed above; six is what the pool of twelve supports.
 *
 * The total is forty-three rather than a rounder number because the sidebar is
 * held to four by the geometry of the row it sits in, not by taste. See below.
 */
import { rankLead, hasRealImage, byNewest } from './sources'
import { canLead } from './image'
import { chooseLead } from './ledger'
import LEDGER from '../data/image-ledger.json'

/** The day the page is being read on, as the ledger records days. UTC, because
 *  the daily run is a 6am UTC cron and the two have to agree on what "today"
 *  is or the lead pinned this morning reads as tomorrow's. */
export const today = () => new Date().toISOString().slice(0, 10)

/** Items per section. The sum is the page's whole budget. */
export const SLOTS = {
  lead: 1,
  // Four, because the rail sets the height of the row it shares with the lead.
  // The lead stretches to match it, and the lead's picture is three fifths of
  // its width; a fifth headline in the rail pushes that picture past square and
  // into a portrait crop of a landscape photograph.
  sidebar: 4,
  featured: 4,
  latest: 10,
  trials: 6,
  clearances: 6,
  funding: 6,
  notable: 6,
}

export const MAX_ITEMS = Object.values(SLOTS).reduce((n, v) => n + v, 0)

/** Stories per page: everything the feed block itself renders. */
export const STORY_SLOTS = SLOTS.lead + SLOTS.sidebar + SLOTS.featured + SLOTS.latest

/**
 * Split the filtered feed into the four story slots.
 *
 * The visual slots go to photograph-bearing stories first (largest image first,
 * since a bigger source image survives the lead's crop), then to the rest by
 * rank. Under "Newest" the incoming order is already the answer, so image size
 * is not allowed to reorder it.
 */
export function composeStories(shown, sort = 'relevant', { ledger = LEDGER, date = today() } = {}) {
  const area = i => (i.metadata?.imageW || 0) * (i.metadata?.imageH || 0)
  const withPhotos = shown
    .filter(hasRealImage)
    .sort((a, b) => (sort === 'newest' ? 0 : area(b) - area(a)))

  // The lead obeys the Sort control and the reputable-source floor (rankLead
  // in lib/sources.js), and on top of that it has to be able to fill the slot.
  // The lead is the one picture a reader is certain to see, and a data figure
  // eleven hundred pixels wide is a poor front page. So the choice runs over
  // the stories that HAVE a lead-worthy picture first, and only falls back to
  // the whole list when none of them does.
  //
  // And then it has to be a DIFFERENT story from yesterday's. chooseLead walks
  // that ordering and takes the best candidate that has not led inside the
  // memory window — or, once the daily run has written the day's decision, the
  // story it decided on, so the top of the page does not swap under a reader
  // when the feed re-ranks mid-session. See src/lib/ledger.js.
  //
  // The rotation is a property of the PAGE rather than of the cron: with the
  // ledger's history and no run at all, yesterday's lead is still excluded,
  // so the front page changes on a morning the pipeline never fired.
  const lead =
    chooseLead(ledger, rankLead(shown.filter(canLead), sort), date)
    || chooseLead(ledger, rankLead(shown, sort), date)
    || withPhotos[0] || shown[0]
  const used = new Set(lead ? [lead] : [])

  const take = (pool, n) => {
    const out = []
    for (const it of pool) {
      if (out.length >= n) break
      if (used.has(it)) continue
      out.push(it); used.add(it)
    }
    return out
  }

  // Featured cards are the page's second-largest pictures, so they too prefer
  // photographs; the rail and the latest grid take the feed's own order.
  const featured = take([...withPhotos, ...shown], SLOTS.featured)
  const sidebar = take(shown, SLOTS.sidebar)
  const latest = take(shown, SLOTS.latest)
  return { lead, sidebar, featured, latest }
}

/** DOI and normalized-title keys for everything already on the page, so a
 *  later section can drop a paper the feed above has already run. */
export function shownKeys(...groups) {
  const norm = t => (t || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const keys = new Set()
  for (const g of groups.flat()) {
    if (!g) continue
    if (g.metadata?.doi) keys.add(g.metadata.doi.toLowerCase())
    if (g.doi) keys.add(String(g.doi).toLowerCase())
    if (g.title) keys.add(norm(g.title))
  }
  return keys
}

/** Notable papers not already shown above, capped at the section's slots. */
export function pickNotable(notable = [], exclude = new Set(), n = SLOTS.notable) {
  const norm = t => (t || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
  return notable
    .filter(p => !((p.doi && exclude.has(p.doi.toLowerCase())) || exclude.has(norm(p.title))))
    .slice(0, n)
}

export { byNewest }
