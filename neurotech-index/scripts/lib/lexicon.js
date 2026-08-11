/**
 * lexicon.js — the deterministic neurotech gate.
 *
 * Pure, side-effect free, and therefore testable: it lives here rather than in
 * refresh.js because refresh.js opens a Supabase client and an Anthropic client
 * at module load, so importing it from a test needs live credentials. See
 * scripts/lexicon.test.js, which encodes the headlines earlier versions of this
 * gate silently threw away.
 */

/**
 * Deterministic neurotech gate, applied to title and summary before anything is
 * sent to a model.
 *
 * Every candidate used to reach Claude, which was affordable only because the
 * fetch was capped at 80. It is not affordable at 1,300, and it was never
 * necessary: roughly half of what these feeds return is off topic in a way a
 * regex can see — general health wire copy, consumer gadgets, unrelated medical
 * news — and the relevance floor was paying a model to reach the same verdict.
 *
 * The gate is deliberately GENEROUS. It decides what is worth spending a scoring
 * call on, not what is worth publishing; that judgement stays with the model and
 * RELEVANCE_FLOOR. Anything a reasonable reader might call neurotech-adjacent
 * should pass here and be rejected downstream on the merits, because a false
 * negative here is invisible — the item is simply never seen again.
 */
export const NEUROTECH_LEXICON = new RegExp([
  // Interfaces and implants. "brain implant" and "brain chip" are here in their
  // own right, not only as part of "brain-computer interface": the first version
  // of this gate omitted the bare forms and rejected the field's flagship
  // coverage on 11 Aug 2026 — "Brain implant restores the sensation of touch in a
  // person with quadriplegia" among them — because the headline never uses the
  // compound phrase. Plain language is how press writes; match plain language.
  'brain[- ]?(computer|machine|implant|chip|interface|signal|data|wearable)',
  'neural (implant|interface|chip|probe|link|lace|dust|decod|record|prosthe|electrode|signal|data)',
  'neuro[- ]?(tech|prosthe|stimulat|modulat|device|interface|rights|data|surgical implant)',
  'intracortical', 'cortical implant', 'implantable.{0,15}(brain|neural|neuro)',
  'mind[- ]?controlled', 'thought[- ]?controlled', 'motor cortex',
  // How the press actually writes about this work when it is not using the
  // technical compound: a patient story about restored movement or speech is
  // squarely on topic and names no device. Paired terms rather than bare ones,
  // so "paralysis" alone does not pull in unrelated medicine.
  '(paraly[sz]|quadripleg|tetrapleg|locked[- ]in).{0,60}(implant|device|interface|chip|electrode|stimulat|decod|technolog)',
  '(implant|device|interface|chip|electrode|stimulat|decod).{0,60}(paraly[sz]|quadripleg|tetrapleg|locked[- ]in)',
  'brain tech', 'neural tech', 'restore[ds]? (movement|speech|touch|sensation|vision|hearing)',
  // The patient-outcome headline that names no technology at all: "Paralyzed man
  // able to move, touch again". In this corpus that is nearly always a BCI story,
  // and a false positive here costs one scoring call and is caught by the floor.
  '(paraly[sz]|quadripleg|tetrapleg).{0,50}\\b(move|moves|moving|touch|walk|speak|feel|grasp|regain)',
  // Stimulation and modulation
  'brain stimulation', 'nerve stimulation', '\\bDBS\\b',
  // "spinal cord stim tech" and "spinal cord implants" both appeared in trade
  // coverage the stricter "spinal cord stimulat" missed; the beat abbreviates.
  'spinal cord (stimulat|implant|stim\\b)', 'spinal stimulation',
  'brain circuit', 'electric(al)? stimulation', 'neural circuit',
  'vagus nerve', 'transcranial', '\\btDCS\\b', '\\btACS\\b', '\\bTMS\\b',
  'focused ultrasound', 'optogenetic', 'bioelectronic', 'closed[- ]loop (neural|stimulat|brain)',
  // Sensing and recording
  'electrocorticograph', 'electroencephalo', 'magnetoencephalo',
  '\\bECoG\\b', '\\bEEG\\b', '\\bMEG\\b', '\\bfNIRS\\b', '\\bBCI\\b', '\\bBMI\\b',
  'electrode array', 'dry electrode', 'microelectrode', 'neural recording',
  // Sensory restoration
  'cochlear implant', 'retinal implant', 'visual prosthesis', 'bionic eye',
  'auditory brainstem', 'sensory restoration',
  // Companies and labs
  'neuralink', 'synchron', 'blackrock neurotech', 'paradromics', 'precision neuroscience',
  'motif neurotech', 'onward medical', 'neuropace', 'inbrain', 'axoft', 'subsense',
  'merge labs', 'forest neurotech', 'science corporation', 'saluda', 'nevro',
  'cala health', 'neurable', 'openbci', 'emotiv', 'kernel', 'flow neuroscience',
  'neuroelectrics', 'cognixion', 'neurosoft', 'wyss center',
].join('|'), 'i')

/**
 * Sources that republish market-wire copy and mention a neurotech company only
 * as a ticker. They pass any lexicon that names companies, and they are never
 * the story. Cheaper to drop by hand than to pay a model to score them.
 */
export const WIRE_SPAM = /kalkine|tradingview|moomoo|stocktitan|stock titan|simply wall|zacks|marketbeat|insider monkey|benzinga|investing\.com|tipranks|barchart/i

/**
 * Normalise before matching. Publishers and journals set compound terms with an
 * EN DASH — "brain–computer interface" is the standard academic form — and a
 * character class of `[- ]` does not match U+2013. That one gap was rejecting a
 * whole class of the most on-topic headlines there is. Also fold whitespace so a
 * line-wrapped title matches the same as a flat one.
 */
export const normalizeForMatch = s => String(s || '')
  .replace(/[‐-―−]/g, '-')
  .replace(/\s+/g, ' ')

export const onTopicByLexicon = i => {
  if (WIRE_SPAM.test(i.source || '')) return false
  return NEUROTECH_LEXICON.test(normalizeForMatch(`${i.title || ''} ${i.summary || ''}`))
}
