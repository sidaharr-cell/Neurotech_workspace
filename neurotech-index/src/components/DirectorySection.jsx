import { useState, useEffect, useMemo } from 'react'
import { SearchX } from 'lucide-react'
import { SectionHeading, Loader, EmptyState } from './ui'
import { FacetFilters, NO_FACETS } from './Filters'
import { EntityRow, DetailPanel } from './Directory'
import { entityMatchesFacets } from '../lib/facets'

/** A reference-entity directory (Devices, Companies). `loader` must be stable. */
export default function DirectorySection({ kicker, title, sub, loader }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [facets, setFacets] = useState(NO_FACETS)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    loader().then(d => { if (alive) { setItems(d); setLoading(false) } })
    return () => { alive = false }
  }, [loader])

  const shown = useMemo(
    () => items.filter(e => entityMatchesFacets(e, facets)),
    [items, facets]
  )

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <SectionHeading kicker={kicker} title={title} sub={sub}
        right={<span className="font-sans text-[13px] text-muted">{shown.length} {shown.length === 1 ? 'entry' : 'entries'}</span>} />
      <div className="flex flex-wrap items-center gap-2 mb-8"><FacetFilters facets={facets} onChange={setFacets} /></div>
      {loading ? (
        <Loader />
      ) : shown.length === 0 ? (
        <EmptyState icon={SearchX} title="No entries match these filters" />
      ) : (
        <div className="max-w-4xl divide-rule">
          {shown.map((e, i) => <EntityRow key={i} entity={e} onClick={() => setSelected(e)} />)}
        </div>
      )}
      {selected && <DetailPanel entity={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
