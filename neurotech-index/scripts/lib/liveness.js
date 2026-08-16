/**
 * liveness.js — classifying what a stored company website actually does.
 *
 * The founding sweep found dead and repurposed domains in every single batch,
 * and the failure modes are not the same thing:
 *
 *   DNS failure is honest. The domain is gone and nothing pretends otherwise.
 *
 *   A parking page is a LIE THAT RETURNS 200. hugedomains.com, sedo, GoDaddy's
 *   forsale host — these answer cheerfully and carry their own footer year. That
 *   is how eight companies in this index were once all dated 2005.
 *
 *   A RESOLD domain is worse still, because it serves a real business that is
 *   simply not the one in the index. bionicvis.com now serves a restaurant.
 *   savonix.com serves football rankings. joyhaptics.com serves an online
 *   casino. energizekids.com serves a Dutch school-movement platform and looks
 *   perfectly healthy.
 *
 *   And the worst case found: lucine.io was resold to a Telegram bot business
 *   THAT KEPT THE NAME, carrying a "© 2026 Lucine" footer. A scraper would find
 *   a live site, the right company name, and a plausible year, all wrong.
 *
 * So this cannot decide whether a site still belongs to its company — that took
 * a person reading the page every time. What it CAN do is sort the index into
 * "answers", "does not answer", and "answers from a host that sells domains",
 * which is enough to say where a person should look.
 */

/** Hosts whose 200 means "this domain is for sale", not "this company exists". */
const PARKING = /(^|\.)(hugedomains|sedo|afternic|dan|godaddy|forsale\.godaddy|squadhelp|bodis|parkingcrew|sav|namecheap|domains\.atom|expireddomains)\.(com|net|org|co)$/i

/** A hostname that is only a redirect artefact, never a company's own site. */
const REDIRECT_ARTEFACT = /^ww\d+\./i

export const STATUS = {
  OK: 'ok',                     // answers, and not from a parking host
  PARKED: 'parked',             // answers, from a domain-sale host
  OFF_HOST: 'off-host',         // answers, but redirected to a different domain
  DNS: 'dns',                   // does not resolve
  TLS: 'tls',                   // resolves but the certificate is broken or foreign
  REFUSED: 'refused',           // resolves, refuses the connection
  HTTP_ERROR: 'http-error',     // answers with 4xx or 5xx
  NO_URL: 'no-url',             // nothing usable stored
}

/**
 * Classify a completed fetch attempt. Pure, so the network part stays testable.
 *
 * @param {object} r
 * @param {string|null} r.requestedHost  host we asked for
 * @param {string|null} r.finalUrl       url after redirects, if any
 * @param {number|null} r.status         http status, if we got one
 * @param {string|null} r.errorCode      node error code, if we did not
 */
export function classify({ requestedHost, finalUrl, status, errorCode }) {
  if (!requestedHost) return { status: STATUS.NO_URL, detail: null }

  if (errorCode) {
    // A purely numeric code is an OpenSSL certificate-verify result — 20 is
    // "unable to get local issuer certificate". It arrives as a number rather
    // than a string, so without this it would fall through to REFUSED and
    // describe a certificate problem as a connection problem.
    if (/^\d+$/.test(String(errorCode))) {
      return { status: STATUS.TLS, detail: `openssl verify ${errorCode}` }
    }
    if (/ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED/.test(errorCode)) {
      return { status: STATUS.DNS, detail: errorCode }
    }
    if (/CERT|TLS|SSL|ERR_TLS/.test(errorCode)) return { status: STATUS.TLS, detail: errorCode }
    if (/ECONNREFUSED|ECONNRESET|EPIPE|ETIMEDOUT|SOCKET/.test(errorCode)) {
      return { status: STATUS.REFUSED, detail: errorCode }
    }
    return { status: STATUS.REFUSED, detail: errorCode }
  }

  let finalHost = null
  try { finalHost = new URL(finalUrl).hostname.toLowerCase() } catch { /* keep null */ }

  // Parking is checked BEFORE the status code, because a parking page is a
  // perfectly healthy 200 and that is the entire problem with it.
  if (finalHost && PARKING.test(finalHost)) return { status: STATUS.PARKED, detail: finalHost }
  if (finalHost && REDIRECT_ARTEFACT.test(finalHost)) {
    return { status: STATUS.PARKED, detail: finalHost }
  }

  if (status != null && status >= 400) return { status: STATUS.HTTP_ERROR, detail: String(status) }

  if (finalHost && !sameRegistrable(requestedHost, finalHost)) {
    return { status: STATUS.OFF_HOST, detail: finalHost }
  }
  return { status: STATUS.OK, detail: finalHost }
}

/**
 * Do two hosts belong to the same site for this purpose?
 *
 * Deliberately loose about the leading label, so www and a country subdomain do
 * not register as a move, and about the TLD, so acme.com to acme.co.uk does not
 * either. A move from acme.com to acme.example is what we want to see.
 */
export function sameRegistrable(a, b) {
  const strip = h => String(h || '').toLowerCase().replace(/^www\./, '')
  const x = strip(a), y = strip(b)
  if (x === y) return true
  const label = h => {
    const parts = h.split('.')
    if (parts.length < 2) return h
    const suffixLen = parts.length > 2 && /^(co|com|org|net|ac|gov)$/.test(parts[parts.length - 2]) ? 2 : 1
    return parts[parts.length - 1 - suffixLen] || h
  }
  const la = label(x), lb = label(y)
  if (la && la === lb) return true
  // One being a subdomain of the other is not a move.
  return x.endsWith('.' + y) || y.endsWith('.' + x)
}
