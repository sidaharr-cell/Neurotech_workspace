import { useSyncExternalStore } from 'react'

/**
 * watchlist.js — local-first watchlist (Phase 8). There is no authentication in
 * NeuroBase (see docs/architecture-audit.md), so a user's watchlist lives in the
 * browser (localStorage), never on a server. A watched item is
 *   { type, id, label, url?, addedAt }
 * where type is an entity kind ('organizations' | 'devices' | 'papers' |
 * 'trials') or 'query' (a saved facet search, id = the path). No email is sent;
 * the "what changed" view is computed on demand from the real change log.
 */

const KEY = 'neurobase.watchlist.v1'
const SEEN = 'neurobase.watchlist.seen'

const listeners = new Set()
let cache = null   // stable reference so useSyncExternalStore doesn't loop

function read() {
  if (cache) return cache
  try { cache = JSON.parse(localStorage.getItem(KEY) || '[]') } catch { cache = [] }
  if (!Array.isArray(cache)) cache = []
  return cache
}
function write(items) {
  cache = items
  try { localStorage.setItem(KEY, JSON.stringify(items)) } catch { /* quota/full: keep in memory */ }
  listeners.forEach(l => l())
}

// Cross-tab: another tab changed the list.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => { if (e.key === KEY) { cache = null; listeners.forEach(l => l()) } })
}

const same = (a, b) => a.type === b.type && String(a.id) === String(b.id)

export function getWatchlist() { return read() }
export function isWatched(type, id) { return read().some(i => same(i, { type, id })) }
export function toggleWatch(item) {
  const items = read()
  const i = items.findIndex(x => same(x, item))
  write(i >= 0 ? items.filter((_, k) => k !== i) : [{ ...item, addedAt: Date.now() }, ...items])
}
export function removeWatch(type, id) { write(read().filter(i => !same(i, { type, id }))) }
export function subscribe(l) { listeners.add(l); return () => listeners.delete(l) }

export function getLastSeen() { return Number(localStorage.getItem(SEEN) || 0) }
export function markSeen() { try { localStorage.setItem(SEEN, String(Date.now())) } catch { /* ignore */ } }

// ── React bindings ──────────────────────────────────────────────────────────
export function useWatchlist() {
  return useSyncExternalStore(subscribe, getWatchlist, () => [])
}
export function useIsWatched(type, id) {
  return useSyncExternalStore(subscribe, () => isWatched(type, id), () => false)
}
