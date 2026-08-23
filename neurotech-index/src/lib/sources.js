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

/** Newest first. Anything without a date sorts last. */
export const byNewest = (a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0)

// Significance: squarely neurotech first, then a photo, then the feed's own rank.
const significance = i => neurotechCentrality(i) * 3 + (hasRealImage(i) ? 2 : 0) + (i.metadata?.rankScore ?? 0)

/**
 * The lead candidates, best first.
 *
 * Separated from pickLead because the day's lead is not simply the best story:
 * it is the best story that did not lead yesterday (src/lib/ledger.js), and
 * answering that needs the whole ordering rather than its first element.
 */
export function rankLead(items, sort = 'relevant') {
  if (!items?.length) return []
  const reputable = items.filter(isReputableSource)
  const pool = reputable.length ? reputable : items
  const order = sort === 'newest' ? byNewest : (a, b) => significance(b) - significance(a)
  return [...pool].sort(order)
}

/**
 * Choose the lead story from a list already filtered for display.
 *
 * The lead honours the Sort control. It used to be picked by significance
 * whatever the control said, so choosing "Newest" re-sorted the rail beneath
 * the hero and left a months-old paper heading the page.
 *
 * Under either sort the lead comes from a reputable source when the page has
 * one, so the quality floor holds and only the ordering changes.
 */
export function pickLead(items, sort = 'relevant') {
  return rankLead(items, sort)[0]
}
