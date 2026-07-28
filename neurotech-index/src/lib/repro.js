/**
 * repro.js — detect code and data availability links in paper text.
 * Shared by the ingestion pipeline (scripts/refresh.js) and the one-off backfill
 * (scripts/backfill-repro.js) so the detection lives in exactly one place.
 *
 * Conservative by design: it only reports links to well-known code and data
 * hosts actually present in the title/abstract. Absence here means "no link in
 * the abstract", never "no code exists", so callers show an indicator only when
 * a link is found and show nothing otherwise.
 */

// Host -> which bucket a URL on that host belongs to.
const CODE_HOSTS = ['github.com', 'gitlab.com']
const DATA_HOSTS = ['osf.io', 'zenodo.org', 'figshare.com', 'datadryad.org', 'dryad.org']

// Matches bare or http(s) URLs; trailing punctuation is trimmed off.
const URL_RE = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s)>\]]*)?)/gi

function cleanUrl(raw) {
  let u = raw.replace(/[.,;:)\]>'"]+$/, '')          // trailing punctuation
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^www\./i, '')
  return u
}
function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./i, '').toLowerCase() } catch { return '' }
}

/**
 * Scan text for code and data links. Returns { code: string[], data: string[] },
 * each de-duplicated, capped, and canonicalized to an https URL.
 */
export function scanReproLinks(text) {
  const code = new Set(), data = new Set()
  if (!text) return { code: [], data: [] }
  const matches = String(text).match(URL_RE) || []
  for (const m of matches) {
    const u = cleanUrl(m)
    const host = hostOf(u)
    if (!host) continue
    if (CODE_HOSTS.some(h => host === h || host.endsWith('.' + h))) code.add(u)
    else if (DATA_HOSTS.some(h => host === h || host.endsWith('.' + h))) data.add(u)
  }
  return { code: [...code].slice(0, 5), data: [...data].slice(0, 5) }
}
