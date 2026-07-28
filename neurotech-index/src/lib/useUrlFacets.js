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
