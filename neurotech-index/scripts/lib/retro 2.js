/**
 * retro.js — the retro-holdout, spec section 12.
 *
 * The filter cannot be validated against ground truth, because ground truth
 * arrives in five years. This is the closest available substitute: score a
 * 2016-2019 corpus against 2016 field state and see whether the top decile
 * contains what actually mattered.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OPEN DECISION 3, AND WHY THE MODEL DOES NOT AUTHOR THE REFERENCE LIST
 *
 * The spec: "Self-constructing it introduces exactly the bias the test is meant
 * to detect. Dr. Amadio or another domain expert building it blind to the scores
 * would be materially stronger evidence."
 *
 * That is correct and it is not negotiable. A model asked which 2017 papers
 * mattered is answering from the same knowledge that leaks into scoring; spec 12
 * says so directly ("The model knows what happened to adaptive DBS, to
 * Neuralink, and to Stentrode"). The answer key would be written by the thing
 * under test.
 *
 * So the reference list here is built from OUTCOMES THAT POSTDATE THE WINDOW AND
 * WERE DECIDED BY OTHER PARTIES. Three signals, none of them an opinion:
 *
 *   1. regulatory   a device linked to the item cleared or approved AFTER 2019.
 *                   The FDA decided this, not us, and not during the window.
 *   2. record       the item still holds a frontier record in 2026. The field's
 *                   best on that axis is still this. Our record layer was built
 *                   by mining reported values, never by judging importance.
 *   3. pivotal      a Phase 3 or 4 window trial that completed AND posted
 *                   results. Deliberately NOT "any completed trial": that
 *                   selects 21% of window trials and measures finishing rather
 *                   than mattering, which would have produced a recall number
 *                   that looked like a pass and meant nothing.
 *
 * WHAT THIS IS NOT. It is a proxy for expert judgement, not a replacement. It
 * can only see what left an institutional trace, so it is biased toward
 * commercialised and regulated work and blind to a method that quietly became
 * standard without a device attached. A domain expert's list would be strictly
 * better and should replace this if one becomes available. That limitation is
 * reported with every result rather than filed away.
 *
 * The list is FROZEN AND HASHED before any score is read, which is spec 12 step
 * 5: "constructed before anyone sees the scores".
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { createHash } from 'node:crypto'

export const WINDOW = { start: 2016, end: 2019 }
export const BASELINE_AS_OF = '2016-01-01'

// ── Entity stripping, spec 12 step 3 ────────────────────────────────────────
// "Strip identifying context: authors, affiliations, venue, funder, company
// names. Replace named entities in body text with role placeholders where
// feasible."
//
// Leakage is real and only partly mitigable: a distinctive method is
// identifiable from its description alone. This reduces the obvious channel; it
// does not close it, and the result is evidence rather than proof.

/** Organisation and product names that identify a programme on sight. */
const IDENTIFYING_NAMES = [
  'neuralink', 'synchron', 'stentrode', 'blackrock', 'braingate', 'paradromics',
  'kernel', 'openwater', 'ctrl-labs', 'facebook', 'meta', 'google', 'verily',
  'medtronic', 'boston scientific', 'abbott', 'livanova', 'nevro', 'axonics',
  'inbrain', 'precision neuroscience', 'motif neurotech', 'science corp',
  'cochlear limited', 'advanced bionics', 'med-el', 'second sight', 'pixium',
  'neuropace', 'saluda', 'onward', 'neurosoft', 'wyss center', 'battelle',
  'darpa', 'nih', 'nihr', 'wellcome', 'howard hughes',
]

const ROLE = '[ORGANISATION]'

/**
 * Strip identifying context from an item before it is scored.
 * Returns the stripped copy plus a count of what was removed, so a run can
 * report how much leakage channel it actually closed.
 */
