import { useState, useEffect, useMemo } from 'react'
import { Newspaper } from 'lucide-react'
import { getNewsFeed, recencyCutoffISO } from '../lib/data'
import { supabase } from '../lib/supabase'
import { SectionHeading, Loader, EmptyState } from './ui'
import FilterSelect, { RECENCY_DATE, SORT_SIGNIF } from './Filters'
import FilterBar, { NO_FACETS } from './FilterBar'
import NewsList from './NewsList'
import { entityMatchesFacets, countFacets } from '../lib/facets'

/**
 * A content-typed editorial news section (home feed, Media, Research).
 * `entryTypes` should be a stable (module-level) array or null for all types.
 */
export default function NewsSection({ kicker, title, sub, entryTypes = null, lead = true, emptyHint }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [facets, setFacets] = useState(NO_FACETS)
  const [recency, setRecency] = useState(null)
  const [outlet, setOutlet] = useState(null)
  const [sort, setSort] = useState('relevant')

  useEffect(() => {
    let alive = true
    setLoading(true)
    getNewsFeed({ entryTypes, limit: 60 }).then(d => { if (alive) { setItems(d); setLoading(false) } })
    return () => { alive = false }
  }, [entryTypes])

  // Outlet options: the outlets actually present, most-frequent first (top 12).
  const outletOptions = useMemo(() => {
    const counts = {}
    items.forEach(i => { if (i.source) counts[i.source] = (counts[i.source] || 0) + 1 })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([s]) => ({ id: s, label: s }))
  }, [items])

  // Everything recency and outlet allow, before any facet is applied. The facet
  // counts come off this list, so they answer the question the reader is asking:
  // how many of the stories in front of me does this value hold. The section
  // filters in memory, so the counts can be exact about every other filter too —
  // unlike the server-side pages, which count facets and scope alone.
  const candidates = useMemo(() => {
    const cutoff = recencyCutoffISO(recency)
    return items.filter(i =>
      (!cutoff || (i.published_at && i.published_at >= cutoff)) &&
      (!outlet || i.source === outlet)
    )
  }, [items, recency, outlet])

  const facetCts = useMemo(() => countFacets(candidates, facets), [candidates, facets])

  const shown = useMemo(() => {
    const rank = r => r.metadata?.rankScore ?? (r.relevance_score ?? 0) / 10
    return [...candidates.filter(i => entityMatchesFacets(i, facets))].sort((a, b) => sort === 'newest'
      ? new Date(b.published_at || 0) - new Date(a.published_at || 0)
      : rank(b) - rank(a))
  }, [candidates, facets, sort])

  return (
    <div className="page-wide py-8">
      <SectionHeading kicker={kicker} title={title} sub={sub} />

      <div className="border-b border-rule mb-6">
        <FilterBar
          facets={facets}
          onChange={setFacets}
          counts={facetCts}
          sort={<FilterSelect label="Sort" value={sort} onChange={setSort} options={SORT_SIGNIF} required />}
          extras={[
            ...(outletOptions.length > 1 ? [{ label: 'Outlet', value: outlet, onChange: setOutlet, options: outletOptions, allLabel: 'All outlets' }] : []),
            { label: 'Recency', value: recency, onChange: setRecency, options: RECENCY_DATE, allLabel: 'Any time' },
          ]}
        />
      </div>

      <div>
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-4 h-9 mb-6 border-b border-rule">
            <span className="text-[13px] font-sans text-muted">{shown.length.toLocaleString()} {shown.length === 1 ? 'story' : 'stories'}</span>
          </div>

          {!supabase ? (
            <EmptyState icon={Newspaper} title="Feed unavailable offline">Connect Supabase to see the live feed.</EmptyState>
          ) : loading ? (
            <Loader label="Loading…" />
          ) : shown.length === 0 ? (
            <EmptyState icon={Newspaper} title="Nothing here yet">
              {(facets.function?.length || facets.access?.length || facets.application?.length) ? 'No items match these filters right now.' : (emptyHint || 'The feed populates after the daily refresh.')}
            </EmptyState>
          ) : (
            <NewsList items={shown} lead={lead} />
          )}
        </div>
      </div>
    </div>
  )
}
