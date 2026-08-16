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
/**
 * A month, or a day and a month, sitting between "in" and the year.
 *
 * "NEOFECT was founded in June 2010" is a founding sentence and the first
 * version of these patterns could not read it, because it expected the year to
 * follow "in" directly. That sentence was sitting in our own stored description
 * the whole time.
 */
const MONTH = '(?:(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)?\\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\s+(?:of\\s+)?'
const IN_YEAR = `(?:${MONTH})?((?:19|20)\\d{2})`

const CLAIMS = [
  { kind: 'founded', re: new RegExp(`\\b(?:was\\s+)?founded\\s+in\\s+${IN_YEAR}`, 'i') },
  { kind: 'founded', re: /\bfounded[:\s]+((?:19|20)\d{2})\b/i },
  { kind: 'established', re: new RegExp(`\\bestablished\\s+in\\s+${IN_YEAR}`, 'i') },
  { kind: 'started', re: new RegExp(`\\b(?:we\\s+)?(?:started|began)\\s+(?:out\\s+)?in\\s+${IN_YEAR}`, 'i') },
  { kind: 'spun_out', re: /\bspun?\s*-?\s*(?:out|off)\s+(?:of|from)[^.]{0,80}?\bin\s+((?:19|20)\d{2})/i },
  { kind: 'since', re: /\bsince\s+((?:19|20)\d{2})\b/i, guard: true },
]

/**
 * Hosts a founding year must never be read from.
 *
 * Every one of these put a wrong year into the database on the 15 Aug 2026
 * sweep, because the fetcher followed redirects off the company's own site:
 *
 *   hugedomains, brandsly, sedo, afternic — domain-for-sale parking pages.
 *   EIGHT companies were all dated 2005, which is the parking host's own footer
 *   year and nothing to do with any of them.
 *
 *   linkedin — scraped for two companies, and CLAUDE.md forbids it outright.
 *
 * Social and directory hosts are here for the same reason: whatever year they
 * carry belongs to the platform or to a profile, not to the company.
 */
const BLOCKED_HOSTS = /(^|\.)(hugedomains|brandsly|sedo|afternic|dan|namecheap|godaddy|squadhelp|linkedin|facebook|twitter|x|instagram|crunchbase|pitchbook|bloomberg|zoominfo|dnb|f6s|gust|tracxn|owler|golden|dealroom|angel|wellfound|cbinsights)\.(com|co|co\.uk|net|org|io|ai)$/i

/** The registrable-ish host, for comparing a redirect against where we started. */
export const hostOf = url => {
  try { return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase() } catch { return null }
}

/** Strings stored in `website` that mean "we have no website for this company". */
const PLACEHOLDER = /^(n\/?a|none|null|undefined|-|tbd|unknown)$/i

/**
 * The host that IDENTIFIES a company, or null when the stored website does not
 * identify anybody.
 *
 * Two rows sharing this key are the same company. That is worth having because
 * it catches what `core` name equality cannot: a company that RENAMED. Phobious
 * became Psious became Amelia Virtual Care; the first two names share no
 * normalised form and both rows sit in the index pointing at the same site.
 *
 * The null cases are the whole point, and getting them wrong would invent
 * duplicates rather than find them. Five rows in this index record
 * `linkedin.com` as their website, three record the literal string "n/a", and
 * two each record `crunchbase.com` and `f6s.com`. Those rows have NO website;
 * treating the aggregator's host as identity would merge five unrelated
 * companies in Moscow, Berlin, Montreal, Cape Town and Chennai into one.
 */
export function websiteKey(website) {
  const raw = String(website || '').trim()
  if (!raw || PLACEHOLDER.test(raw)) return null
  const h = hostOf(raw.startsWith('http') ? raw : `https://${raw}`)
  if (!h || !h.includes('.') || BLOCKED_HOSTS.test(h)) return null
  return h
}

/** Labels that identify no company in particular, so two rows sharing one are
 *  not thereby the same company. */
