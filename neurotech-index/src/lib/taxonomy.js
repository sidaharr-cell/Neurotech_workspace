/**
 * taxonomy.js — the single, data-driven source of truth for Device Classes.
 *
 * "Device Class" is the cross-cutting filter applied to the news feed and every
 * content section (Media, Research, Trials, Companies, Devices). Adding or
 * renaming a class here is a DATA edit only — filter bars iterate this array.
 * `match` keywords let the filter work over existing free-text fields (tags,
 * abstracts, descriptions) without a schema change.
 */

export const DEVICE_CLASSES = [
  {
    id: 'recording',
    label: 'Neural Recording Devices',
    short: 'Recording',
    match: ['eeg', 'ecog', 'electrophysiolog', 'electrocorticograph', 'intracortical', 'microelectrode', 'lfp', 'single-unit', 'neural recording', 'utah array', 'recording array'],
  },
  {
    id: 'stimulation',
    label: 'Neural Stimulation Devices',
    short: 'Stimulation',
    match: ['dbs', 'deep brain stimulation', 'tms', 'tdcs', 'tacs', 'transcranial', 'neurostimulation', 'neuromodulation', 'spinal cord stimulation', 'epidural stimulation', 'vagus nerve', 'stimulator'],
  },
  {
    id: 'interface',
    label: 'Neural Interface / Decoding Devices',
    short: 'Interface / Decoding',
    match: ['bci', 'brain-computer', 'brain computer', 'brain-machine', 'neural interface', 'decod', 'encod', 'speech bci', 'neuralink', 'synchron', 'braingate', 'neural bypass'],
  },
  {
    id: 'sensory',
    label: 'Sensory Prosthetic Devices',
    short: 'Sensory Prosthetics',
    match: ['cochlear', 'retinal', 'bionic eye', 'visual prosthes', 'auditory prosthes', 'sensory restoration', 'somatosensory', 'artificial vision', 'hearing'],
  },
  {
    id: 'motor',
    label: 'Motor Prosthetic Devices',
    short: 'Motor Prosthetics',
    match: ['neuroprosthet', 'prosthes', 'prosthetic limb', 'fes', 'functional electrical stimulation', 'exoskeleton', 'robotic arm', 'reach and grasp', 'motor restoration', 'ambulation'],
  },
  {
    id: 'closed-loop',
    label: 'Adaptive (Closed-Loop) Neurodevices',
    short: 'Closed-Loop',
    match: ['closed-loop', 'closed loop', 'adaptive', 'responsive neurostim', 'bidirectional', 'real-time feedback'],
  },
  {
    id: 'cognitive',
    label: 'Cognitive Neuroprosthetic Devices',
    short: 'Cognitive',
    match: ['cognitive prosthes', 'memory prosthes', 'hippocampal prosthes', 'memory enhancement', 'cognitive neuroprosthet'],
  },
  {
    id: 'imaging',
    label: 'Neuroimaging Devices',
    short: 'Neuroimaging',
    match: ['fmri', 'fnirs', 'meg', 'pet imaging', 'neuroimaging', 'calcium imaging', 'two-photon', 'functional imaging', 'ultrasound imaging'],
  },
]

// ── Matching helpers (derived from existing free-text fields) ────────────────

function haystack(entity) {
  return JSON.stringify(entity || {}).toLowerCase()
}

export function entityMatchesClass(entity, classId) {
  const cls = DEVICE_CLASSES.find(c => c.id === classId)
  if (!cls) return true
  const h = haystack(entity)
  return cls.match.some(m => h.includes(m))
}

/** Device classes an entity belongs to (derived) — for showing labels on cards. */
export function classesForEntity(entity) {
  const h = haystack(entity)
  return DEVICE_CLASSES.filter(c => c.match.some(m => h.includes(m)))
}

export const classLabel = (id) => DEVICE_CLASSES.find(c => c.id === id)?.label || id
export const classShort = (id) => DEVICE_CLASSES.find(c => c.id === id)?.short || id
