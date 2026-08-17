/**
 * scope.js — does an organization belong in an index of neurotechnology
 * COMPANIES?
 *
 * Pure and tested. It never decides anything on its own: it produces a reason to
 * look, and a person decides. Deleting an index entry is a judgement about the
 * world, exactly like asserting a funding figure, and this file is the same
 * shape as the lexicon gate — deliberately generous, because a false flag costs
 * a glance and a false clear costs nothing at all.
 *
 * The rule it tests against is INCLUSION_RULE in src/lib/fundingBoard.js:
 * companies whose PRIMARY PRODUCT interfaces with, measures, or modulates the
 * nervous system.
 *
 * Three ways a row fails that while still being a real organization, all found
 * in live data on 15 Aug 2026:
 *
 *   not a company        Society for Neuroscience is a professional society and
 *                        sorts as the third-oldest "company" in the index.
 *   not a product        ApexNeuro is a neurorehabilitation clinic in
 *                        Manchester: six employees, Trustpilot patient reviews.
 *                        It treats patients; it does not make anything.
 *   not neurotech        BrainCom at braincom.fr is a strategic-communications
 *                        agency. The neurotech BrainCom is an EU research
 *                        project at a different domain entirely.
 */

/**
 * Non-commercial bodies. A society or a funder is not a company.
 *
 * These match the NAME, or a self-description ("is a clinic"), and never a
 * passing mention. Ceribell describes a "device deployed in hospital emergency
 * departments" and is a device maker; a rule that fires on the word "hospital"
 * anywhere would call it a hospital, which is the first thing this test caught.
 */
const NOT_A_COMPANY = [
  [/\b(society|association|federation|consortium|foundation|charity)\b/i, 'reads as a society, association or charity'],
  [/\b(universit(?:y|é|à|ät)|college|school of medicine|faculty)\b/i, 'reads as a university or faculty'],
  // Whole words only. Without the trailing boundary "clinic" matches
  // "clinical-stage company" and "sleep clinicians", which flagged Cognito
  // Therapeutics and Ensodata as hospitals.
  [/\b(hospitals?|clinics?|medical cent(?:er|re)s?|health system|nhs trust)\b/i, 'reads as a hospital or clinic'],
  [/\b(ministry|national institutes?|research council)\b/i, 'reads as a public body'],
]

/** Service businesses. Real companies, but what they sell is labour. */
const NOT_A_PRODUCT = [
  [/(rehabilitation|rehab|physiotherapy|physical therapy|chiropract|counselling|counseling|psychotherapy)\s+(clinic|practice|cent(?:er|re)|services?)/i, 'reads as a treatment practice rather than a product'],
  [/(marketing|advertising|communications?|branding|public relations|creative)\s+(agency|consultancy|firm|studio)/i, 'reads as an agency'],
  [/(recruitment|staffing|law firm|accounting|insurance broker)/i, 'reads as a professional services firm'],
  [/(distributor|reseller|importer|wholesaler)/i, 'reads as a distributor rather than a maker'],
]

/**
 * Words that show the organization's own subject is the nervous system.
 *
 * Deliberately broad, and this is the generous half of the test: it decides
 * whether a row is worth a human glance, not whether it is worth publishing.
 * A row that matches nothing here is flagged, not removed.
 */
const NEURO_SUBJECT =
  // STEMS, unanchored at the front on purpose. "intracortical" and
  // "microelectrode" are the words a neurotech company actually uses, and a
  // leading \b made Paradromics — an intracortical microelectrode array — read
  // as having nothing to do with the nervous system.
  /(neuro|neural|neuron|brain|cortic|cortex|cerebr|\beeg\b|\bemg\b|\becog\b|\bmeg\b|fnirs|\bbci\b|\bbmi\b|spinal|nerve|vagus|epilep|parkinson|alzheimer|dementia|stroke|concussion|\btbi\b|seizure|sleep|cognit|psychiatr|depress|tinnitus|prosthe|implant|stimulat|electrophysiolog|bioelectronic)/i

/** Anything that is plainly a device, a diagnostic or software. Plurals count:
 *  "develops implantable devices" is a product sentence and an earlier version
 *  of this pattern missed it for the sake of one letter. */
const MAKES_SOMETHING =
  // Also unanchored at the front, so "microelectrode" and "neurostimulator"
  // count as product nouns.
  /(devices?|implants?|electrodes?|headsets?|wearables?|sensors?|scanners?|imaging|software|platforms?|algorithms?|\bapps?\b|systems?|stimulators?|monitors?|diagnostics?|therapeutics?|prosthes[ei]s|robots?|chips?|arrays?|catheters?|interfaces?|\btools?\b|products?|medicine)\b/i

/**
 * Reasons this row may not belong. Empty means nothing to look at.
 *
 * @param {object} org  { name, description, website }
 * @returns {string[]}  human-readable reasons, most specific first
 */
export function scopeFlags(org = {}) {
  const name = String(org.name || '').trim()
  const description = String(org.description || '').trim()
  // Nothing to read is its own answer, and a different one from "off topic".
  if (!description) return ['no description to judge from']
  const text = `${name}. ${description}`

  /**
   * Is this what the organization IS, rather than something it mentions?
   * True when the word is in its name, or when the description says so of
   * itself: "is a clinic", "a leading distributor", and the like.
   */
  const isItself = re => {
    if (re.test(name)) return true
    const src = re.source
    return new RegExp(`\\b(?:is|as)\\s+(?:a|an|the)\\s+[^.]{0,40}?${src}`, 'i').test(description)
      // Or it opens the description, which is how these rows describe
      // themselves: "Distributor of EEG electrodes", "Leading rehabilitation
      // clinic". Two words of run-up at most, so a word appearing later in a
      // normal sentence cannot trigger it — Ceribell's "hospital" is six words
      // in and stays clear.
      || new RegExp(`^(?:[a-z]+\\s+){0,2}${src}`, 'i').test(description)
  }

  const flags = []
  for (const [re, why] of NOT_A_COMPANY) if (isItself(re)) { flags.push(why); break }
  for (const [re, why] of NOT_A_PRODUCT) if (isItself(re)) { flags.push(why); break }

  if (!NEURO_SUBJECT.test(text)) {
    flags.push('the stored description never mentions the nervous system')
  } else if (!MAKES_SOMETHING.test(text)) {
    // On topic but with no product noun anywhere: often a clinic or a lab.
    flags.push('on topic, but nothing in the description names a product')
  }
  return flags
}

/** How hard to look. `review` is worth a person's time; `check` is a nudge. */
export function scopeVerdict(org = {}) {
  const flags = scopeFlags(org)
  if (!flags.length) return { verdict: 'in_scope', flags }
  /**
   * What the row IS, or a description with nothing of the subject in it, earns a
   * person's time. Being vague about the product alone is only a nudge.
   *
   * Setpoint Medical is why the vocabulary above had to grow rather than this
   * threshold: it makes a vagus nerve stimulator and calls itself
   * "bioelectronic medicine for chronic autoimmune diseases", which is true, on
   * topic, and used none of the obvious words. The answer was to recognise the
   * words it does use, not to stop flagging companies that mention nothing.
   */
  const strong = flags.some(f =>
    /society|university|hospital|public body|agency|professional services|distributor|practice/.test(f))
  const offTopic = flags.some(f => /never mentions the nervous system/.test(f))
  return { verdict: strong || offTopic ? 'review' : 'check', flags }
}
