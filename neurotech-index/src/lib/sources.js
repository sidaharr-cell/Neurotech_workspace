/**
 * sources.js — judging source reputation and neurotech-centrality, used to pick
 * the homepage lead story. Peer-reviewed journals and recognized preprint
 * servers count as reputable; among news, only a curated allow-list of quality
 * outlets qualifies (press-release aggregators like ScienceDaily do not).
 */

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
