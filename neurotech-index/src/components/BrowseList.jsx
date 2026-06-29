import { useState, useEffect, useMemo } from 'react'
import { SearchX } from 'lucide-react'
import { NeuralBackground, PageHeader, Loader, EmptyState } from './ui'
import { EntryCard, DetailPanel } from './entries'
import TopicBar from './TopicBar'
import { entityMatchesTopic, entityMatchesAxis } from '../lib/taxonomy'

/**
 * Generic entity browse surface: header + data-driven topic/axis filters +
 * card grid + slide-in detail. Used by Research, Devices, Organizations.
 */
export default function BrowseList({ eyebrow, title, sub, loader, showAxes = [], emptyHint }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [topic, setTopic] = useState(null)
  const [axes, setAxes] = useState({})
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    loader().then(data => { if (alive) { setItems(data); setLoading(false) } })
    return () => { alive = false }
  }, [loader])

  const onAxis = (key, val) => setAxes(a => ({ ...a, [key]: val }))

  const results = useMemo(() => {
    let list = items
    if (topic) list = list.filter(e => entityMatchesTopic(e, topic))
    for (const [key, val] of Object.entries(axes)) {
      if (val) list = list.filter(e => entityMatchesAxis(e, key, val))
    }
    return list
  }, [items, topic, axes])

  return (
    <div className="relative">
      <NeuralBackground className="h-72" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <PageHeader
          eyebrow={eyebrow}
          title={title}
          sub={sub}
        >
          <span className="font-mono text-sm text-muted">{results.length} {results.length === 1 ? 'entry' : 'entries'}</span>
        </PageHeader>

        <div className="mb-8">
          <TopicBar activeTopic={topic} onTopic={setTopic} axes={axes} onAxis={onAxis} showAxes={showAxes} />
        </div>

        {loading ? (
          <Loader label="Loading…" />
        ) : results.length === 0 ? (
          <EmptyState icon={SearchX} title="No entries match these filters">
            {emptyHint || 'Try clearing a topic or filter.'}
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {results.map((entry, i) => (
              <div key={`${entry._type}-${i}`} className="animate-slide-up" style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}>
                <EntryCard entry={entry} onClick={() => setSelected(entry)} />
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && <DetailPanel entry={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
