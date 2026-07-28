/**
 * dedup.js — the one auditable place that decides whether two paper records are
 * versions of the same work (Phase 6). Used by the backfill (scripts/dedup-
 * papers.js) and by ingestion. Deliberately conservative: a false merge hides a
 * real paper, which is worse than a visible duplicate, so anything below the
 * threshold is left separate.
 */

// Normalized title: lowercased, accent-folded, punctuation collapsed. Two
// records with the same normalized title are merge candidates (not yet a merge).
export const normTitle = t =>
  String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

// A robust author key: the surname. Handles "Smith J", "John Smith", and
// "Smith, John". Returns '' when nothing usable is present.
export function surnameKey(name) {
  const s = String(name || '').trim()
  if (!s) return ''
  if (s.includes(',')) return s.split(',')[0].toLowerCase().replace(/[^a-z]/g, '')
  const tokens = s.split(/\s+/)
  // "Smith J" / "Smith JA": first token is the surname when the rest are initials.
  if (tokens.length >= 2 && tokens.slice(1).every(t => /^[A-Z.]{1,3}$/.test(t))) {
    return tokens[0].toLowerCase().replace(/[^a-z]/g, '')
  }
  return tokens[tokens.length - 1].toLowerCase().replace(/[^a-z]/g, '')
}

export function authorSurnames(authors) {
  return new Set((Array.isArray(authors) ? authors : []).map(surnameKey).filter(Boolean))
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

const AUTHOR_THRESHOLD = 0.5   // at least half the (smaller) author set must overlap

/**
 * Are two paper records the same work? True when they share a DOI, or when their
 * normalized titles are identical AND their author surnames overlap enough to be
 * confident. Missing authors on either side => not confident => false.
 */
export function sameWork(a, b, { authorThreshold = AUTHOR_THRESHOLD } = {}) {
  if (a.doi && b.doi && a.doi.toLowerCase() === b.doi.toLowerCase()) return true
  const ta = normTitle(a.title)
  if (!ta || ta !== normTitle(b.title)) return false
  const sa = authorSurnames(a.authors), sb = authorSurnames(b.authors)
  if (!sa.size || !sb.size) return false
  return jaccard(sa, sb) >= authorThreshold
}

// Source rank for choosing the canonical record: a peer-reviewed PubMed record
// with a journal wins, then any pubmed, then a preprint.
function sourceRank(p) {
  if (p.source === 'pubmed' && p.journal) return 3
  if (p.source === 'pubmed') return 2
  return 1
}

/**
 * Given a cluster of same-work records, choose the canonical one: prefer the
 * peer-reviewed published version, else the most recent by year. Returns the
 * chosen record.
 */
export function chooseCanonical(cluster) {
  return [...cluster].sort((a, b) => {
    const r = sourceRank(b) - sourceRank(a)
    if (r) return r
    return String(b.year || '').localeCompare(String(a.year || ''))
  })[0]
}

/** A version-history entry for the canonical record's versions[] list. */
export function versionOf(p) {
  return {
    source: p.source || null,
    source_id: p.pubmed_id || p.arxiv_id || p.doi || null,
    url: p.url || null,
    year: p.year || null,
    peer_reviewed: p.source === 'pubmed',
  }
}
