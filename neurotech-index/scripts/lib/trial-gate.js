/**
 * trial-gate.js — the deterministic topical gate for clinical trials.
 *
 * Pure and side-effect free, so it is testable without live credentials, and it
 * costs nothing to run: no model call, no API. See trial-gate.test.js.
 *
 * WHY THIS EXISTS. `fetchTrials` asks ClinicalTrials.gov for 16 neurotech terms
 * and stored everything the registry returned. `query.term` is a full-text
 * search with synonym expansion, so "neural implant" also returns intravitreal
 * eye implants, "neuraxial" returns obstetric anesthesia, and "implant" returns
 * dental work. Nothing rejected them: `trialScore` only DOWN-RANKED a trial with
 * no device-class tag (topical 0.4), which lowers its position and still puts it
 * in the index. 18% of the table — 1,521 of 8,380 trials on 13 Aug 2026 — was
 * off topic, including "A Multidisciplinary Intervention in Total Knee
 * Arthroplasty", whose only match was the CBT in its intervention arm.
 *
 * WHY IT IS TWO RULES, NOT ONE. The device-class tags already computed at ingest
 * are the obvious gate, and they are not enough on their own: 352 trials carry
 * no tag and are squarely in scope — TENS, tSCS, percutaneous and peripheral
 * nerve stimulation, non-invasive VNS, powered braces. A tag-only rule deletes
 * all of them. So a trial is kept if it has a device-class tag OR matches the
 * lexicon here, and both read the registry's structured fields (interventions
 * and conditions), not just the title, because that is where a trial names the
 * thing being tested.
 *
 * The gate is STRICTER than the news lexicon, and deliberately so. The news gate
 * decides what is worth paying a model to score, so a false negative there is
 * cheap and invisible; this one decides what is in the index a reader browses,
 * where a false positive is visible on the page. It is still built to keep when
 * in doubt — an off-topic trial ranks low and is mildly embarrassing, a missing
 * one is a hole in the index nobody can see.
 */
import { DEVICE_CLASSES } from '../../src/lib/taxonomy.js'

/**
 * Neurotech signals in a trial record. Written against the language registries
 * use — a protocol says "transcutaneous electrical nerve stimulation", never
 * "neurotech" — and every entry here is load-bearing for a real trial that the
 * device-class tags miss; see the test file for the ones each clause rescues.
 */
