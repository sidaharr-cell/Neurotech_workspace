/**
 * frontier-coverage.js — when does an ABSENT axis mean something?
 *
 * FD 3 (spec 5.1.1) is "opens a new axis: demonstrates a capability that had no
 * prior record because nobody had achieved that category of thing."
 *
 * That is a claim about OUR RECORD LAYER, not about the item. The evidence for
 * it is an absence, and an absence only carries information when the surrounding
 * area is mapped. In a subfield with three curated records, an axis with no
 * record means "nobody has curated it", which is a fact about our backlog. In a
 * well-mapped subfield the same absence means "nobody has done this", which is
 * the frontier claim FD 3 is for.
 *
 * The spec never wrote this rule down. Section 7.1.3 covers only the extreme
 * case, a subfield with NO records, and caps FD at 0 there. Everything between
 * that and full coverage was undefined, which left FD 3 unreachable in practice:
 * a scorer had no principled basis to distinguish the two kinds of absence.
 * This file is that rule.
 *
 * WHY AXIS-TYPE SPREAD, NOT JUST COUNT. Five records that are all `performance`
 * say nothing about whether `longevity` in that subfield is unmeasured or merely
 * uncurated. Breadth across axis types is what makes an absence informative;
 * depth on one axis is not. BCI_NONINVASIVE was exactly this shape when the rule
 * was written: five records, every one of them performance.
 *
 * These thresholds are a judgement and they are deliberately conservative. The
 * cost of setting them too high is some FD 3s scored as FD 2, which understates.
 * The cost of setting them too low is awarding "nobody has ever done this" on
 * the strength of our own backlog, which is a fabricated superlative and exactly
 * the failure the rebuild exists to prevent.
 */

/** A subfield must hold at least this many live records for absence to count. */
export const MIN_RECORDS_FOR_ABSENCE = 6

/** ...spanning at least this many distinct axis types. */
export const MIN_AXIS_TYPES_FOR_ABSENCE = 3

/**
 * Coverage of one subfield, from its live records.
 * `records` is an array of { subfield, axis, axis_type }.
 */
export function coverageOf(records = [], subfield = null) {
  const rs = subfield ? records.filter(r => r.subfield === subfield) : records
  const axisTypes = [...new Set(rs.map(r => r.axis_type).filter(Boolean))]
  return {
    subfield,
    records: rs.length,
    axisTypes: axisTypes.sort(),
    axisTypeCount: axisTypes.length,
    sufficient: rs.length >= MIN_RECORDS_FOR_ABSENCE
      && axisTypes.length >= MIN_AXIS_TYPES_FOR_ABSENCE,
  }
}

/**
 * The highest FD a subfield's coverage can support, before the item is even
 * looked at. This is a ceiling on the scorer, not a score.
 *
 *   0  no records at all. Spec 7.1.3: nothing to compare against.
 *   2  records exist, but coverage is too thin for an absence to mean anything.
 *      The item can still move or set a record on an axis we hold.
 *   4  coverage is sufficient. FD 3 becomes available when the item's axis
 *      matches no live record, and FD 4 when it collapses a curated pair.
 */
export function fdCeilingFor(records = [], subfield = null) {
  const c = coverageOf(records, subfield)
  if (c.records === 0) return 0
  return c.sufficient ? 4 : 2
}

/**
 * Coverage for every subfield, plus which ones can support FD 3.
 * `subfieldIds` keeps subfields with zero records in the report rather than
 * letting them vanish, since an empty subfield is the loudest coverage signal.
 */
export function coverageReport(records = [], subfieldIds = []) {
  const ids = subfieldIds.length
    ? subfieldIds
    : [...new Set(records.map(r => r.subfield).filter(Boolean))]
  const bySubfield = {}
  for (const id of ids) bySubfield[id] = coverageOf(records, id)
  const sufficient = ids.filter(id => bySubfield[id].sufficient)
  return {
    bySubfield,
    sufficient,
    insufficient: ids.filter(id => !bySubfield[id].sufficient),
    fdThreeAvailableIn: sufficient.length,
    total: ids.length,
  }
}

/**
 * Is FD 3 legitimately available for an item on `axis` in `subfield`?
 *
 * Requires BOTH that the subfield is well enough mapped for an absence to mean
 * something, AND that the axis genuinely has no live record. Axis matching is
 * exact on the curated wording, deliberately: a fuzzy match would let a
 * rewording of an existing axis read as a new one, which manufactures FD 3s.
 * The cost is the opposite error, a real new axis phrased close to an old one
 * being missed, which understates rather than inflates.
 */
export function newAxisAllowed(records = [], subfield = null, axis = null) {
  if (!coverageOf(records, subfield).sufficient) return false
  if (!axis) return false
  const existing = records.filter(r => r.subfield === subfield).map(r => r.axis)
  return !existing.includes(axis)
}
