/**
 * validate.js — spec section 8. The checks ON the model.
 *
 * "These MUST run as code, not as model instructions, because they are the
 * checks on the model." Pure functions, no I/O, no model call.
 *
 * Every reset is logged with the item id, the rule number and the original
 * value, because spec 8 makes reset rates a monitoring signal: "a rising rate on
 * rule 1 or 3 means the model is drifting toward unanchored judgment."
 *
 * These are checked against scripts/data/section8-cases.json, which was written
 * from the spec text BEFORE this file existed. 17 of its 43 cases require a
 * validator NOT to fire, because a validator that resets everything passes every
 * positive case and destroys the sort.
 */

const DIMENSIONS = ['FD', 'LV', 'TR', 'GAP', 'GATE', 'METH']

/** Referents that point at nothing checkable. Rule 1 says empty OR GENERIC. */
const GENERIC_REFERENTS = [
  'the study', 'the paper', 'the work', 'the results', 'the data', 'the device',
  'the trial', 'the authors', 'this study', 'this paper', 'this work', 'n/a',
  'not stated', 'unknown', 'the abstract', 'the item', 'various', 'several',
]

/** Named verbatim in rule 3, plus the obvious near-neighbours. */
const GENERIC_UNLOCKS = [
  'advance the field', 'advances the field', 'help patients', 'helps patients',
  'improve outcomes', 'improves outcomes', 'benefit patients', 'benefits patients',
  'advance research', 'improve care', 'improve treatment', 'further research',
]

/** Evidence grades in rank order, weakest first. Rule 6 needs an ORDER, not a set. */
const GRADE_RANK = {
  'announced-only': 0, 'claimed-only': 0,
  exploratory: 1,
  indicative: 2,
  partial: 2,
  strong: 3,
  demonstrated: 4,
  decisive: 4,
  replicated: 5,
}
const DEMONSTRATED_RANK = GRADE_RANK.demonstrated

/**
 * Rubric vocabulary, rule 7. Each pattern is deliberately narrow.
 *
 * `leverage` is matched as a bare noun only. The word boundary means it does not
 * match "leverages" or "leveraging", so "the technique leverages existing
 * surgical tooling" survives. That sentence is exactly the plain field language
 * spec 9.2 asks for, and a substring ban would reject it.
 *
 * `score` is matched only in self-referential shapes. A blanket ban would reject
 * "reduces UPDRS motor scores by 40%", which is field language, not rubric
 * vocabulary.
 */
const RUBRIC_VOCABULARY = [
  /\bfrontier delta\b/i,
  /\bleverage\b/i,
  /\btransferability\b/i,
  /\bevidence gap\b/i,
  /\btranslational gating\b/i,
  /\bmethodological precedent\b/i,
  /\brubric\b/i,
  /\bdimension\b/i,
  /\bpotential impact\b/i,
  /\b(this|the|its|our)\s+(impact\s+)?score\b/i,
  /\b(highest|lowest|top)\s+score\b/i,
  /\bscores?\s+(highly|high|well)\b/i,
  /\b(FD|LV|TR|GAP|GATE|METH)\b/, // case-sensitive: the dimension codes
]

/**
 * Qualifiers that narrow what was actually shown. Rule 8 calls a divergence
 * "material" when the demonstration carries one of these and the claim does not.
 */
const LIMITERS = [
  /\bone participant\b/i, /\ba single (participant|subject|patient|case)\b/i,
  /\bn\s*=\s*1\b/i, /\bcase report\b/i, /\bin vitro\b/i, /\bex vivo\b/i,
  /\bnon-?human primate\b/i, /\bin (rats?|mice|rodents?|monkeys?)\b/i,
  /\boffline\b/i, /\bsimulat(ed|ion)\b/i, /\bretrospective\b/i,
  /\b\d+-word vocabulary\b/i, /\bpilot\b/i, /\bfeasibility\b/i, /\bpreliminary\b/i,
]

const text = v => String(v ?? '').trim()
const isBlank = v => text(v).length === 0
const hits = (s, list) => list.some(p => (p instanceof RegExp ? p.test(s) : s.toLowerCase().includes(p)))

/** Is a referent too generic to anchor a score? */
export function isGenericReferent(referent) {
  const r = text(referent).toLowerCase().replace(/[.,;:]$/, '')
  if (!r) return true
  if (GENERIC_REFERENTS.includes(r)) return true
  // A referent with no content word beyond an article is not a referent.
  return r.split(/\s+/).filter(w => w.length > 2).length === 0
}

/** Is an unlocks entry one of the generic strings rule 3 names? */
export const isGenericUnlock = u => {
  const s = text(u).toLowerCase().replace(/[.]$/, '')
  return !s || GENERIC_UNLOCKS.some(g => s === g || s.includes(g))
}

/** Rule 8's material-divergence test, deterministic. */
export function divergesMaterially(claimed, demonstrated, entityType = null) {
  if (!text(claimed)) return false
  // A registered trial has demonstrated nothing yet BY DEFINITION. Spec 5.2.4
  // handles trial quality through the design-quality grade, not through this
  // flag. Firing here flagged 6 of 8 sampled trials during Phase 3.
  if (entityType === 'trial') return isBlank(demonstrated)
  if (isBlank(demonstrated)) return true
  const c = text(claimed), d = text(demonstrated)
  // The demonstration names a limit the claim does not carry.
  return LIMITERS.some(re => re.test(d) && !re.test(c))
}

