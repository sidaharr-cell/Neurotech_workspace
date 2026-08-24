/**
 * notable.js — the rules the Notable research rail is built by, and the one
 * source the rail was never asking.
 *
 * WHAT WENT WRONG. The rail drained: 9 papers on 17 Aug 2026, 5 by the 23rd,
 * and on course for 0 by mid-September. Nothing was broken in the sense of
 * throwing; two gates had simply closed on each other.
 *
 *   impactTrusted    a percentile is noise until a paper has signal, so it is
 *                    trusted only once the paper has 3+ citations or is more
 *                    than 60 DAYS OLD. Recent neurotech papers sit at zero
 *                    citations for months, so in practice this is "60 days".
 *   the window       a rail entry has to be no more than NOTABLE_WINDOW_DAYS
 *                    old, which was 90.
 *
 * Between them, a paper was admissible for thirty days — from day 60 to day 90.
 * And the only two things that could admit it were TODAY'S ingest and a scan of
 * the 500 most recently INGESTED papers, which is about five days' worth. A
 * paper is almost always ingested within days of publication, so by the time it
 * became eligible nothing was looking at it any more. Measured on 24 Aug 2026:
 * nineteen research rows in the feed cleared the topic and percentile bars and
 * exactly zero cleared all three gates at once.
 *
 * TWO CHANGES FOLLOW, and both are in that arithmetic rather than in taste.
 *
 * The rail now sweeps the research rows already in the feed (`feedCandidates`)
 * on every run, so a paper is re-considered when it BECOMES eligible instead of
 * only on the day it arrived. Those rows already carry an OpenAlex percentile
 * and a topic score the nightly run paid for once, which is why this costs no
 * model call: the judgement is already in the row.
 *
 * And the window is 180 days rather than 90, because a paper cannot enter
 * before day 60. Ninety left a thirty-day slot to both enter the rail and live
 * on it; 180 gives an entry a hundred and twenty days of shelf life, which is
 * what a twelve-paper rail needs to stay full when its intake is a handful a
 * month. Nothing about the standard moved: the percentile bar, the topic bar
 * and the trust rule are all untouched. Only how long a qualifying paper is
 * allowed to stay.
 */

/** How many papers the file carries. The page shows six and drops any that
 *  already appear in the feed above it, so the file has to hold more. */
export const NOTABLE_MAX = 12

/** Top decile of the paper's own field, from OpenAlex. */
export const NOTABLE_PCTILE_MIN = 0.90

/** How old a paper may be and still sit on the rail. See the note above. */
export const NOTABLE_WINDOW_DAYS = 180

/**
 * A research row from `news_feed`, in the shape the rail speaks.
 *
 * Everything the rail needs is already on the row: refresh.js writes the
 * OpenAlex percentile, fwci and citation count into `metadata` when it ingests
 * a paper, and `relevance_score` is the topic judgement from the same run. The
 * mapping is here, pure and tested, because it is the one place a wrong field
 * name would be silent — a missing `pctile` reads as "did not qualify", not as
 * an error, and the rail would go on draining exactly as it did before.
 *
 * `citedBy` comes from `citationCount`, which is what the ingest stores. It is
 * often 0 on a recent paper even when OpenAlex knows better, so callers
 * re-enrich a candidate through OpenAlex before judging it on citations.
 */
export function feedRowToCandidate(row) {
  const m = row?.metadata || {}
  const doi = m.doi || null
  const pmid = m.pmid || null
  if (!row?.title || (!doi && !pmid)) return null
  return {
    title: row.title,
    authors: m.authors || [],
    journal: m.journal || row.source || '',
    doi,
    pmid,
    url: row.url || (doi ? `https://doi.org/${doi}` : null),
    publishedAt: row.published_at || null,
    pctile: m.pctile ?? null,
    fwci: m.fwci ?? null,
    citedBy: m.citationCount ?? 0,
    // The topic score the nightly run already made. Carried under the name the
    // rail reads (`relevance`) so nothing has to be scored again.
    relevance: row.relevance_score ?? null,
    significance: m.significance || '',
  }
}

/** Research rows from the feed, newest first, as rail candidates. */
export async function feedCandidates(supabase, { limit = 2000 } = {}) {
  const { data, error } = await supabase
    .from('news_feed')
    .select('title,url,source,published_at,relevance_score,metadata')
    .in('entry_type', ['paper', 'preprint'])
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) {
    console.warn('      rail feed sweep failed:', error.message)
    return []
  }
  return (data || []).map(feedRowToCandidate).filter(Boolean)
}
