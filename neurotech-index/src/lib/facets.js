/**
 * facets.js — the single source of truth for the three-facet classification.
 *
 * Replaces the eight-class DEVICE_CLASSES scheme in taxonomy.js. Every item is
 * answered on three independent questions:
 *   FUNCTION     what it does to the nervous system
 *   ACCESS       how invasive it is
 *   APPLICATION  what problem it addresses
 *
 * Classification is deterministic — no model calls — and runs ONCE at ingest.
 * Pages read the stored columns; nothing is recomputed in the browser.
 *
 * Source precedence (highest first):
 *   1. curated vocabulary  MeSH · CPC · FDA product code · trial conditions
 *   2. keyword rules       named content fields only, whole-word matching
 *   3. roll-up             labs and researchers inherit from their output
 *   4. abstain             record nothing rather than guess
 */

export const CLASSIFIER_VERSION = 'v1.0'

// ── Facet vocabularies ──────────────────────────────────────────────────────

export const FUNCTION = ['records', 'stimulates', 'images', 'decodes', 'none']
export const ACCESS = ['non_invasive', 'minimally_invasive', 'implanted_non_penetrating', 'implanted_penetrating', 'not_applicable']
export const APPLICATION = [
  'movement_restoration', 'communication_speech', 'sensory_restoration', 'epilepsy',
  'movement_disorders', 'psychiatric', 'pain', 'cognition_memory', 'autonomic_organ',
  'rehabilitation', 'diagnostics', 'research_tool', 'consumer_wellness',
]

export const FUNCTION_LABEL = {
  records: 'Records', stimulates: 'Stimulates', images: 'Images', decodes: 'Decodes', none: 'Other',
}
export const ACCESS_LABEL = {
  non_invasive: 'Non-invasive', minimally_invasive: 'Minimally invasive',
  implanted_non_penetrating: 'Implanted (surface)', implanted_penetrating: 'Implanted (penetrating)',
  not_applicable: 'Not applicable',
}
export const APPLICATION_LABEL = {
  movement_restoration: 'Movement restoration', communication_speech: 'Communication & speech',
  sensory_restoration: 'Sensory restoration', epilepsy: 'Epilepsy',
  movement_disorders: 'Movement disorders', psychiatric: 'Psychiatric', pain: 'Pain',
  cognition_memory: 'Cognition & memory', autonomic_organ: 'Autonomic & organ',
  rehabilitation: 'Rehabilitation', diagnostics: 'Diagnostics',
  research_tool: 'Research tool', consumer_wellness: 'Consumer & wellness',
}

// ── Derived badges ──────────────────────────────────────────────────────────
// Computed from FUNCTION rather than stored, so they can never disagree with it.

export const isBCI = fn => fn.includes('records') && fn.includes('decodes')
export const isClosedLoop = fn => fn.includes('records') && fn.includes('stimulates')
export function badgesFor(fn = []) {
  const out = []
  if (isBCI(fn)) out.push('BCI')
  if (isClosedLoop(fn)) out.push('Closed-loop')
  return out
}

// ── Keyword spec ────────────────────────────────────────────────────────────
// stems   match at a word start, any suffix   (electrophysiolog → -ical, -y)
// words   whole words only, no suffix         (fes, meg — match inside words otherwise)
// phrases bounded phrases
//
// Compiled once at module load. See docs/classification-system.md for the
// reasoning behind each list.

