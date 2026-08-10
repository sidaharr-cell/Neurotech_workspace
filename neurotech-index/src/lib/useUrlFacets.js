import { useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * useUrlFacets — a drop-in replacement for `useState(NO_FACETS)` that keeps the
 * three-facet selection in the URL query string, so a filtered view is
 * shareable and linkable (Phase 4). Same shape and semantics as the old state:
 * returns [facets, setFacets] where facets is { function, access, application }.
 *
 * Params are repeated keys: ?fn=records&fn=decodes&ax=implanted_penetrating&app=...
 *
 * The returned `facets` object is memoized on the serialized param values, so it
 * keeps a stable identity between renders when the URL has not changed. That
 * matters because the pages use `facets` as an effect/callback dependency; a
 * fresh object every render would reload in a loop.
 */
const KEYS = { function: 'fn', access: 'ax', application: 'app' }

export function useUrlFacets() {
  const [params, setParams] = useSearchParams()

  const fn = params.getAll('fn'), ax = params.getAll('ax'), app = params.getAll('app')
  const sig = `${fn}|${ax}|${app}`
  const facets = useMemo(
    () => ({ function: fn, access: ax, application: app }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig],
  )

  const setFacets = useCallback(next => {
    setParams(prev => {
      const p = new URLSearchParams(prev)
      for (const [key, param] of Object.entries(KEYS)) {
        p.delete(param)
        for (const v of next[key] || []) p.append(param, v)
      }
      return p
      // replace: a checkbox toggle should not push a new history entry per click.
    }, { replace: true })
  }, [setParams])

  return [facets, setFacets]
}

/**
 * The facet part of a query string, as a `?…` suffix to hang on a link, or ''
 * when nothing is selected.
 *
 * This is what carries a selection from one page to the next: the reader who
 * narrowed the front page to implanted BCIs and then opened Trials meant to stay
 * narrowed, and used to arrive at an unfiltered page with no sign their filter
 * had been dropped.
 *
 * ONLY the three facets travel, and that is the whole point rather than a
 * shortcut. They are the one vocabulary every page shares (src/lib/facets.js),
 * so a value means the same thing wherever it lands. The single-select extras do
 * not survive the trip and must not be carried: every page names its own, and
 * the ones that look common are not. Recency is 'week' | 'month' | 'year' on the
 * feed and 'y1' | 'y3' | 'y10' on research, so carrying it across would set a
 * filter to a value the destination cannot read.
 *
 * The search box does not travel either. A term typed to find one paper is not a
 * standing filter, and `q` means something different on every page that has one.
 */
const FACET_PARAMS = Object.values(KEYS)

export function facetSearch(search) {
  const from = new URLSearchParams(search)
  const out = new URLSearchParams()
  for (const param of FACET_PARAMS) for (const v of from.getAll(param)) out.append(param, v)
  const s = out.toString()
  return s ? `?${s}` : ''
}
