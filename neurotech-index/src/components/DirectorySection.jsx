import { useState, useEffect, useMemo } from 'react'
import { SearchX } from 'lucide-react'
import { SectionHeading, Loader, EmptyState } from './ui'
import DeviceClassFilter from './DeviceClassFilter'
import { EntityRow, DetailPanel } from './Directory'
import { entityMatchesClass } from '../lib/taxonomy'

/** A reference-entity directory (Devices, Companies). `loader` must be stable. */
export default function DirectorySection({ kicker, title, sub, loader }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [cls, setCls] = useState(null)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    loader().then(d => { if (alive) { setItems(d); setLoading(false) } })
    return () => { alive = false }
  }, [loader])

  const shown = useMemo(
    () => (cls ? items.filter(e => entityMatchesClass(e, cls)) : items),
    [items, cls]
  )

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <SectionHeading kicker={kicker} title={title} sub={sub}
        right={<span className="font-sans text-[13px] text-muted">{shown.length} {shown.length === 1 ? 'entry' : 'entries'}</span>} />
      <DeviceClassFilter value={cls} onChange={setCls} />
      {loading ? (
        <Loader />
      ) : shown.length === 0 ? (
        <EmptyState icon={SearchX} title="No entries match this device class" />
      ) : (
        <div className="max-w-4xl divide-rule">
          {shown.map((e, i) => <EntityRow key={i} entity={e} onClick={() => setSelected(e)} />)}
        </div>
      )}
      {selected && <DetailPanel entity={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
