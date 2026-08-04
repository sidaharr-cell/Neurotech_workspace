/**
 * class-match.js — which technology's photographs a record may be illustrated
 * with, in the order it should be asked.
 *
 * The reviewed pool in `src/data/class-images.json` holds licensed photographs
 * of eighteen technologies, each one already affirmed by a person and by the
 * file's own description. `scripts/lib/images.js` hands a record the pool for
 * the technology its CLASSIFIER named, which leaves nothing for a record whose
 * technology has no photograph on Commons, and nothing for the second story of
 * the day about the same one.
 *
 * This ranks the whole pool for one record instead. It reads only the record's
 * own words and its stored facets, calls nothing, and returns class ids in the
 * order they fit: the technologies the record is actually about first, then the
 * ones its facets imply, then the rest, so a card is never left with no
 * photograph while the pool still holds one.
 *
 * The photographs it reaches down the list are of a NEIGHBOURING technology,
 * not of the record, which is what the `'class'` subject means and why every
 * one of them renders labelled "Illustration" with its credit. Settled 4 Aug
 * 2026: on the home page's story cards that is a fair illustration and a plate
 * is not. Nothing else on the site borrows this far, and nothing borrows a
 * technology the record has no relation to at all — the general tail is ordered
 * by how much of this field a picture can honestly stand for.
 */
import { facetsOfEntity } from './facets'

/**
 * Words that put a record squarely on one technology. Matched as substrings
 * against the record's own text; a longer phrase counts for more than a short
 * one, so "spinal cord stimulation" beats a bare "stimulation".
 */
const KEYWORDS = {
  cochlear_implant: ['cochlear', 'auditory prosthes', 'hearing loss', 'deafness', 'sensory restoration'],
  dbs: ['deep brain stimulation', 'subthalamic', 'globus pallidus', 'parkinson', 'essential tremor', 'dystonia', ' dbs'],
  vns: ['vagus', 'vagal'],
  scs: ['spinal cord stimulat', 'spinal cord', 'epidural stimulation', 'chronic pain', 'back pain', 'paraplegi', 'dorsal root', ' scs'],
  pns: ['peripheral nerve', 'sacral nerve', 'tibial nerve', 'occipital nerve', 'nerve stimulat', 'neuroprosthes'],
  tens: ['transcutaneous electrical', 'migraine', ' tens', 'wearable stimulat', 'consumer'],
  tms: ['transcranial magnetic', 'rtms', ' tms', 'depression', 'magnetic stimulation', 'coil'],
  fus: ['ultrasound', 'sonicat', 'lifu', 'hifu', 'ablation', 'acoustic'],
  optogenetics: ['optogenet', 'opsin', 'channelrhodopsin', 'photostim', 'photometry', 'fibre-optic', 'fiber-optic'],
  eeg: ['electroencephalo', ' eeg', 'eeg ', 'scalp', 'oscillat', 'seizure', 'epilep', 'sleep', 'brain-computer interface', 'brain computer interface', 'ssvep', 'p300', 'evoked potential', 'theta', 'alpha band', 'gamma band'],
  meg: ['magnetoencephalo', ' meg'],
  fnirs: ['fnirs', 'near-infrared', 'hemodynamic', 'headset', 'wearable'],
  mri: ['magnetic resonance', ' mri', 'fmri', 'neuroimag', 'imaging', 'connectom', 'white matter', 'atlas', 'tomograph'],
  emg: ['electromyograph', ' emg', 'myoelectric', 'muscle activity', 'motor unit'],
  prosthetic: ['prosthes', 'prosthetic', 'robotic arm', 'grasp', 'reach', 'hand movement', 'amputee', 'tetraplegi', 'cursor', 'handwriting', 'speech decoding'],
  exoskeleton: ['exoskeleton', 'gait', 'walking', 'locomot', 'rehabilitat', 'wheelchair', 'mobility', 'stroke recovery'],
  microscopy: ['microscop', 'histolog', 'in vitro', 'cell culture', 'tissue', 'neurons', 'rodent', 'mice', 'mouse', 'nanoparticle', 'gene therapy', 'molecular', 'synap'],
  electrode: ['electrode', 'ecog', 'electrocorticograph', 'intracortical', 'intracranial', 'microelectrode', 'utah array', 'neuropixels', 'implant', 'array', 'bioelectronic', 'flexible'],
}

/** What each facet answer implies, when the record's own words name nothing. */
const BY_FUNCTION = {
  stimulates: ['dbs', 'scs', 'tens', 'pns', 'vns', 'tms', 'fus'],
  records: ['eeg', 'electrode', 'emg', 'meg'],
  images: ['mri', 'fnirs', 'microscopy'],
  decodes: ['eeg', 'prosthetic', 'exoskeleton', 'electrode'],
}

/**
 * The order to ask in when nothing else has decided, most general first. An EEG
 * cap or an MRI scanner stands for the whole field in a way a vagus nerve
 * stimulator does not, so the pictures that assert the least are offered first.
 */
const GENERAL = [
  'eeg', 'mri', 'electrode', 'microscopy', 'fnirs', 'prosthetic', 'exoskeleton',
  'dbs', 'scs', 'tms', 'fus', 'emg', 'meg', 'pns', 'tens', 'optogenetics', 'vns', 'cochlear_implant',
]

/** Everything the record says about itself, lowercased, padded so a rule can
 *  match a bare acronym at either end without matching inside a word. */
function textOf(entity) {
  const m = entity?.metadata || {}
  return ` ${[entity?.title, entity?.summary, m.abstract, (entity?.topics || m.topics || []).join(' ')]
    .filter(Boolean).join(' ').toLowerCase()} `
}

/**
 * Class ids for one record, best first. Every id in the pool is returned, so a
 * caller working down the list always reaches a photograph.
 */
export function rankClasses(entity) {
  const text = textOf(entity)
  const scored = Object.entries(KEYWORDS)
    .map(([id, keys]) => [id, keys.filter(k => text.includes(k)).reduce((n, k) => n + k.length, 0)])
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id)

  const facets = facetsOfEntity(entity)
  const implied = facets.function.flatMap(fn => BY_FUNCTION[fn] || [])

  return [...new Set([...scored, ...implied, ...GENERAL])]
}
