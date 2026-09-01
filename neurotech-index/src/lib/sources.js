/**
 * sources.js — judging source reputation and neurotech-centrality, used to pick
 * the homepage lead story. Peer-reviewed journals and recognized preprint
 * servers count as reputable; among news, only a curated allow-list of quality
 * outlets qualifies (press-release aggregators like ScienceDaily do not).
 */
import { storyImage } from './image'

// Quality news outlets fit to headline the homepage. Journals are handled by
// entry_type, so this is only the news allow-list.
const REPUTABLE_NEWS = [
  'stat', 'mit news', 'mit technology review', 'the transmitter', 'new scientist',
  'ieee spectrum', 'scientific american', 'new york times', 'reuters', 'associated press',
  'npr', 'the guardian', 'the economist', 'wired', 'quanta', 'nature news',
]

/** True if this item's source is reputable enough to be the lead story. */
export function isReputableSource(item) {
  if (!item) return false
  if (item.entry_type === 'paper' || item.entry_type === 'preprint') return true // peer-reviewed / recognized preprint server
  const s = (item.source || '').toLowerCase()
  return REPUTABLE_NEWS.some(k => s.includes(k))
}

// Core neurotechnology terms — a lead should be squarely about the field
// (interfaces, implants, stimulation, decoding), not general neuroscience.
const NEUROTECH_TERMS = [
  'brain-computer', 'brain computer', 'brain-machine', 'brain machine', 'bci',
  'neural interface', 'neural implant', 'neuroprosthe', 'prosthes', 'neural decod',
  'deep brain stimulation', 'neurostimulation', 'neuromodulation', 'spinal cord stimulation',
  'electrode', 'implant', 'cortical', 'stentrode', 'cochlear', 'retinal implant',
  'optogenetic', 'electrocorticog', 'transcranial', 'closed-loop', 'neurotech',
]

/** Rough count of core-neurotech term hits in an item's title + summary. */
export function neurotechCentrality(item) {
  const h = ((item?.title || '') + ' ' + (item?.summary || '')).toLowerCase()
  return NEUROTECH_TERMS.reduce((n, t) => (h.includes(t) ? n + 1 : n), 0)
}

/**
 * True if the item carries a photograph the home page would actually run.
 *
 * This asks storyImage, which is the same question the page's own assignment
 * asks: a photograph OF this record, big enough for the frame. Asking it here
 * is what makes the ordering below agree with what the cards end up showing.
 *
 * It used to test `imageKind === 'real'`, which was the pipeline's FIRST
 * vocabulary and has not been written since the kinds became photo / figure /
 * logo. Every item therefore answered no, `withPhotos` in composeStories was
 * empty, and the preference for putting photographs in the visual slots had
 * quietly stopped applying — the page filled its picture frames in feed order
 * and it was not obvious from the page that anything was wrong.
 */
export function hasRealImage(item) {
  return Boolean(storyImage(item))
}

// Significance: squarely neurotech first, then a photo, then the feed's own rank.
const significance = i => neurotechCentrality(i) * 3 + (hasRealImage(i) ? 2 : 0) + (i.metadata?.rankScore ?? 0)

/**
 * The lead candidates, best first.
 *
 * Separated from pickLead because the day's lead is not simply the best story:
 * it is the best story that did not lead yesterday (src/lib/ledger.js), and
 * answering that needs the whole ordering rather than its first element.
 *
 * There is one ordering, and it is significance. Both of these took a `sort`
 * argument while the front page carried a Sort control offering "Newest"
 * beside it; the control is gone (29 Aug 2026) and with it the second
 * ordering, because a date sort with nothing to set it was a branch that could
 * only ever be reached by a caller getting the argument wrong.
 *
 * **The source floor tiers; it does not truncate.** This returned the
 * reputable items ALONE whenever there was at least one, which reads as the
 * same rule and is not: it decides how good the lead is AND how many leads
 * exist, and the second one is not its business. Measured 31 Aug 2026: 410
 * feed rows, 11 carrying a lead-worthy picture, and 4 left after this filter —
 * all four of which had led inside the fortnight, so chooseLead had nothing
 * unbanned to find and fell through to its last resort. The front page led
 * with the same story on 27, 29, 30 and 31 August and would not have moved
 * again on its own.
 *
 * Returning reputable-first and then the rest keeps the floor exactly where it
 * was — a reputable story wins whenever one is eligible, which is what
 * "reputable whenever the page has one" was always supposed to mean — while
 * leaving somewhere to go on the day they are all spent. Degrading one tier
 * for one day is a smaller cost than a week of the same headline.
 */
export function rankLead(items) {
  if (!items?.length) return []
  const bySignificance = (a, b) => significance(b) - significance(a)
  return [
    ...items.filter(isReputableSource).sort(bySignificance),
    ...items.filter(i => !isReputableSource(i)).sort(bySignificance),
  ]
}

/**
 * Choose the lead story from a list already filtered for display.
 *
 * The lead comes from a reputable source whenever the page has one, so the
 * quality floor holds however thin the day is.
 */
export function pickLead(items) {
  return rankLead(items)[0]
}
