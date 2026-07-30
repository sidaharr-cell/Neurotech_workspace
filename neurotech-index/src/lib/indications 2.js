/**
 * indications.js — the curated indication vocabulary.
 *
 * FrontierRecords with `axis_type: 'evidence'` record the strongest evidence
 * class for an indication ("largest randomized comparator trial in treatment
 * resistant depression, n = 200, 2024"). Trial scoring retrieves those records
 * by indication (spec section 7.1.2), so indication has to be a stable key.
 *
 * WHY NOT THE RAW ClinicalTrials.gov CONDITION FIELD. It is free text and it is
 * not deduplicated. Across the 8,345 indexed trials there are 5,420 distinct
 * condition strings, and the head of that distribution is mostly spelling
 * variants of each other: "Parkinson Disease" (397), "Parkinson's Disease"
 * (193), "Parkinson Disease (PD)" (14), "Parkinsons Disease" (6),
 * "PD - Parkinson's Disease" (8), "Parkinson&#39;s Disease (PD)" (7). Keying
 * evidence records off raw strings means a record filed under one spelling is
 * invisible to a trial that used another, and retrieval fails silently.
 *
 * The vocabulary below was seeded from that real frequency table, not written
 * from memory. Every id is one an indexed trial actually studies.
 *
 * NOT EVERY CONDITION STRING IS AN INDICATION. The field is also used for the
 * intervention ("Deep Brain Stimulation", 92 trials), the recording modality
 * ("Electroencephalography"), the population ("Healthy Volunteers"), and the
 * outcome ("Quality of Life"). NOT_AN_INDICATION names those, so the Phase 2
 * work queue can tell "this string is not an indication" apart from "the
 * vocabulary does not cover this yet". Both return null; only the second is a
 * gap worth filling.
 *
 * Matching follows the stems/words/phrases convention in facets.js, for the
 * reason that file gives: short acronyms must be whole-word matched or they
 * match inside unrelated words. `als` as a substring matches "cerebral palsy"
 * and `sci` matches "consciousness".
 *
 * Treat this file as versioned data. INDICATION_VERSION is stamped onto every
 * record so a stored indication never silently drifts when the rules change.
 */

export const INDICATION_VERSION = 'ind-1.0'

/**
 * Lowercase, unescape the HTML entities the registry sometimes emits, drop
 * possessives and punctuation, collapse whitespace. "Parkinson&#39;s Disease
 * (PD)" and "PARKINSON DISEASE (Disorder)" both reduce to a form the rules
 * below can match.
 */
