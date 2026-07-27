/**
 * uuid.js — deterministic UUIDv5 (RFC 4122, SHA-1 namespaced).
 *
 * Company rows are rebuilt nightly (delete + insert), so a random primary key
 * would change every run and break every /company/:id URL and cached analytics
 * file. Deriving the id from the company name keeps it stable: same name in →
 * same uuid out, forever.
 */
import { createHash } from 'node:crypto'

// A fixed namespace for NeuroBase company ids (any constant UUID works).
const NAMESPACE = '6f9b1c2e-3d4a-5b6c-7d8e-9f0a1b2c3d4e'

const hexToBytes = hex => Uint8Array.from(hex.replace(/-/g, '').match(/.{2}/g).map(b => parseInt(b, 16)))

export function uuidv5(name, namespace = NAMESPACE) {
  const ns = hexToBytes(namespace)
  const data = Buffer.concat([Buffer.from(ns), Buffer.from(String(name), 'utf8')])
  const hash = createHash('sha1').update(data).digest() // 20 bytes
  const b = hash.subarray(0, 16)
  b[6] = (b[6] & 0x0f) | 0x50 // version 5
  b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
  const h = Buffer.from(b).toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