export const TRIAL_NEUROTECH = new RegExp([
  // Interfaces, implants, recording.
  'brain[- ]?(computer|machine|implant|chip|interface)',
  'neural (implant|interface|prosthe|probe|electrode|decod|recording|bypass)',
  'neuro[- ]?(tech|prosthe|stimulat|modulat|feedback)',
  'intracortical', 'electrocorticograph', '\\becog\\b', '\\bbci\\b',
  'microelectrode array', 'utah array',
  // Stimulation, the largest family and the one tags most often miss. "nerve
  // stimulation" is kept unqualified: peripheral, sacral, tibial and hypoglossal
  // nerve trials are neurotechnology whether or not the nerve is cranial.
  'nerve stimulation', 'neurostimulat', 'neuromodulat',
  'deep brain stimulation', '\\bdbs\\b', 'brain stimulation',
  // DBS by target rather than by name: a Parkinson's protocol says "subthalamic
  // stimulation", and five STN/GPi trials were dropped before this was here.
  'subthalamic', '\\bstn\\b', 'globus pallidus', '\\bgpi\\b',
  'spinal cord stimulation', 'epidural stimulation', '\\bt?scs\\b',
  'transcranial', '\\btms\\b', '\\btdcs\\b', '\\btacs\\b', '\\btrns\\b',
  // Theta-burst is a TMS protocol and is almost never spelled out as TMS: 20
  // trials, including whole accelerated-TBS depression programmes, were dropped.
  'theta[- ]?burst', '\\b[a-z]{0,2}tbs\\b',
  'vagus nerve', 'vagal nerve', '\\bt?vns\\b', 'hypoglossal',
  'electrical stimulation', 'electrostimulation', '\\btens\\b', '\\bfes\\b',
  'percutaneous (electrical )?nerve stimulation', 'nerve implant',
  // PENS and PNS are worth the bare abbreviation: all 10 and all 23 trials
  // carrying them are percutaneous and peripheral nerve stimulation, and some
  // name the modality no other way.
  '\\bpens\\b', '\\bpns\\b', 'tonic motor activation', '\\btomac\\b',
  'implantable [a-z ]{0,20}stimulat',
  'current stimulation', 'magnetic stimulation', 'ultrasound neuromodulation',
  'implanted (pulse generator|stimulator|electrode|lead)', 'stimulator implant',
  // Pacing a nerve to drive a muscle — NeuRx and its kin. Scoped to the phrenic
  // and diaphragm so an ordinary cardiac pacemaker trial does not match.
  '(diaphragm|diaphragmatic|phrenic)[a-z]* (pacing|pacer|pacemaker|stimulat)',
  // Focused ultrasound counts only in a neuro target; the same technique treats
  // fibroids and prostates, and those trials are not neurotechnology.
  '\\blifu\\b', 'focused ultrasound[^.]{0,60}(brain|cortex|thalam|neuro|tremor)',
  '(cortical|corticospinal) (excitability|inhibition|stimulation|mapping|plasticity)',
  // Sensory restoration and prosthetics.
  'cochlear implant', 'auditory brainstem implant', 'retinal (implant|prosthe)',
  'subretinal implant', 'photovoltaic[^.]{0,30}implant', 'artificial vision',
  'bionic (eye|vision)', 'visual prosthe', 'sensory (restoration|substitution)',
  'neuroprosthe', 'myoelectric', 'exoskeleton', 'powered (brace|orthosis)',
  // "Prosthetic" alone is mostly dental and limb work. Bind it to a neuro word
  // immediately before it, which keeps "neuromotor prosthetic" and
  // "cognitive-based prosthetics" without taking tooth replacement with them.
  '(neuro|neural|neuromotor|cognitive)[a-z-]{0,10} ?prosthe',
  'functional electrical stimulation',
  // Last resort: devices whose registry entry names the brand and nothing else,
  // so no generic clause above can see them. Keep this list short — a brand list
  // rots, and anything that can be caught by modality should be caught there.
  '\\bmyndmove\\b', '\\breactiv8\\b',
  // Signal acquisition used as the intervention or endpoint.
  '\\beeg\\b', 'electroencephalograph', '\\bemg\\b(?!.{0,20}\\bdiagnos)',
  'neurofeedback', 'brain[- ]?monitoring', '\\bfnirs\\b',
].join('|'), 'i')

/**
 * Families that match a neurotech word by accident and are never in scope —
 * "peri-implant" dental tissue and "intravitreal implant" both borrow "implant"
 * from an unrelated speciality. Only consulted for a trial kept on a tag alone;
 * an explicit lexicon match outranks it.
 */
export const TRIAL_OFF_TOPIC = new RegExp([
  'intravitreal', 'peri[- ]?implant(itis|\\b(?!ed))', 'dental implant',
  'breast implant', 'cochlear implant recipients? satisfaction survey',
  'neuraxial (anesthesia|anaesthesia|block)', 'penile implant', 'contact lens',
].join('|'), 'i')

/** Everything a trial says about itself, lowercased for matching. */
export const trialHaystack = t => [
  t.title, t.summary,
  ...(t.interventions || t.metadata?.interventions || []),
  ...(t.conditions || t.metadata?.conditions || []),
].filter(Boolean).join(' ').replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').toLowerCase()

/** Device-class tags for a trial, from the ingest's own taxonomy. */
export const trialTags = t => {
  const h = trialHaystack(t)
  return DEVICE_CLASSES.filter(c => c.match.some(m => h.includes(m))).map(c => c.id)
}

/**
 * Is this trial neurotechnology? `tags` may be passed in when the caller already
 * computed them at ingest.
 *
 * The lexicon outranks everything: its terms are explicit and unambiguous, so a
 * trial naming one is in scope even if it also reads as another speciality — the
 * bionic breast neuroprosthesis trial matches "breast implant" and is still
 * neurotechnology.
 *
 * A device-class tag is a weaker signal, because those match plain substrings:
 * "retinal" makes every intravitreal dexamethasone trial look like a retinal
 * implant, and 73 ophthalmology trials were kept on exactly that before the
 * off-topic families were allowed to overrule a tag.
 */
export function onTopicTrial(trial, tags = null) {
  const hay = trialHaystack(trial)
  if (TRIAL_NEUROTECH.test(hay)) return true
  const tagged = (tags ?? trial.topics ?? trialTags(trial)).length > 0
  return tagged && !TRIAL_OFF_TOPIC.test(hay)
}
