/**
 * website.js — whether a stored website is something a reader can click.
 *
 * `organizations.website` is not clean. 28 of 1,084 company rows hold a value
 * that is not a URL: the literal strings "N/A", "NA", "n/a", "Web" and "Not up",
 * and — worse, because it looks plausible — the company's own name, as in
 * "https://Deep Brain Innovations" and "https://customKYnetics".
 *
 * The pages guarded on `company.website &&`, which every one of those passes.
 * So a reader saw a link, and its visible text was whatever `new URL()` made of
 * the string: "https://N/A" has hostname "n", so the link read "n" and went
 * nowhere. CLAUDE.md's rule is that a missing value is omitted or reads "Not
 * available"; a dead link is neither.
 *
 * This does NOT judge whether the site is any good — a LinkedIn or Crunchbase
 * URL is a real destination and still renders. It only asks whether there is a
 * host to go to. Deciding that an aggregator profile is not a company website is
 * a separate question, and one for a person, since removing it leaves the row
 * with nothing.
 */

/** Values stored in `website` that mean "we do not have one". */
const PLACEHOLDER = /^(n\/?a|none|null|undefined|-|tbd|unknown|web|not up|no site)$/i

/**
 * @returns {string|null} a URL safe to put in an href, or null to render nothing.
 */
export function siteUrl(website) {
  const raw = String(website || '').trim()
  if (!raw || PLACEHOLDER.test(raw)) return null
  // Only supply a scheme when there is none. Prefixing unconditionally turned
  // "mailto:hi@acme.com" into "https://mailto:hi@acme.com", which parses with
  // "mailto:hi" as userinfo and "acme.com" as the host — a mail address
  // laundered into a passing web link.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw)
  let u
  try { u = new URL(hasScheme ? raw : `https://${raw}`) }
  catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  // Credentials in a company website are never legitimate here and would let a
  // link display one host while pointing at another.
  if (u.username || u.password) return null
  const h = u.hostname
  // A hostname with no dot is not a public site. This is what catches the name
  // pasted into the field: "https://Deep Brain Innovations" parses, and its
  // hostname is "deep%20brain%20innovations".
  if (!h.includes('.') || h.startsWith('.') || h.endsWith('.')) return null
  // The label immediately left of the TLD must look like a name, not prose.
  if (/[^a-z0-9.-]/i.test(h)) return null
  return u.toString()
}

/** What to show as the link text: the host, without www. */
export function siteLabel(website) {
  const url = siteUrl(website)
  if (!url) return null
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null }
}
