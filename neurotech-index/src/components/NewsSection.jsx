import { useState, useEffect, useMemo } from 'react'
import { Newspaper } from 'lucide-react'
import { getNewsFeed } from '../lib/data'
import { supabase } from '../lib/supabase'
import { SectionHeading, Loader, EmptyState } from './ui'
import DeviceClassFilter from './DeviceClassFilter'
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

  useEffect(() => {
    let alive = true
    setLoading(true)
    getNewsFeed({ entryTypes, limit: 60 }).then(d => { if (alive) { setItems(d); setLoading(false) } })
    return () => { alive = false }
  }, [entryTypes])

  const shown = useMemo(
    () => (cls ? items.filter(i => entityMatchesClass(i, cls)) : items),
    [items, cls]
  )

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <SectionHeading kicker={kicker} title={title} sub={sub} />
      <DeviceClassFilter value={cls} onChange={setCls} />
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