/**
 * Run every section 8 rule over one score. Returns the corrected score and the
 * reset log. Never mutates its input.
 */
export function validate(score, { itemId = null } = {}) {
  const s = JSON.parse(JSON.stringify(score ?? {}))
  const resets = []
  const log = (rule, field, from, to, note) => {
    resets.push({ item_id: itemId, rule, field, from, to, note })
  }

  // ── Rule 1: a score above 0 with an empty or generic referent ─────────────
  for (const dim of DIMENSIONS) {
    const d = s[dim]
    if (!d || typeof d !== 'object') continue
    if (!(d.score > 0)) continue
    if (isGenericReferent(d.referent)) {
      log(1, `${dim}.score`, d.score, 0, `referent ${d.referent === undefined ? 'missing' : `"${text(d.referent)}"`}`)
      d.score = 0
    }
  }

  // ── Rule 2: LV >= 2 needs a beneficiary other than the authors ────────────
  if (s.LV && s.LV.score >= 2) {
    const named = (s.LV.beneficiaries || [])
      .map(text)
      .filter(b => b && !/^(the )?authors?$/i.test(b) && !/^(us|we|our (group|lab|team))$/i.test(b))
    if (!named.length) {
      log(2, 'LV.score', s.LV.score, 1, 'no beneficiary other than the authors')
      s.LV.score = 1
    }
  }

  // ── Rule 3: GATE >= 2 needs a specific unlock ─────────────────────────────
  if (s.GATE && s.GATE.score >= 2) {
    // A mixed array survives on its specific entry; rejecting the whole array
    // because one element is generic destroys a legitimate score.
    const specific = (s.GATE.unlocks || []).filter(u => !isGenericUnlock(u))
    if (!specific.length) {
      log(3, 'GATE.score', s.GATE.score, 1, `unlocks ${(s.GATE.unlocks || []).length ? 'all generic' : 'empty'}`)
      s.GATE.score = 1
    }
  }

  // ── Rule 4: FD or GAP above 0 with nothing consulted ──────────────────────
  // NOTE the exact condition: an EMPTY consulted list, not "no record matched".
  // FD 3 means the subfield's records were checked and none covered this axis,
  // so the list is non-empty while nothing matched. Reading those as the same
  // thing makes FD 3 permanently unreachable.
  const consulted = s.frontier_records_consulted || []
  if (!consulted.length) {
    for (const dim of ['FD', 'GAP']) {
      if (s[dim] && s[dim].score > 0) {
        log(4, `${dim}.score`, s[dim].score, 0, 'frontier_records_consulted is empty')
        s[dim].score = 0
      }
    }
  }

  // ── Rule 5: FD 4 must name two distinct paired axes ───────────────────────
  if (s.FD && s.FD.score === 4) {
    const axes = [...new Set((s.FD.paired_axes || []).map(a => text(a).toLowerCase()).filter(Boolean))]
    if (axes.length < 2) {
      log(5, 'FD.score', 4, 3, `paired_axes named ${axes.length} distinct axis/axes`)
      s.FD.score = 3
    }
  }

  // ── Rule 6: a record update needs demonstrated-or-better evidence ─────────
  if (s.record_update_proposed) {
    const rank = GRADE_RANK[s.evidence_grade]
    if (rank === undefined || rank < DEMONSTRATED_RANK) {
      log(6, 'record_update_proposed', s.evidence_grade, null, 'evidence grade below demonstrated')
      s.record_update_proposed = null
    }
  }

  // ── Rule 8 before 7: gap_flagged feeds the templated fallback ─────────────
  if (divergesMaterially(s.claimed, s.demonstrated, s.entity_type)) {
    if (!s.gap_flagged) log(8, 'gap_flagged', false, true, 'claimed exceeds demonstrated')
    s.gap_flagged = true
  }

  // ── Rule 7: no rubric vocabulary in the user-facing sentence ──────────────
  if (containsRubricVocabulary(s.user_facing_reason)) {
    const attempts = s.regeneration_attempts || 0
    if (attempts >= 2) {
      s.user_facing_reason = templatedReason(s)
      s.reason_from_template = true
      log(7, 'user_facing_reason', 'rubric vocabulary', 'templated', 'regeneration cap reached')
    } else {
      s.needs_regeneration = true
      log(7, 'user_facing_reason', 'rubric vocabulary', 'regenerate', `attempt ${attempts + 1} of 2`)
    }
  }

  return { score: s, resets }
}

export function containsRubricVocabulary(reason) {
  const r = text(reason)
  return !!r && RUBRIC_VOCABULARY.some(re => re.test(r))
}

/**
 * Rule 7's fallback after two failed regenerations: a sentence built from the
 * tags, which are themselves a closed set. Never a number, never a dimension.
 */
export function templatedReason(score) {
  const tags = (score.tags || []).filter(Boolean)
  if (!tags.length) return 'Indexed with no further detail available.'
  const listed = tags.length === 1
    ? tags[0]
    : `${tags.slice(0, -1).join(', ')} and ${tags[tags.length - 1]}`
  return `${listed.charAt(0).toUpperCase()}${listed.slice(1)}.`
}
