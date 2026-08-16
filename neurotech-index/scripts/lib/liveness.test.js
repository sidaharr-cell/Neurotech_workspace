import { describe, it, expect } from 'vitest'
import { classify, sameRegistrable, STATUS } from './liveness.js'

const at = (host, over = {}) =>
  classify({ requestedHost: host, finalUrl: `https://${host}/`, status: 200, errorCode: null, ...over })

describe('classify', () => {
  it('passes a site that answers from its own host', () => {
    expect(at('acme.com').status).toBe(STATUS.OK)
  })

  it('treats www and a subdomain as the same site', () => {
    expect(at('acme.com', { finalUrl: 'https://www.acme.com/' }).status).toBe(STATUS.OK)
    expect(at('www.acme.com', { finalUrl: 'https://acme.com/about' }).status).toBe(STATUS.OK)
    expect(at('acme.com', { finalUrl: 'https://usa.acme.com/' }).status).toBe(STATUS.OK)
  })

  // The whole point: a parking page is a healthy 200 with its own footer year.
  it('calls out a parking host even though it answered 200', () => {
    for (const host of ['hugedomains.com', 'forsale.godaddy.com', 'sedo.com', 'afternic.com']) {
      const r = classify({ requestedHost: 'frasen.com', finalUrl: `https://${host}/x`, status: 200, errorCode: null })
      expect(r.status, host).toBe(STATUS.PARKED)
    }
  })

  it('calls out the ww38 redirect artefact', () => {
    // pufferfishapps.com resolved only as ww38.pufferfishapps.com.
    const r = at('pufferfishapps.com', { finalUrl: 'https://ww38.pufferfishapps.com/' })
    expect(r.status).toBe(STATUS.PARKED)
  })

  it('checks parking BEFORE the status code, since parking pages return 200', () => {
    const r = classify({ requestedHost: 'x.com', finalUrl: 'https://hugedomains.com/', status: 404, errorCode: null })
    expect(r.status).toBe(STATUS.PARKED)
  })

  it('flags a redirect to a genuinely different domain', () => {
    // bionicvis.com now serves polonorterestaurant.com.
    const r = at('bionicvis.com', { finalUrl: 'https://polonorterestaurant.com/' })
    expect(r.status).toBe(STATUS.OFF_HOST)
    expect(r.detail).toBe('polonorterestaurant.com')
  })

  it('separates the error kinds, because they mean different things', () => {
    const err = (errorCode) => classify({ requestedHost: 'acme.com', finalUrl: null, status: null, errorCode })
    expect(err('ENOTFOUND').status).toBe(STATUS.DNS)
    expect(err('EAI_AGAIN').status).toBe(STATUS.DNS)
    expect(err('ERR_TLS_CERT_ALTNAME_INVALID').status).toBe(STATUS.TLS)
    expect(err('ECONNREFUSED').status).toBe(STATUS.REFUSED)
  })

  it('reports an http error when the host is the right one', () => {
    expect(at('acme.com', { status: 404 }).status).toBe(STATUS.HTTP_ERROR)
    expect(at('acme.com', { status: 521 }).status).toBe(STATUS.HTTP_ERROR)
  })

  it('says nothing usable was stored rather than inventing a result', () => {
    expect(classify({ requestedHost: null }).status).toBe(STATUS.NO_URL)
  })

  /**
   * The case this CANNOT catch, recorded so nobody trusts a clean run too far.
   * energizekids.com answers 200 from its own host and serves a Dutch school
   * platform. lucine.io answers 200 and serves a Telegram bot that kept the
   * name. Both read as `ok` here and are wrong; only a person reading the page
   * finds them.
   */
  it('reports ok for a resold domain that kept its own hostname', () => {
    expect(at('energizekids.com').status).toBe(STATUS.OK)
    expect(at('lucine.io').status).toBe(STATUS.OK)
  })
})

describe('sameRegistrable', () => {
  it('ignores www', () => {
    expect(sameRegistrable('acme.com', 'www.acme.com')).toBe(true)
  })

  it('treats a move between TLDs as the same brand', () => {
    // incereb.com and incereb.ie are one company; reducept.com redirects to .nl.
    expect(sameRegistrable('reducept.com', 'reducept.nl')).toBe(true)
    expect(sameRegistrable('incereb.com', 'incereb.ie')).toBe(true)
  })

  it('handles a two-label public suffix', () => {
    expect(sameRegistrable('acme.co.uk', 'www.acme.co.uk')).toBe(true)
  })

  it('sees a real move', () => {
    expect(sameRegistrable('newtouchdigital.com', 'neurorpm.com')).toBe(false)
    expect(sameRegistrable('savonix.com', 'footyrankings.com')).toBe(false)
  })
})

describe('numeric error codes', () => {
  it('reads a bare number as an OpenSSL verify failure, not a refused connection', () => {
    // Observed in a real run: NeoSensory and Blino both returned code 20,
    // "unable to get local issuer certificate". Falling through to REFUSED
    // would have described a certificate problem as a network one.
    const r = classify({ requestedHost: 'neosensory.com', finalUrl: null, status: null, errorCode: 20 })
    expect(r.status).toBe(STATUS.TLS)
    expect(r.detail).toContain('20')
  })
})
