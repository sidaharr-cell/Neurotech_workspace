/**
 * mediapage.js — what the News and Press page shows, and in what order.
 *
 * The home page's composition (lib/homepage.js) cannot be reused here even
 * though the two look alike, and the reason is what each page is FOR. The home
 * page is a front page: a fixed budget of forty-three items across eight
 * sections, most of them not stories at all, sized so the whole thing is one
 * screenful of scroll. /media is a section archive. It holds one kind of thing,
 * it holds hundreds of them, and a reader arrives wanting either today's lead or
 * a specific story from three weeks ago. So the slots are bigger, there is a
 * tail rather than a cut-off, and the tail pages rather than truncating.
 *
 * What IS shared is the visual grammar — the same lead panel, the same ruled
 * grid, the same cards — imported from the home page's components rather than
 * reimplemented, so the two pages cannot drift into two house styles.
 */
import { pickLead, hasRealImage, byNewest } from './sources'
import { canLead } from './image'

/**
 * Items per section.
 *
 * `rail` is five rather than the home page's four because there is no lead-photo
 * aspect ratio to protect: this lead sits in a wider column, so a fifth headline
 * beside it does not push its picture into a portrait crop.
 *
 * `tail` is a page size, not a budget. Everything past the grid is reachable.
 */
export const MEDIA_SLOTS = {
  lead: 1,
  rail: 5,
  featured: 3,
  grid: 12,
  tail: 25,
}

/**
 * Split the filtered stories into the page's sections.
 *
 * Pictures go where they are largest. The lead is the one photograph a reader is
 * guaranteed to see and it is cropped hardest, so it is chosen from stories that
 * can actually fill the frame (`canLead`) before anything else is considered;
 * featured cards take the next-largest images; the grid and the tail take the
 * feed's own order. Under "Newest" the incoming order is the answer the reader
 * asked for, so image size is not allowed to reorder anything.
 *
 * Every section is drawn from one `used` set, so no story appears twice however
 * the sections are sized.
 */
export function composeMedia(shown, sort = 'relevant') {
  const area = i => (i.metadata?.imageW || 0) * (i.metadata?.imageH || 0)
  const withPhotos = shown
    .filter(hasRealImage)
    .sort((a, b) => (sort === 'newest' ? 0 : area(b) - area(a)))

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

  const featured = take([...withPhotos, ...shown], MEDIA_SLOTS.featured)
  const rail = take(shown, MEDIA_SLOTS.rail)
  const grid = take([...withPhotos, ...shown], MEDIA_SLOTS.grid)
  const tail = shown.filter(i => !used.has(i))
  return { lead, rail, featured, grid, tail }
}

export { byNewest }