const GENERIC_LABEL = new Set([
  'neuro', 'neurotech', 'brain', 'brainlab', 'medical', 'health', 'healthcare',
  'medtech', 'biotech', 'mind', 'cortex', 'neural', 'sense', 'sensor', 'therapy',
  'therapeutics', 'labs', 'tech', 'digital', 'care', 'group', 'systems',
])

/**
 * The distinctive label of a host, or null when it identifies nobody.
 *
 * A WEAKER duplicate signal than `websiteKey`, for one case it cannot see: the
 * same brand under two top-level domains. Incereb of Tallaght is in this index
 * twice, as "Incereb" at incereb.com and as "Eegapps Medical" at incereb.ie.
 * Exact host equality misses it, and so does every comparison of the two names.
 *
 * Deliberately conservative, because a loose version of this INVENTS duplicates,
 * which is worse than missing them. The label must be at least five characters
 * and must not be a word half of neurotechnology uses: neuro.com and neuro.io
 * are not evidence of anything.
 */
export function brandKey(website) {
  const h = websiteKey(website)
  if (!h) return null
  const parts = h.split('.')
  if (parts.length < 2) return null
  // The label left of the public suffix. Two labels of suffix for the co.uk and
  // com.au shape, one otherwise.
  const suffixLen = parts.length > 2 && /^(co|com|org|net|ac|gov)$/.test(parts[parts.length - 2]) ? 2 : 1
  const label = parts[parts.length - 1 - suffixLen]
  if (!label || label.length < 5 || GENERIC_LABEL.has(label)) return null
  return label
}

