import { useState, useEffect, useMemo } from 'react'
import { Newspaper } from 'lucide-react'
import { getNewsFeed, recencyCutoffISO } from '../lib/data'
import { supabase } from '../lib/supabase'
import { SectionHeading, Loader, EmptyState } from './ui'
import FilterSelect, { RECENCY_DATE, SORT_SIGNIF } from './Filters'
import FacetSidebar, { NO_FACETS } from './FacetSidebar'
import NewsList from './NewsList'
import { entityMatchesFacets } from '../lib/facets'

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

  const shown = useMemo(() => {
    const cutoff = recencyCutoffISO(recency)
    const rank = r => r.metadata?.rankScore ?? (r.relevance_score ?? 0) / 10
    let out = items.filter(i =>
      entityMatchesFacets(i, facets) &&
      (!cutoff || (i.published_at && i.published_at >= cutoff)) &&
      (!outlet || i.source === outlet)
    )
    out = [...out].sort((a, b) => sort === 'newest'
      ? new Date(b.published_at || 0) - new Date(a.published_at || 0)
      : rank(b) - rank(a))
    return out
  }, [items, facets, recency, outlet, sort])

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <SectionHeading kicker={kicker} title={title} sub={sub} />

      <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
        <FacetSidebar
          facets={facets}
          onChange={setFacets}
          extras={[
            ...(outletOptions.length > 1 ? [{ label: 'Outlet', value: outlet, onChange: setOutlet, options: outletOptions, allLabel: 'All outlets' }] : []),
            { label: 'Recency', value: recency, onChange: setRecency, options: RECENCY_DATE, allLabel: 'Any time' },
          ]}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-4 h-9 mb-6 border-b border-rule">
            <span className="text-[13px] font-sans text-muted">{shown.length.toLocaleString()} {shown.length === 1 ? 'story' : 'stories'}</span>
            <FilterSelect label="Sort" value={sort} onChange={setSort} options={SORT_SIGNIF} required />
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