export function normalizeCondition(raw) {
  return String(raw || '')
    .replace(/&#3[49];|&apos;|&quot;/g, '')
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * stems   match at a word start, any suffix   (parkinson → -s, -ism)
 * words   whole words only, no suffix         (als, sci — match inside words otherwise)
 * phrases bounded phrases
 */
const rules = s => [
  ...(s.stems || []).map(t => new RegExp(`\\b${esc(t)}[a-z]*`)),
  ...(s.words || []).map(t => new RegExp(`\\b${esc(t)}\\b`)),
  ...(s.phrases || []).map(t => new RegExp(`\\b${esc(t)}`)),
]

/**
 * Ordered, first match wins. Specific entries precede the general ones they sit
 * inside: treatment-resistant depression before depression, low back pain
 * before chronic pain, neuropathic pain before pain. Getting that order wrong is
 * the whole failure mode, so the tests assert it.
 *
 * There is deliberately no bare `pain` or bare `disorder` rule: a catch-all
 * would pull unrelated conditions ("Shoulder Pain", "Gambling Disorder") into a
 * bucket whose evidence records do not describe them.
 */
export const INDICATIONS = [
  // ── Depression, most specific first ──────────────────────────────────────
  {
    id: 'treatment_resistant_depression',
    label: 'Treatment-resistant depression',
    words: ['trd'],
    phrases: ['treatment resistant depression', 'depressive disorder treatment resistant'],
  },
  { id: 'bipolar_disorder', label: 'Bipolar disorder', stems: ['bipolar'] },
  {
    id: 'major_depressive_disorder',
    label: 'Major depressive disorder',
    stems: ['depression', 'depressive'],
    words: ['mdd'],
    phrases: ['major depressive', 'major depression'],
  },

  // ── Movement ─────────────────────────────────────────────────────────────
  {
    // Freezing of gait is a Parkinson's-specific endpoint, not a free-standing
    // indication, so it files here rather than under a gait bucket.
    id: 'parkinsons_disease',
    label: "Parkinson's disease",
    stems: ['parkinson'],
    phrases: ['freezing of gait'],
  },
  { id: 'essential_tremor', label: 'Essential tremor', phrases: ['essential tremor'] },
  { id: 'dystonia', label: 'Dystonia', stems: ['dystonia'] },
  { id: 'huntingtons_disease', label: "Huntington's disease", stems: ['huntington'] },
  { id: 'tourette_syndrome', label: 'Tourette syndrome', stems: ['tourette'] },
  { id: 'spasticity', label: 'Spasticity', stems: ['spasticity', 'spastic'] },

  // ── Neurodegenerative and cognitive ──────────────────────────────────────
  {
    id: 'amyotrophic_lateral_sclerosis',
    label: 'Amyotrophic lateral sclerosis',
    words: ['als'],
    phrases: ['amyotrophic lateral sclerosis', 'motor neuron disease'],
  },
  { id: 'alzheimers_disease', label: "Alzheimer's disease", stems: ['alzheimer'] },
  {
    id: 'mild_cognitive_impairment',
    label: 'Mild cognitive impairment',
    words: ['mci'],
    phrases: ['mild cognitive impairment', 'cognitive impairment',
      'cognitive dysfunction', 'cognitive decline'],
  },
  { id: 'dementia', label: 'Dementia', stems: ['dementia'] },
  { id: 'multiple_sclerosis', label: 'Multiple sclerosis', phrases: ['multiple sclerosis'] },

  // ── Injury and paralysis ─────────────────────────────────────────────────
  {
    id: 'spinal_cord_injury',
    label: 'Spinal cord injury',
    words: ['sci'],
    phrases: ['spinal cord injur', 'spinal cord diseases', 'cervical myelopathy'],
  },
  {
    id: 'tetraplegia',
    label: 'Tetraplegia',
    stems: ['tetraplegia', 'tetrapares', 'quadriplegia', 'quadraplegia'],
  },
  { id: 'paraplegia', label: 'Paraplegia', stems: ['paraplegia'] },
  {
    // Kept separate from tetraplegia and paraplegia: the registry uses the bare
    // term for injuries whose level and completeness are not stated.
    id: 'paralysis',
    label: 'Paralysis',
    stems: ['paralysis', 'paralyzed'],
  },
  {
    id: 'spinal_muscular_atrophy',
    label: 'Spinal muscular atrophy',
    phrases: ['spinal muscular atrophy'],
  },
  { id: 'locked_in_syndrome', label: 'Locked-in syndrome', phrases: ['locked in syndrome'] },
  {
    id: 'stroke',
    label: 'Stroke',
    stems: ['stroke', 'hemipares', 'hemiplegi'],
    phrases: ['cerebrovascular accident', 'cerebral infarction', 'intracerebral hemorrhage'],
  },
  {
    id: 'traumatic_brain_injury',
    label: 'Traumatic brain injury',
    words: ['tbi'],
    phrases: ['traumatic brain injury', 'brain injuries traumatic',
      'acquired brain injury', 'brain injur'],
  },
  { id: 'cerebral_palsy', label: 'Cerebral palsy', phrases: ['cerebral palsy'] },
  { id: 'aphasia', label: 'Aphasia', stems: ['aphasia'] },
  { id: 'dysphagia', label: 'Dysphagia', stems: ['dysphagia'] },
  { id: 'dysarthria', label: 'Dysarthria', stems: ['dysarthria'] },
  {
    id: 'disorders_of_consciousness',
    label: 'Disorders of consciousness',
    phrases: ['disorder of consciousness', 'disorders of consciousness',
      'consciousness disorders', 'vegetative state', 'minimally conscious state'],
  },
  { id: 'amputation', label: 'Amputation', stems: ['amputation', 'amputee'] },

  // ── Epilepsy ─────────────────────────────────────────────────────────────
  { id: 'epilepsy', label: 'Epilepsy', stems: ['epilep', 'seizure'] },

  // ── Pain, most specific first ────────────────────────────────────────────
  {
    id: 'neuropathic_pain',
    label: 'Neuropathic pain',
    stems: ['neuralgia', 'radiculopathy'],
    phrases: ['neuropathic pain', 'pain neuropathic', 'diabetic neuropath',
      'peripheral neuropathy', 'chemotherapy induced peripheral neuropathy'],
  },
  { id: 'phantom_limb_pain', label: 'Phantom limb pain', phrases: ['phantom limb'] },
  {
    id: 'complex_regional_pain_syndrome',
    label: 'Complex regional pain syndrome',
    phrases: ['complex regional pain'],
  },
  {
    id: 'low_back_pain',
    label: 'Low back pain',
    phrases: ['low back pain', 'back pain', 'pain back', 'failed back surgery'],
  },
  { id: 'migraine', label: 'Migraine', stems: ['migraine'] },
  { id: 'cluster_headache', label: 'Cluster headache', phrases: ['cluster headache'] },
  { id: 'fibromyalgia', label: 'Fibromyalgia', stems: ['fibromyalgia'] },
  {
    id: 'chronic_pain',
    label: 'Chronic pain',
    phrases: ['chronic pain', 'pain chronic', 'intractable pain', 'pain intractable'],
  },

  // ── Psychiatric ──────────────────────────────────────────────────────────
  {
    id: 'obsessive_compulsive_disorder',
    label: 'Obsessive-compulsive disorder',
    words: ['ocd'],
    phrases: ['obsessive compulsive'],
  },
  {
    id: 'schizophrenia',
    label: 'Schizophrenia',
    stems: ['schizophreni', 'schizoaffective'],
  },
  {
    id: 'post_traumatic_stress_disorder',
    label: 'Post-traumatic stress disorder',
    words: ['ptsd'],
    phrases: ['post traumatic stress', 'posttraumatic stress',
      'stress disorders post traumatic'],
  },
  { id: 'anxiety_disorder', label: 'Anxiety disorder', stems: ['anxiet'] },
  { id: 'autism_spectrum_disorder', label: 'Autism spectrum disorder', stems: ['autis'] },
  {
    id: 'adhd',
    label: 'Attention deficit hyperactivity disorder',
    words: ['adhd'],
    phrases: ['attention deficit'],
  },
  { id: 'anorexia_nervosa', label: 'Anorexia nervosa', stems: ['anorexia'] },
  {
    id: 'suicidal_ideation',
    label: 'Suicidal ideation',
    phrases: ['suicidal ideation', 'suicide'],
  },
  {
    id: 'substance_use_disorder',
    label: 'Substance use disorder',
    stems: ['addiction'],
    phrases: ['opioid use', 'opioid withdrawal', 'alcohol use disorder',
      'substance use', 'nicotine dependence', 'tobacco use disorder',
      'cannabis use disorder', 'gambling disorder'],
  },

  // ── Sensory ──────────────────────────────────────────────────────────────
  {
    id: 'hearing_loss',
    label: 'Hearing loss',
    stems: ['deafness', 'presbycusis'],
    phrases: ['hearing loss', 'hearing impair', 'hearing disability', 'hearing disorders'],
  },
  { id: 'tinnitus', label: 'Tinnitus', stems: ['tinnitus'] },
  { id: 'retinitis_pigmentosa', label: 'Retinitis pigmentosa', phrases: ['retinitis pigmentosa'] },
  {
    id: 'macular_degeneration',
    label: 'Macular degeneration',
    stems: ['stargardt', 'choroideremia'],
    phrases: ['macular degeneration', 'geographic atrophy', 'retinal degeneration'],
  },
  {
    id: 'blindness',
    label: 'Blindness and low vision',
    stems: ['blindness'],
    phrases: ['visual impairment', 'vision disorders'],
  },

  // ── Autonomic and organ ──────────────────────────────────────────────────
  {
    id: 'neurogenic_bladder',
    label: 'Neurogenic bladder',
    phrases: ['neurogenic bladder', 'bladder dysfunction'],
  },
  {
    id: 'overactive_bladder',
    label: 'Overactive bladder',
    words: ['oab'],
    phrases: ['overactive bladder', 'urge incontinence', 'urinary incontinence',
      'urinary retention'],
  },
  {
    id: 'neurogenic_bowel',
    label: 'Neurogenic bowel',
    phrases: ['neurogenic bowel', 'fecal incontinence', 'bowel dysfunction'],
  },
  { id: 'gastroparesis', label: 'Gastroparesis', stems: ['gastroparesis'] },
  { id: 'obstructive_sleep_apnea', label: 'Obstructive sleep apnea', phrases: ['sleep apnea'] },
  { id: 'insomnia', label: 'Insomnia', stems: ['insomnia'] },
  { id: 'heart_failure', label: 'Heart failure', phrases: ['heart failure'] },
  {
    id: 'autonomic_dysfunction',
    label: 'Autonomic dysfunction',
    phrases: ['autonomic dysfunction', 'autonomic dysreflexia', 'orthostatic hypotension',
      'autonomic nervous system imbalance'],
  },
  { id: 'obesity', label: 'Obesity', stems: ['obesity'] },
]

/**
 * Condition strings naming an intervention, modality, population, or outcome
 * rather than a disease. Checked AFTER the vocabulary, never before: "Cochlear
 * Hearing Loss" is a real indication and "Stroke Rehabilitation" is a real
 * indication, and a reject-first order would discard both.
 */
export const NOT_AN_INDICATION = [
  // study population
  { stems: ['healthy', 'volunteer'], phrases: ['normal physiology', 'healthy aging'] },
  // intervention
  {
    stems: ['neuromodulation', 'neurostimulation', 'rtms', 'tdcs', 'tacs',
      'anesthesia', 'analgesia', 'vitrectomy', 'neurorehabilitation', 'rehabilitation'],
    phrases: ['deep brain stimulation', 'transcranial magnetic stimulation',
      'transcranial direct current stimulation', 'transcranial alternating current',
      'spinal cord stimulation', 'vagus nerve stimulation', 'vagal nerve stimulation',
      'brain stimulation', 'electric stimulation therapy', 'cochlear implant',
      'pain management', 'smoking cessation'],
  },
  // modality and measurement
  {
    words: ['eeg', 'emg'],
    stems: ['electroencephalography'],
    phrases: ['magnetic resonance imaging', 'cortical excitability',
      'heart rate variability', 'blood pressure'],
  },
  // outcome, not disease
  {
    stems: ['aging', 'fatigue', 'craving'],
    phrases: ['quality of life', 'working memory', 'motor activity', 'sleep quality'],
  },
]

export const INDICATION_IDS = INDICATIONS.map(i => i.id)
export const INDICATION_LABEL = Object.fromEntries(INDICATIONS.map(i => [i.id, i.label]))
export const isIndication = id => INDICATION_IDS.includes(id)

// Compiled once at module load, like the facet spec.
const COMPILED = INDICATIONS.map(i => ({ id: i.id, res: rules(i) }))
const REJECT = NOT_AN_INDICATION.flatMap(rules)

/** True when the string names an intervention, modality, population, or outcome. */
export function isNotAnIndication(condition) {
  const n = normalizeCondition(condition)
  return !!n && REJECT.some(re => re.test(n))
}

/**
 * The indication a single ClinicalTrials.gov condition string names, or null if
 * it names something that is not an indication or nothing the vocabulary covers.
 * Null is a supported outcome: an uncovered condition is a work queue entry for
 * the vocabulary, not a reason to guess. Use isNotAnIndication to tell the two
 * kinds of null apart.
 */
export function indicationFor(condition) {
  const n = normalizeCondition(condition)
  if (!n) return null
  const hit = COMPILED.find(c => c.res.some(re => re.test(n)))
  if (hit) return hit.id
  return null
}

/** Distinct indications named by a trial's `metadata.conditions` array. */
export function indicationsFor(conditions = []) {
  const out = []
  for (const c of conditions) {
    const id = indicationFor(c)
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}
