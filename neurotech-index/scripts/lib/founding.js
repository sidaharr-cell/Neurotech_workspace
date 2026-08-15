/**
 * founding.js — reading a founding year out of a company's own web page.
 *
 * Pure and tested, because this is the least trustworthy source in the index and
 * the one most able to put a wrong number on a company page. Everything that
 * decides whether a four-digit number is a founding year lives here, where a
 * test can reach it; the fetching lives in scripts/backfill-founded.js.
 *
 * A company's own site is SELF-REPORTED. It is the canonical source for the
 * company's own account of itself and nothing more: nobody checked it, it can
 * change without notice, and it is a different class of evidence from an SEC
 * filing. Anything it produces must be labelled as such wherever it is shown.
 *
 * This never returns an incorporation year. "Incorporated in Delaware in 2015"
 * is a different fact, it already has a better source in Form D, and conflating
 * the two is the error docs/founded-backfill-scope.md exists to prevent.
 */

/**
 * schema.org foundingDate, from JSON-LD or microdata.
 *
 * Checked BEFORE prose, and it is the single biggest thing the first version of
 * this module missed. It is machine-written rather than marketing copy, so it
 * needs no pattern guessing, and it survives on JavaScript-rendered sites whose
 * served HTML carries no readable text at all — measured 15 Aug 2026, 3 of 30
 * sampled sites returned under 400 characters of prose.
 *
 * Only an Organization node is trusted. A foundingDate on an Event or a
 * Person is a different fact wearing the same key.
 */
const ORG_TYPES = /^(organization|corporation|localbusiness|medicalorganization|ngo|company)$/i