const SPEC = {
  function: {
    records: {
      stems: ['eeg', 'ecog', 'electroencephalograph', 'electrocorticograph', 'electrophysiolog',
        'electromyograph', 'intracortical', 'microelectrode', 'electrocortical', 'polysomnograph'],
      words: ['lfp', 'lfps', 'emg', 'eng', 'erp'],
      phrases: ['single-unit', 'multi-unit', 'neural recording', 'neural signal acquisition',
        'microelectrode array', 'utah array', 'recording array', 'local field potential',
        'evoked potential', 'evoked response', 'spike sorting', 'depth electrode',
        'subdural electrode', 'nerve conduction', 'unit activity', 'neural telemetry'],
    },
    stimulates: {
      stems: ['neurostimulat', 'neuromodulat', 'transcranial', 'stimulator', 'microstimulat', 'magnetotherap'],
      words: ['dbs', 'tms', 'rtms', 'tdcs', 'tacs', 'tens', 'vns', 'scs', 'fes', 'ect'],
      phrases: ['deep brain stimulation', 'spinal cord stimulation', 'vagus nerve stimulation',
        'vagal nerve stimulation', 'sacral nerve stimulation', 'peripheral nerve stimulation',
        'phrenic nerve pacing', 'diaphragmatic pacing', 'functional electrical stimulation',
        'transcutaneous electrical nerve', 'transcutaneous direct current', 'direct current stimulation',
        'alternating current stimulation', 'magnetic stimulation', 'epidural stimulation',
        'cortical stimulation', 'intracortical microstimulation', 'optogenetic stimulation',
        'focused ultrasound neuromodulation', 'responsive stimulation', 'electroconvulsive'],
    },
    images: {
      stems: ['fmri', 'fnirs', 'magnetoencephalograph', 'neuroimaging', 'echoencephalograph'],
      words: ['meg', 'pet', 'mri', 'dti'],
      phrases: ['functional near-infrared', 'near-infrared spectroscopy', 'calcium imaging',
        'two-photon', 'functional imaging', 'functional neuroimaging', 'functional ultrasound',
        'diffusion tensor', 'positron emission', 'magnetic resonance imaging'],
    },
    decodes: {
      stems: ['decod'],
      words: ['bci', 'bcis'],
      phrases: ['brain-computer', 'brain computer', 'brain-machine', 'brain machine',
        'neural interface', 'neural decoding', 'neural decoder', 'speech decoding', 'motor decoding',
        'intention decoding', 'movement intention', 'neural control', 'neural bypass', 'braingate',
        'neuralink', 'stentrode', 'cursor control', 'myoelectric control'],
    },
  },
  access: {
    non_invasive: {
      stems: ['transcranial', 'transcutaneous', 'scalp', 'wearable', 'headband', 'headset', 'noninvasive'],
      words: ['eeg', 'tms', 'rtms', 'tdcs', 'tacs', 'tens', 'fnirs', 'meg'],
      phrases: ['non-invasive', 'surface electrode', 'dry electrode', 'surface emg', 'skin electrode',
        'over-the-counter', 'external stimulator'],
    },
    minimally_invasive: {
      stems: ['endovascular', 'percutaneous'],
      phrases: ['minimally invasive', 'stentrode', 'injectable electrode', 'catheter-delivered', 'stent-mounted'],
    },
    implanted_non_penetrating: {
      stems: ['ecog', 'electrocorticograph', 'subdural', 'epidural', 'epiretinal', 'implantable', 'implanted'],
      phrases: ['nerve cuff', 'cuff electrode', 'surface array', 'cortical surface', 'cochlear implant',
        'implanted stimulator', 'subdural grid', 'subdural strip'],
    },
    implanted_penetrating: {
      stems: ['intracortical', 'penetrating', 'microwire'],
      words: ['seeg'],
      phrases: ['utah array', 'depth electrode', 'stereo-eeg', 'stereoelectroencephalography',
        'thread electrode', 'michigan probe', 'neural probe', 'penetrating array', 'dbs lead',
        'intraparenchymal', 'neuralink'],
    },
  },
  application: {
    movement_restoration: { stems: ['tetrapleg', 'quadripleg', 'hemipleg', 'parapleg'], phrases: ['paralysis', 'spinal cord injury', 'reach and grasp', 'prosthetic limb', 'robotic arm', 'motor restoration', 'locomotor recovery', 'restoring movement', 'limb prosthesis'] },
    communication_speech: { phrases: ['speech decoding', 'speech neuroprosthes', 'communication bci', 'spelling interface', 'handwriting decoding', 'locked-in', 'anarthria', 'augmentative communication', 'silent speech'] },
    sensory_restoration: { stems: ['cochlear'], phrases: ['auditory brainstem', 'hearing restoration', 'hearing loss', 'hearing preservation', 'bionic eye', 'retinal implant', 'retinal prosthes', 'visual prosthes', 'artificial vision', 'sensory feedback', 'tactile feedback', 'somatosensory restoration', 'sensory substitution'] },
    epilepsy: { stems: ['epilep', 'seizure', 'anticonvuls', 'ictal'], phrases: ['responsive neurostim', 'refractory epilepsy'] },
    movement_disorders: { stems: ['parkinson', 'dystonia', 'huntington', 'bradykines', 'dyskines'], phrases: ['essential tremor', 'restless legs'] },
    psychiatric: { stems: ['depress', 'schizophren', 'addiction'], words: ['ocd', 'ptsd'], phrases: ['obsessive-compulsive', 'anxiety disorder', 'substance use disorder', 'psychiatric neurosurgery', 'electroconvulsive', 'smoking cessation', 'opioid withdrawal'] },
    pain: { stems: ['analges', 'nocicept', 'migraine'], phrases: ['chronic pain', 'pain relief', 'neuropathic pain', 'failed back surgery', 'complex regional pain', 'fibromyalgia', 'arthritis'] },
    cognition_memory: { stems: ['alzheimer', 'dementia'], phrases: ['cognitive prosthes', 'memory prosthes', 'hippocampal prosthes', 'memory enhancement', 'memory restoration', 'working memory', 'cognitive enhancement', 'cognitive training', 'cognitive rehabilitation', 'attention monitoring', 'mild cognitive impairment'] },
    autonomic_organ: { stems: ['gastropares', 'incontinence', 'sudomotor'], phrases: ['bladder control', 'sacral neuromodulation', 'diaphragmatic pacing', 'phrenic nerve', 'autonomic dysfunction', 'gastric electrical stimulation', 'dyspepsia', 'galvanic skin'] },
    rehabilitation: { stems: ['rehabilit', 'physiotherap', 'exoskeleton'], phrases: ['gait training', 'stroke recovery', 'motor relearning', 'biofeedback', 'upper limb training'] },
    diagnostics: { stems: ['diagnos', 'electrodiagnostic', 'polysomnograph'], phrases: ['nerve conduction study', 'evoked potential testing', 'intraoperative monitoring', 'intracranial pressure monitoring', 'screening', 'brain death determination'] },
    research_tool: { phrases: ['research use only', 'preclinical', 'animal model', 'in vivo recording', 'laboratory instrument', 'optogenetic tool', 'calcium indicator', 'head-fixed', 'non-human primate'] },
    consumer_wellness: { stems: ['neurofeedback', 'meditation'], phrases: ['consumer eeg', 'focus training', 'sleep tracking', 'wellness', 'direct-to-consumer', 'over-the-counter'] },
  },
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const compile = spec => Object.fromEntries(Object.entries(spec).map(([value, s]) => [value, [
  ...(s.stems || []).map(t => new RegExp(`\\b${esc(t)}[a-z]*`, 'i')),
  ...(s.words || []).map(t => new RegExp(`\\b${esc(t)}\\b`, 'i')),
  ...(s.phrases || []).map(t => new RegExp(`\\b${esc(t)}`, 'i')),
]]))

const RULES = {
  function: compile(SPEC.function),
  access: compile(SPEC.access),
  application: compile(SPEC.application),
}

/** Facet values whose keywords appear in `text`. */
export function keywordFacets(text) {
  const t = String(text || '')
  if (!t.trim()) return { function: [], access: [], application: [] }
  const hit = rules => Object.entries(rules).filter(([, res]) => res.some(re => re.test(t))).map(([v]) => v)
  return {
    function: hit(RULES.function),
    access: hit(RULES.access),
    application: hit(RULES.application),
  }
}

// ── Exclusivity ─────────────────────────────────────────────────────────────
// `none` and `not_applicable` mean "nothing else applies", so they can never
// sit alongside another value. The schema can't express that; enforce it here.

const exclusive = (arr, sentinel) => {
  const v = [...new Set(arr)]
  if (v.length > 1) return v.filter(x => x !== sentinel)
  return v
}

export function normalizeFacets(f) {
  return {
    function: exclusive(f.function || [], 'none'),
    access: exclusive(f.access || [], 'not_applicable'),
    application: [...new Set(f.application || [])],
  }
}

/** Merge facet sets from several sources (vocabulary + keywords). */
export function mergeFacets(...sets) {
  return normalizeFacets({
    function: sets.flatMap(s => s?.function || []),
    access: sets.flatMap(s => s?.access || []),
    application: sets.flatMap(s => s?.application || []),
  })
}

export const isEmptyFacets = f =>
  !f.function.length && !f.access.length && !f.application.length

// ── Reading facets off a stored row (for the UI) ────────────────────────────

/** Pull the three stored facet arrays off a database row. */
export function facetsOfEntity(e) {
  return {
    function: e?.facet_function || [],
    access: e?.facet_access || [],
    application: e?.facet_application || [],
  }
}

/**
 * Client-side facet predicate, for the pages that filter already-loaded rows
 * (the feed, global search). Mirrors the server-side applyFacets in data.js:
 * a facet with a value must be present; empty facets pass everything.
 */
export function entityMatchesFacets(e, facets = {}) {
  const f = facetsOfEntity(e)
  const arr = v => (Array.isArray(v) ? v : v ? [v] : [])
  const ok = (sel, have) => !sel.length || sel.some(v => have.includes(v))  // OR within facet
  return ok(arr(facets.function), f.function)
    && ok(arr(facets.access), f.access)
    && ok(arr(facets.application), f.application)
}

/**
 * Short badges for a card: the derived BCI / Closed-loop badges first (they are
 * the most informative), then function labels, then applications — de-duped and
 * capped. Reads only stored columns; computes nothing.
 */
export function cardBadges(entity, max = 3) {
  const f = facetsOfEntity(entity)
  const out = [...badgesFor(f.function)]
  for (const v of f.function) {
    const label = FUNCTION_LABEL[v]
    if (label && v !== 'none' && !out.includes(label)) out.push(label)
  }
  for (const v of f.application) {
    const label = APPLICATION_LABEL[v]
    if (label && !out.includes(label)) out.push(label)
  }
  return out.slice(0, max)
}