/** A location reduced to something comparable: case, punctuation and spacing. */
export const placeKey = loc =>
  String(loc || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || null

/**
 * Is one of these two names a longer form of the other, in the same place?
 *
 * The third duplicate signal, and the only pairwise one. Braincare of Sao Carlos
 * is in this index twice, as "Braincare" at brain4.care and as "Braincare Health
 * Tecnology" at braincare.com.br. The names differ, the domains differ, and the
 * brands differ — so neither `core` equality nor `websiteKey` nor `brandKey`
 * sees it. What the two rows DO share is a city and a name that one extends.
 *
 * Neither half is usable alone. A shared location groups hundreds of unrelated
 * companies in Tel Aviv; a name prefix alone would merge every company starting
 * "Neuro". Together, over the whole index, they return exactly two pairs and no
 * false positives.
 *
 * The prefix must end at a word boundary, so "Neura" does not match "Neuralink",
 * and the shorter name must be at least six characters, so "Brain" matches
 * nothing.
 */
export function longerFormOf(a, b) {
  const pa = placeKey(a.location), pb = placeKey(b.location)
  if (!pa || !pb || pa !== pb) return false
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  const x = norm(a.name), y = norm(b.name)
  if (!x || !y || x === y) return false
  const [short, long] = x.length < y.length ? [x, y] : [y, x]
  return short.length >= 6 && long.startsWith(short + ' ')
}

/**
 * Did a fetch end up somewhere its year can be believed?
 *
 * The final URL after redirects must be the company's own host. An acquirer's
 * site is the clearest case of why: Axonics was dated 1979 because its domain
 * redirected to bostonscientific.com, and 1979 is when Boston Scientific was
 * founded. The year was real and belonged to a different company.
 *
 * A one-label difference is allowed, so pajunkusa.com may answer from
 * pajunk.com, but nothing else is.
 */
export function sameSite(finalUrl, storedWebsite) {
  const a = hostOf(finalUrl), b = hostOf(storedWebsite)
  if (!a || !b) return false
  if (BLOCKED_HOSTS.test(a)) return false
  if (a === b) return true
  const short = a.length < b.length ? a : b
  const long = a.length < b.length ? b : a
  const base = short.split('.')[0]
  return base.length >= 4 && long.split('.')[0].includes(base)
}

/** Words that identify no company in particular. */
const GENERIC = new Set([
  'inc', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'company', 'the', 'and', 'group',
  'holdings', 'international', 'global', 'medical', 'health', 'healthcare', 'technologies',
  'technology', 'systems', 'solutions', 'devices', 'sciences', 'science', 'labs', 'laboratories',
  'therapeutics', 'diagnostics', 'imaging', 'research', 'institute', 'digital', 'data',
])

/** The parts of a name that would identify this company in a sentence. */
export function nameTokens(name) {
  const all = String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const strong = all.filter(t => t.length >= 4 && !GENERIC.has(t))
  return strong.length ? strong : all.filter(t => t.length >= 3)
}

/** "Advanced Brain Technologies" -> "ABT", which is how such a company refers
 *  to itself in its own About text. */
export const acronym = name => String(name || '')
  .split(/[^A-Za-z0-9]+/).filter(Boolean).map(w => w[0]).join('').toUpperCase()

/**
 * Is this stretch of text talking about the company, or about somebody?
 *
 * The guard the 15 Aug 2026 sweep needed and did not have. About pages are full
 * of founder biographies and patient testimonials, and the extractor read them
 * as company history: Sana Health was dated 1993 from "he has been pain-free
 * since 1993", NeuSpera from a surgeon's fellowship record. A founding sentence
 * that never names the company is not evidence about the company.
 */
/**
 * Ways a company refers to itself without using its name.
 *
 * On its own About page "the company was founded in 2014" is the company
 * talking about itself, and demanding the literal name there throws away
 * correct values: Neuro Event Labs writes "About the Company Founded in 2015 in
 * Tampere, Finland" and never names itself in the sentence.
 */
const COMPANY_SELF =
  /\b(the company|our company|the firm|the business|about the company|about us|we (?:were|are|started|began|have been)|our (?:co-?founders?|founders?|story|history|journey))\b/i

/**
 * A person, not a company, is the subject just before the year.
 *
 * About pages carry founder biographies and customer testimonials, and both
 * produce sentences that look exactly like company history. Litesprite was
 * dated 2018 from "Logan Niles, player since 2018"; Sana Health 1993 from "he
 * has been pain-free since 1993".
 */
const PERSON_BEFORE =
  /\b(he|she|his|her|him|i|my|player|patient|customer|client|member|subscriber|user|fellow|professor|prof|dr)\b[^.]{0,40}$/i

/**
 * Is this stretch of text talking about the company, or about somebody?
 *
 * Accepts the company's name, its initials, or a phrase by which a company
 * refers to itself. Rejects outright when the words immediately before the year
 * make a person the subject, whichever of those also matched.
 */
export function mentionsCompany(window, name, before = '') {
  if (PERSON_BEFORE.test(String(before || ''))) return false
  if (!name) return true
  const raw = String(window || '')
  const w = raw.toLowerCase()
  if (nameTokens(name).some(t => w.includes(t))) return true
  const a = acronym(name)
  if (a.length >= 2 && new RegExp(`\\b${a}\\b`).test(raw)) return true
  return COMPANY_SELF.test(raw)
}

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
export function extractFoundingYear(text, currentYear, companyName = null) {
  const prose = scrubbed(text)
  if (!prose) return null
  for (const { kind, re, guard } of CLAIMS) {
    const m = prose.match(re)
    if (!m) continue
    const at = m.index ?? 0
    // Is this sentence dating the company, or something the company made?
    if (guard && SINCE_NOT_ABOUT_COMPANY.test(prose.slice(Math.max(0, at - 60), at))) continue
    // Does it name the company at all? An About page is full of people.
    const window_ = prose.slice(Math.max(0, at - 150), at + m[0].length + 150)
    if (!mentionsCompany(window_, companyName, prose.slice(Math.max(0, at - 60), at))) continue
    const year = Number(m[1])
    // A founding year before 1900 is a university or a hospital, not a
    // neurotech company, and after this year it is a typo or a roadmap.
    if (!(year >= 1900 && year <= currentYear)) continue
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
