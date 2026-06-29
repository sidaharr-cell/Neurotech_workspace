/**
 * taxonomy.js — the single, data-driven source of truth for topics & filter axes.
 *
 * The whole point: adding/renaming a topic or axis here is a DATA edit only.
 * No layout, routing, or component changes are needed — filter bars iterate
 * these arrays. `match` keywords let the data-driven filter work over the
 * existing free-text tags/fields without a schema change (derived-first).
 */

// ── First-level topics (cross-cutting; applied to every entity type) ─────────
export const TOPICS = [
  { id: 'bci',            label: 'Brain–Computer Interfaces', match: ['bci', 'brain-computer', 'brain computer', 'neural interface', 'neuralink', 'synchron', 'braingate', 'neural bypass'] },
  { id: 'eeg',            label: 'EEG & Electrophysiology',   match: ['eeg', 'ecog', 'electrophysiolog', 'electrocorticograph', 'lfp', 'single-unit'] },
  { id: 'implants',       label: 'Neural Implants',           match: ['implant', 'intracortical', 'utah array', 'electrode array', 'microelectrode'] },
  { id: 'dbs',            label: 'Deep Brain Stimulation',    match: ['dbs', 'deep brain stimulation'] },
  { id: 'neurostim',      label: 'Neurostimulation',          match: ['tms', 'tdcs', 'tacs', 'transcranial', 'neurostimulation', 'neuromodulation'] },
  { id: 'neuroprosth',    label: 'Neuroprosthetics',          match: ['neuroprosthet', 'prosthet', 'prosthesis', 'fes', 'exoskeleton'] },
  { id: 'sensory',        label: 'Sensory Restoration',       match: ['cochlear', 'retinal', 'sensory restoration', 'bionic eye', 'vision restor', 'somatosensory', 'auditory'] },
  { id: 'scs',            label: 'Spinal Cord Stimulation',   match: ['spinal cord', 'scs', 'epidural stimulation', 'spinal'] },
  { id: 'neuroimaging',   label: 'Neuroimaging',              match: ['fmri', 'fnirs', 'neuroimaging', 'meg', 'pet', 'calcium imaging', 'two-photon'] },
  { id: 'decoding',       label: 'Neural Decoding & Encoding',match: ['decod', 'encod', 'speech bci', 'neural decod', 'brain reading'] },
  { id: 'closed-loop',    label: 'Closed-loop & Adaptive',    match: ['closed-loop', 'closed loop', 'adaptive', 'bidirectional'] },
  { id: 'optogenetics',   label: 'Optogenetics',              match: ['optogenet', 'opsin'] },
  { id: 'neuromorphic',   label: 'Neuromorphic Computing',    match: ['neuromorphic', 'spiking neural', 'memristor'] },
  { id: 'neuroethics',    label: 'Neuroethics',               match: ['neuroethic', 'ethic', 'privacy', 'policy', 'consent'] },
]

// ── Additional cross-cutting filter axes (used where the data supports it) ───
export const AXES = {
  modality: {
    label: 'Modality',
    options: [
      { id: 'invasive',     label: 'Invasive',     match: ['invasive', 'intracortical', 'implant', 'ecog', 'dbs', 'penetrating'] },
      { id: 'non-invasive', label: 'Non-invasive', match: ['non-invasive', 'noninvasive', 'eeg', 'fnirs', 'tms', 'tdcs', 'wearable', 'scalp'] },
    ],
  },
  application: {
    label: 'Application',
    options: [
      { id: 'clinical', label: 'Clinical', match: ['clinical', 'trial', 'patient', 'therapeutic', 'fda', 'treatment'] },
      { id: 'research', label: 'Research', match: ['research', 'study', 'preprint', 'lab'] },
      { id: 'consumer', label: 'Consumer', match: ['consumer', 'wearable', 'commercial', 'headset'] },
    ],
  },
  stage: {
    label: 'Development stage',
    options: [
      { id: 'preclinical', label: 'Preclinical',  match: ['preclinical', 'animal', 'primate', 'rodent', 'in vitro'] },
      { id: 'in-trials',   label: 'In trials',    match: ['trial', 'prime study', 'in trials', 'investigational'] },
      { id: 'fda-cleared', label: 'FDA-cleared',  match: ['fda', 'cleared', 'approved', 'ce mark'] },
      { id: 'commercial',  label: 'Commercial',   match: ['commercial', 'available', 'market', 'consumer'] },
    ],
  },
}

// ── Matching helpers (derived from existing free-text fields) ────────────────

function haystack(entity) {
  return JSON.stringify(entity || {}).toLowerCase()
}

export function entityMatchesTopic(entity, topicId) {
  const topic = TOPICS.find(t => t.id === topicId)
  if (!topic) return true
  const h = haystack(entity)
  return topic.match.some(m => h.includes(m))
}

export function entityMatchesAxis(entity, axisKey, optionId) {
  const axis = AXES[axisKey]
  if (!axis) return true
  const opt = axis.options.find(o => o.id === optionId)
  if (!opt) return true
  const h = haystack(entity)
  return opt.match.some(m => h.includes(m))
}

/** Topics an entity is tagged with (derived) — for showing chips on a card. */
export function topicsForEntity(entity) {
  const h = haystack(entity)
  return TOPICS.filter(t => t.match.some(m => h.includes(m)))
}

export const topicLabel = (id) => TOPICS.find(t => t.id === id)?.label || id
