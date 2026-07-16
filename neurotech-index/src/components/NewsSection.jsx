import { useState, useEffect, useMemo } from 'react'
import { Newspaper } from 'lucide-react'
import { getNewsFeed, recencyCutoffISO } from '../lib/data'
import { supabase } from '../lib/supabase'
import { SectionHeading, Loader, EmptyState } from './ui'
import DeviceClassFilter from './DeviceClassFilter'
import FilterPills, { RECENCY_DATE, SORT_RANK } from './Filters'
import NewsList from './NewsList'
import { entityMatchesClass } from '../lib/taxonomy'

/**
 * A content-typed editorial news section (home feed, Media, Research).
 * `entryTypes` should be a stable (module-level) array or null for all types.
 */
export default function NewsSection({ kicker, title, sub, entryTypes = null, lead = true, emptyHint }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [cls, setCls] = useState(null)
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
      (!cls || entityMatchesClass(i, cls)) &&
      (!cutoff || (i.published_at && i.published_at >= cutoff)) &&
      (!outlet || i.source === outlet)
    )
    out = [...out].sort((a, b) => sort === 'newest'
      ? new Date(b.published_at || 0) - new Date(a.published_at || 0)
      : rank(b) - rank(a))
    return out
  }, [items, cls, recency, outlet, sort])

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <SectionHeading kicker={kicker} title={title} sub={sub} />
      <DeviceClassFilter value={cls} onChange={setCls} />
      <div className="flex flex-wrap gap-x-10 gap-y-1 mb-8">
        {outletOptions.length > 1 && <FilterPills label="Outlet" value={outlet} onChange={setOutlet} options={outletOptions} />}
        <FilterPills label="Recency" value={recency} onChange={setRecency} options={RECENCY_DATE} />
        <FilterPills label="Sort" value={sort} onChange={setSort} options={SORT_RANK} required />
      </div>
      {!supabase ? (
        <EmptyState icon={Newspaper} title="Feed unavailable offline">Connect Supabase to see the live feed.</EmptyState>
      ) : loading ? (
        <Loader label="Loading…" />
      ) : shown.length === 0 ? (
        <EmptyState icon={Newspaper} title="Nothing here yet">
          {cls ? 'No items match this device class right now.' : (emptyHint || 'The feed populates after the daily refresh.')}
        </EmptyState>
      ) : (
        <div className="max-w-4xl">
          <NewsList items={shown} lead={lead} />
        </div>
      )}
    </div>
  )
}
