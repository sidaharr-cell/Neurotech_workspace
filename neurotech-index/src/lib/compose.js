/**
 * compose.js — spec section 6. Turns validated dimension scores into one number.
 *
 * Pure. No model, no database, no I/O. Every input is passed in, which is what
 * lets Phase 5 run the identical composition against a 2016 record set (see
 * docs/potential-impact-phase4-design.md).
 *
 * THE TWO HARD RULES, both from spec 2 and 6:
 *
 *   MUST NOT sum dimension scores. Additive rubrics let a mediocre item
 *   accumulate rank from breadth.
 *   MUST NOT sum the paths. base is the MAX of two paths, never their total.
 *
 * WHY TWO PATHS. A single ceiling on the advance dimension is right for frontier
 * work and wrong for a whole category that matters and has no frontier delta at
 * all: an encapsulation result extending chronic viability, a yield improvement
 * making an array producible, a reimbursement decision for a device class. None
 * of these has rhetorical markers of importance, so a scorer reading for
 * salience misses them systematically. The second path lets them rank without
 * loosening the ceiling on the first.
 */

/** 5.3.1, Research and Devices. `contradicted` is a gate, not a multiplier. */
export const EVIDENCE_MULTIPLIER = {
  replicated: 1.00,
  demonstrated: 1.00,
  partial: 0.75,
  'claimed-only': 0.40,
}

/** 5.3.2, Trials. This is where decisiveness lives; it is not a dimension. */
export const DESIGN_MULTIPLIER = {
  decisive: 1.00,
  strong: 0.90,
  indicative: 0.65,
  exploratory: 0.50,
  'announced-only': 0.40,
}

/** Grades that gate the item out entirely rather than scaling it. */
export const GATING_GRADES = ['contradicted']

/**
 * Recency half-life in YEARS, deliberately its own constant and deliberately
 * gentle. Spec 6: "Use a gentler decay curve on this sort than on Feed, and make
 * it a separate tunable constant, not a shared one. The premise of the filter is
 * that important work is recognized slowly, so recency and prospective impact
 * pull against each other."
 *
 * Feed's curves for comparison (scripts/refresh.js): news 3 days, research 180
 * days. This is 6 years, so a 6-year-old result still carries half its weight
 * where Feed would have discarded it entirely. Phase 5 calibration tunes this;
 * it is the single most likely constant to be wrong at this stage.
 */
export const RECENCY_HALF_LIFE_YEARS = 6

const DAYS_PER_YEAR = 365.25

/**
 * Recency factor in (0, 1]. `asOf` makes it testable and lets Phase 5 evaluate a
 * 2017 item as of 2019 rather than as of today, which is the whole point of a
 * retro-holdout.
 *
 * Devices use last_status_change and trials use last registry update (spec
 * 5.1.4 and 6); the caller passes whichever date applies, because only the
 * caller knows the entity type.
 */
export function recencyFactor(date, asOf = null) {
  if (!date) return 1
  const t = new Date(date).getTime()
  if (Number.isNaN(t)) return 1
  const now = asOf ? new Date(asOf).getTime() : Date.now()
  const days = (now - t) / 86400000
  if (days <= 0) return 1
  return Math.exp(-days * Math.LN2 / (RECENCY_HALF_LIFE_YEARS * DAYS_PER_YEAR))
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const scoreOf = d => num(d && typeof d === 'object' ? d.score : d)

/**
 * The two research/device paths. Returns both so the caller can record which
 * one won and so monitoring (spec 13) can watch the split.
 */
export function researchPaths({ FD, LV, TR }) {
  const fd = scoreOf(FD), lv = scoreOf(LV), tr = scoreOf(TR)
  return {
    frontier: fd * (1 + 0.25 * lv + 0.20 * tr),
    leverage: lv * (1 + 0.20 * tr),
  }
}

/** The two trial paths. gatePath is how a methodologically ordinary but
 *  class-gating trial ranks at all. */
export function trialPaths({ GAP, GATE, METH }) {
  const gap = scoreOf(GAP), gate = scoreOf(GATE), meth = scoreOf(METH)
  return {
    gap: gap * (1 + 0.25 * gate + 0.20 * meth),
    gate: gate * (1 + 0.20 * meth),
  }
}

/**
 * Compose one ImpactScore. Returns { potential_impact, path_taken, base, ... }.
 *
 * `gated` is returned rather than throwing, because spec 5.4 wants gated items
 * logged with a reason code, not silently dropped.
 */
export function compose(score, { asOf = null } = {}) {
  const isTrial = score.entity_type === 'trial'
  const grade = score.evidence_grade

  if (GATING_GRADES.includes(grade)) {
    return { potential_impact: 0, path_taken: null, base: 0, gated: 'CONTRADICTED', multiplier: 0, recency: 0 }
  }

  const paths = isTrial ? trialPaths(score) : researchPaths(score)
  const [aName, bName] = isTrial ? ['gap', 'gate'] : ['frontier', 'leverage']
  // MUST NOT sum. A tie resolves to the first path, which keeps path_taken
  // deterministic; a random or arbitrary tiebreak would make the monitoring
  // signal in spec 13 unreadable.
  const base = Math.max(paths[aName], paths[bName])
  const pathTaken = paths[aName] >= paths[bName] ? aName : bName

  const table = isTrial ? DESIGN_MULTIPLIER : EVIDENCE_MULTIPLIER
  // An unknown grade must not silently score as 1.0. The most conservative
  // known multiplier is the honest default for something we could not grade.
  const multiplier = table[grade] ?? 0.40
  const recency = recencyFactor(score.recency_date, asOf)

  return {
    potential_impact: base * multiplier * recency,
    path_taken: pathTaken,
    base,
    paths,
    multiplier,
    recency,
    gated: null,
  }
}

// ── User-facing surface, spec 9.2 ───────────────────────────────────────────
// A CLOSED set, derived deterministically. Never freehand, and never a number.

export const TAG_RULES = [
  { tag: 'Extends a field record', when: s => scoreOf(s.FD) >= 2 },
  { tag: 'Opens a new direction', when: s => scoreOf(s.FD) >= 3 },
  { tag: 'Removes a known bottleneck', when: s => scoreOf(s.LV) >= 3 },
  { tag: 'Broadly applicable method', when: s => scoreOf(s.TR) >= 3 },
  { tag: 'Answers an open question', when: s => scoreOf(s.GAP) >= 3 },
  { tag: 'Gates approval for a device class', when: s => scoreOf(s.GATE) >= 3 },
  { tag: 'Sets trial methodology', when: s => scoreOf(s.METH) >= 3 },
  { tag: 'First in humans', when: s => s.translational_distance === 2 },
  { tag: 'In clinical use', when: s => s.translational_distance === 4 },
  // The disclosure tags matter most: they are the only visible sign the
  // anti-hype control is running, and a user should be able to see when a
  // highly ranked item ranks on a claim.
  { tag: 'No data released', when: s => ['claimed-only', 'announced-only'].includes(s.evidence_grade) },
  { tag: 'Limited detail disclosed', when: s => ['partial', 'indicative'].includes(s.evidence_grade) },
  { tag: 'Industry sponsored', when: s => (s.flags || []).includes('industry_sponsored') },
]

export function tagsFor(score) {
  return TAG_RULES.filter(r => r.when(score)).map(r => r.tag)
}

/** Horizon filter, from translational distance. Spec 9.2. */
export function horizonFor(td) {
  if (td === 3 || td === 4) return 'near'
  if (td === 2) return 'medium'
  if (td === 0 || td === 1) return 'long'
  return null
}
