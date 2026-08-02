/**
 * homepage.js — what the home page is allowed to show, and in what order.
 *
 * The page holds thirty items. That is a fixed budget, split across the
 * sections below, and the split lives here rather than in the component so it
 * can be counted by a test instead of by eye. Sections that come back empty
 * (Supabase absent, a filter that nothing matches) shrink the page; nothing
 * ever grows it past the budget.
 */
import { pickLead, hasRealImage, byNewest } from './sources'
import { canLead } from './image'

/** Items per section. The sum is the page's whole budget. */
export const SLOTS = {
  lead: 1,
  sidebar: 4,
  featured: 3,
  latest: 6,
  trials: 4,
  clearances: 4,
  funding: 4,
  notable: 4,
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
export function composeStories(shown, sort = 'relevant') {
  const area = i => (i.metadata?.imageW || 0) * (i.metadata?.imageH || 0)
  const withPhotos = shown
    .filter(hasRealImage)
    .sort((a, b) => (sort === 'newest' ? 0 : area(b) - area(a)))

  // The lead obeys the Sort control and the reputable-source floor (pickLead
  // in lib/sources.js), and on top of that it has to be able to fill the slot.
  // The lead is the one picture a reader is certain to see, and a data figure
  // eleven hundred pixels wide is a poor front page. So the choice runs over
  // the stories that HAVE a lead-worthy picture first, and only falls back to
  // the whole list when none of them does.
  const lead = pickLead(shown.filter(canLead), sort) || pickLead(shown, sort) || withPhotos[0] || shown[0]
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