export function stripIdentity(item) {
  const removed = []
  const scrub = s => {
    let out = String(s ?? '')
    for (const name of IDENTIFYING_NAMES) {
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\b`, 'gi')
      if (re.test(out)) { removed.push(name); out = out.replace(re, ROLE) }
    }
    return out
  }
  return {
    item: {
      ...item,
      title: scrub(item.title),
      abstract: scrub(item.abstract),
      summary: scrub(item.summary),
      description: scrub(item.description),
      // Dropped outright rather than scrubbed: these are pure identity.
      authors: undefined,
      journal: undefined,
      affiliation: undefined,
      sponsor: undefined,
      manufacturer: undefined,
    },
    removed: [...new Set(removed)],
  }
}

// ── Reference list construction ─────────────────────────────────────────────

/** Did this item's year fall inside the holdout window? */
export const inWindow = year => Number(year) >= WINDOW.start && Number(year) <= WINDOW.end

/**
 * Build the positive reference list from external, post-window outcomes.
 * Every entry states WHICH signal put it there, so a reader can disagree with a
 * specific inclusion rather than with the list as a whole.
 *
 * @param items          window items, each { id, item_type, year, ... }
 * @param signals        { recordHolders:Set, approvedAfterWindow:Set, resultsPosted:Set }
 */
export function buildReferenceList(items, signals) {
  const out = []
  for (const it of items) {
    const reasons = []
    if (signals.recordHolders?.has(it.id)) reasons.push('still holds a 2026 frontier record')
    if (signals.approvedAfterWindow?.has(it.id)) reasons.push('linked device cleared or approved after 2019')
    if (signals.pivotalReadouts?.has(it.id)) reasons.push('Phase 3/4 trial completed with results posted')
    if (reasons.length) out.push({ id: it.id, item_type: it.item_type, year: it.year, reasons })
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1))
}

/**
 * Build the NEGATIVE set: window items that received heavy attention and did not
 * pan out. Spec 12 calls this "more diagnostic than the positive case because it
 * targets hype correlation directly", and says to run it first under constraint.
 *
 * IMPORTANT LIMITATION. Spec 12 wants items "that received heavy attention",
 * meaning press and field excitement. This corpus contains NO indexed media
 * coverage for 2016-2019: all 1,648 window feed rows are trial registrations.
 * So attention is proxied by the OLD SORT'S OWN RANKING, the frozen
 * legacy_significance. That still asks a real and useful question, "do the
 * previous ranking's favourites survive the new one", but it is a structural
 * score built from phase, status and enrollment rather than a rhetorical one,
 * so it is a WEAKER hype probe than the spec intends. Report it as such.
 *
 * Using the old score to select a test set is legitimate: spec 2 forbids
 * attention as an input to the NEW score, not as a way to choose what to test.
 */
export function buildNegativeSet(items, signals, attention) {
  const out = []
  for (const it of items) {
    if (!attention.has(it.id)) continue
    const panned = signals.recordHolders?.has(it.id)
      || signals.approvedAfterWindow?.has(it.id)
      || signals.pivotalReadouts?.has(it.id)
    if (!panned) out.push({ id: it.id, item_type: it.item_type, year: it.year, reason: 'covered at the time, no subsequent outcome' })
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1))
}

/**
 * Freeze a list so it cannot be edited after the scores are seen. The hash
 * covers the ids only, so adding, removing or swapping an entry changes it.
 */
export function freeze(list) {
  const ids = list.map(e => e.id).sort()
  return {
    count: ids.length,
    hash: createHash('sha256').update(ids.join('\n')).digest('hex').slice(0, 16),
    frozen_ids: ids,
  }
}

/** Verify a list still matches the hash it was frozen with. */
export function verifyFrozen(list, frozen) {
  return freeze(list).hash === frozen.hash
}

/**
 * Recall of the reference list within the top decile.
 * Spec 12: "Primary metric is recall, not precision. A top decile containing all
 * five items that mattered plus fifteen that did not is a success. A
 * high-precision top decile that misses two is a failure."
 */
export function recallAtDecile(rankedIds, referenceIds) {
  const n = Math.max(1, Math.ceil(rankedIds.length / 10))
  const top = new Set(rankedIds.slice(0, n))
  const ref = [...new Set(referenceIds)]
  const found = ref.filter(id => top.has(id))
  return {
    decileSize: n,
    referenceCount: ref.length,
    found: found.length,
    recall: ref.length ? found.length / ref.length : null,
    missed: ref.filter(id => !top.has(id)),
  }
}

/**
 * The negative case result. The system should NOT rank these highly, so the
 * number to watch is how many reached the top decile.
 */
export function negativeAtDecile(rankedIds, negativeIds) {
  const n = Math.max(1, Math.ceil(rankedIds.length / 10))
  const top = new Set(rankedIds.slice(0, n))
  const neg = [...new Set(negativeIds)]
  const inTop = neg.filter(id => top.has(id))
  return {
    decileSize: n,
    negativeCount: neg.length,
    inTopDecile: inTop.length,
    rate: neg.length ? inTop.length / neg.length : null,
    offenders: inTop,
  }
}