function walkForFounding(node, out) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const v of node) walkForFounding(v, out); return }
  const types = [].concat(node['@type'] || []).map(String)
  if (types.some(t => ORG_TYPES.test(t.replace(/^.*\//, '')))) {
    const d = node.foundingDate ?? node.foundingdate
    const m = /^((?:19|20)\d{2})/.exec(String(d ?? ''))
    if (m) out.push({ year: Number(m[1]), name: node.name || null })
  }
  for (const k of Object.keys(node)) if (k !== '@type') walkForFounding(node[k], out)
}

/** Returns { year, kind: 'schema_org', phrase } or null. */
export function extractSchemaFounding(html) {
  const found = []
  const blocks = String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const b of blocks) {
    try { walkForFounding(JSON.parse(b[1].trim()), found) } catch { /* malformed block */ }
  }
  // Microdata fallback: <meta itemprop="foundingDate" content="2015-04-01">
  const micro = String(html || '').match(/itemprop=["']foundingDate["'][^>]*content=["']((?:19|20)\d{2})/i)
    || String(html || '').match(/content=["']((?:19|20)\d{2})[^"']*["'][^>]*itemprop=["']foundingDate["']/i)
  if (micro) found.push({ year: Number(micro[1]), name: null })
  if (!found.length) return null
  const best = found.sort((a, b) => a.year - b.year)[0]
  return {
    year: best.year,
    kind: 'schema_org',
    phrase: `schema.org foundingDate ${best.year}${best.name ? ` on "${best.name}"` : ''}`,
  }
}

/** Tags whose contents are never prose about the company. */
const DEAD_TAGS = /<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi

/**
 * Spans that contain a year which is never a founding year.
 *
 * The copyright line is the obvious one and the reason this exists: "© 2019
 * Acme Neuro" sits in the footer of almost every page, and a naive year grab
 * reads it as a founding date on any site whose About text does not mention one.
 */
const NEVER = [
  /(?:©|&copy;|\(c\)|copyright)[^.]{0,60}/gi,
  /\ball rights reserved[^.]{0,40}/gi,
  /\b(?:updated|revised|effective|accessed|published|posted)\b[^.]{0,40}/gi,
  /\b(?:privacy policy|terms of (?:use|service)|cookie)\b[^.]{0,60}/gi,
]

/** Turn a page into comparable prose. */
export function pageText(html) {
  let t = String(html || '').replace(DEAD_TAGS, ' ')
  t = t.replace(/<[^>]+>/g, ' ')
  t = t.replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&[a-z#0-9]+;/gi, ' ')
  // En and em dashes appear in date ranges and would otherwise glue years to
  // words. Same normalisation the lexicon does, and for the same reason.
  t = t.replace(/[‐-―]/g, '-')
  return t.replace(/\s+/g, ' ').trim()
}

/** Prose with the never-a-founding-year spans removed. */
export const scrubbed = text => NEVER.reduce((s, re) => s.replace(re, ' '), String(text || ''))

/**
 * Words that, just before a "since YYYY", mean the sentence is dating something
 * other than the company: a product, a clearance, a deployment, a membership.
 *
 * Built from a real false positive rather than from imagination. Accentus
 * Medical was read as founded in 2006 from "undergone successful clinical
 * application since 2006 in the field of custom-made and modular", which is a
 * sentence about a coating technology. "AE.STUDIO · SINCE 2016" on the same run
 * is a genuine founding tagline, so the pattern earns its place and it is the
 * SUBJECT that has to be checked, not the phrasing.
 */
const SINCE_NOT_ABOUT_COMPANY =
  /\b(application|applications|use|used|using|available|approved|cleared|certified|accredited|installed|deployed|implanted|treated|published|listed|member|partner|supplier|distributor|sold|shipping|running|in\s+use)\b[^.]{0,40}$/i

/**
 * The claims that assert a founding year, most explicit first.
 *
 * "since YYYY" is last and is the weakest: it is usually a founding claim on an
 * About page but it also dates products and clearances, so it carries a guard on
 * what precedes it. It earns its place because it is the only phrasing many
 * small device companies use, and the phrase is recorded alongside the year so a
 * person can audit what was believed.
 */
const CLAIMS = [
  { kind: 'founded', re: /\b(?:was\s+)?founded\s+in\s+((?:19|20)\d{2})/i },
  { kind: 'founded', re: /\bfounded[:\s]+((?:19|20)\d{2})\b/i },
  { kind: 'established', re: /\bestablished\s+in\s+((?:19|20)\d{2})/i },
  { kind: 'started', re: /\b(?:we\s+)?(?:started|began)\s+(?:out\s+)?in\s+((?:19|20)\d{2})/i },
  { kind: 'spun_out', re: /\bspun?\s*-?\s*(?:out|off)\s+(?:of|from)[^.]{0,80}?\bin\s+((?:19|20)\d{2})/i },
  { kind: 'since', re: /\bsince\s+((?:19|20)\d{2})\b/i, guard: true },
]

/**
 * Read a founding year out of page text.
 *
 * Returns `{ year, kind, phrase }` or null. `phrase` is the sentence fragment the
 * year came from, kept so a reviewer can see what was believed and why without
 * re-fetching the page.
 *
 * @param {string} text        prose, from pageText()
 * @param {number} currentYear used to reject a year in the future
 */
export function extractFoundingYear(text, currentYear) {
  const prose = scrubbed(text)
  if (!prose) return null
  for (const { kind, re, guard } of CLAIMS) {
    const m = prose.match(re)
    if (!m) continue
    // Is this sentence dating the company, or something the company made?
    if (guard && SINCE_NOT_ABOUT_COMPANY.test(prose.slice(Math.max(0, (m.index ?? 0) - 60), m.index ?? 0))) continue
    const year = Number(m[1])
    // A founding year before 1900 is a university or a hospital, not a
    // neurotech company, and after this year it is a typo or a roadmap.
    if (!(year >= 1900 && year <= currentYear)) continue
    const at = m.index ?? 0
    return {
      year,
      kind,
      phrase: prose.slice(Math.max(0, at - 40), at + m[0].length + 40).trim(),
    }
  }
  return null
}

/**
 * Which of two readings to keep for one company.
 *
 * A stronger claim wins over a weaker one regardless of which page it came from,
 * so an About page saying "founded in 2015" beats a homepage saying "since 2018".
 * Between two equally strong claims the earlier year wins, on the same reasoning
 * as incorporation: a later date is usually a rebrand, a relaunch or a regional
 * subsidiary, and the first claim is closest to the company's actual start.
 */
// schema.org outranks prose: it is machine-written and needs no interpretation.
const STRENGTH = { schema_org: 5, founded: 4, established: 3, spun_out: 3, started: 2, since: 1 }

export function preferFounding(a, b) {
  if (!a) return b || null
  if (!b) return a
  const sa = STRENGTH[a.kind] ?? 0, sb = STRENGTH[b.kind] ?? 0
  if (sa !== sb) return sa > sb ? a : b
  return a.year <= b.year ? a : b
}

/**
 * The pages worth asking.
 *
 * The homepage is FIRST now, not last: schema.org markup lives in the site head
 * and is served on the root more reliably than on a sub-path, and it is the
 * strongest claim available. Prose About pages follow.
 */
export const ABOUT_PATHS = [
  '', '/about', '/about-us', '/about-us/', '/company', '/our-story', '/who-we-are', '/en/about',
]

/** Absolute URL for one candidate path on a company site, or null if the stored
 *  website is not a usable http(s) URL. */
export function aboutUrl(website, path) {
  try {
    const u = new URL(String(website))
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return new URL(path || '/', u.origin).href
  } catch { return null }
}
