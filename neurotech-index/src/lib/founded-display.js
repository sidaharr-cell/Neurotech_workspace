/**
 * founded-display.js — how a founding year is presented, and what it is allowed
 * to claim.
 *
 * Pure and tested, because the rules here are editorial promises rather than
 * formatting. Three of them, each settled deliberately:
 *
 *   A year is shown only with its source. The legacy `founded` column carries 22
 *   values with no source at all, and five of the twelve that can be checked
 *   against a filing disagree with it. Those never render.
 *
 *   The source's CLASS is shown, not just a link. A year from an SEC prospectus
 *   and a year from an unsourced aggregator profile are not the same evidence,
 *   and a reader who cannot tell them apart has been misled by the layout.
 *
 *   Founding and incorporation are labelled as the different facts they are.
 *   Incorporation is only shown when no founding year is known, and it says
 *   "Incorporated", never "Founded".
 */

/** The host, for naming a source without printing a URL at the reader. */
export const sourceHost = url => {
  try { return new URL(String(url)).hostname.replace(/^www\./, '') } catch { return null }
}

/**
 * What to call each class of source, and whether it deserves a caveat.
 *
 * `aggregator` is the one that carries a warning. Crunchbase, PitchBook and
 * Tracxn hold a founding year for almost every company and cite nothing for any
 * of it; the year may well be right, but the reader is entitled to know it rests
 * on a compilation rather than a document.
 */
export const SOURCE_CLASS = {
  press: { label: 'reported', weak: false },
  wikidata: { label: 'Wikidata', weak: false },
  wikipedia: { label: 'Wikipedia', weak: false },
  companies_house: { label: 'UK register', weak: false },
  company_site: { label: 'company’s own site', weak: false, selfReported: true },
  aggregator: { label: 'unsourced compilation', weak: true },
  record_description: { label: 'NeuroBase record', weak: true, noLink: true },
}

/**
 * The line to render for one company, or null when nothing can be said.
 *
 * Returns { verb, year, before, sourceKind, sourceLabel, sourceHost, url, weak,
 *           conflict } — the caller decides the markup, this decides the claim.
 */
export function foundingLine(row) {
  if (!row) return null

  if (row.founded_year) {
    const cls = SOURCE_CLASS[row.founded_source_kind] || { label: 'source', weak: true }
    return {
      verb: 'Founded',
      year: row.founded_year,
      sourceKind: row.founded_source_kind,
      sourceLabel: cls.label,
      sourceHost: cls.noLink ? null : sourceHost(row.founded_source_url),
      url: cls.noLink ? null : (row.founded_source_url || null),
      weak: !!cls.weak,
      selfReported: !!cls.selfReported,
      conflict: row.founded_conflict || null,
      evidence: row.founded_evidence || null,
    }
  }

  // Only when no founding year is known, and never labelled "Founded".
  if (row.incorporated_year) {
    return {
      verb: 'Incorporated',
      year: row.incorporated_year,
      sourceKind: 'filing',
      sourceLabel: 'filing',
      sourceHost: sourceHost(row.incorporated_source_url),
      url: row.incorporated_source_url || null,
      weak: false,
      approximates: true,
    }
  }

  if (row.incorporated_before_year) {
    return {
      verb: 'Incorporated by',
      before: row.incorporated_before_year,
      sourceKind: 'filing',
      sourceLabel: 'filing',
      sourceHost: sourceHost(row.incorporated_source_url),
      url: row.incorporated_source_url || null,
      weak: false,
      approximates: true,
      bound: true,
    }
  }

  // The legacy column is deliberately not a fallback. See the header.
  return null
}

/** "Founded 2019" / "Incorporated by 2004". The claim, without its source. */
export const foundingText = line =>
  (!line ? null : line.bound ? `${line.verb} ${line.before}` : `${line.verb} ${line.year}`)

/** The year to sort or filter by, whichever fact answered. A bound sorts as the
 *  latest year it permits, which is the only year it actually asserts. */
export const foundingSortYear = row => {
  const l = foundingLine(row)
  if (!l) return null
  return l.bound ? l.before : l.year
}
