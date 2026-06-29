import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, SearchX } from 'lucide-react'
import { getPapers, getDevices, getOrganizations, getResearchers } from '../lib/data'
import { NeuralBackground, Loader, EmptyState } from '../components/ui'
import { EntryCard, DetailPanel } from '../components/entries'
import TopicBar from '../components/TopicBar'
import { entityMatchesTopic } from '../lib/taxonomy'

// People are intentionally excluded from the default scope (opt-in only).
const SCOPES = [
  { id: 'all', label: 'All', types: ['papers', 'devices', 'organizations'] },
  { id: 'research', label: 'Research', types: ['papers'] },
  { id: 'devices', label: 'Devices', types: ['devices'] },
  { id: 'organizations', label: 'Organizations', types: ['organizations'] },
  { id: 'people', label: 'People', types: ['researchers'], optIn: true },
]

export default function SearchPage() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') || ''
  const [input, setInput] = useState(query)
  const [all, setAll] = useState([])
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState('all')
  const [topic, setTopic] = useState(null)
  const [selected, setSelected] = useState(null)

  useEffect(() => { setInput(query) }, [query])

  useEffect(() => {
    let alive = true
    Promise.all([getPapers(), getDevices(), getOrganizations(), getResearchers()])
      .then(([p, d, o, r]) => { if (alive) { setAll([...p, ...d, ...o, ...r]); setLoading(false) } })
    return () => { alive = false }
  }, [])

  const results = useMemo(() => {
    const types = SCOPES.find(s => s.id === scope).types
    let list = all.filter(e => types.includes(e._type))
    const q = query.toLowerCase().trim()
    if (q) list = list.filter(e => JSON.stringify(e).toLowerCase().includes(q))
    if (topic) list = list.filter(e => entityMatchesTopic(e, topic))
    return list
  }, [all, scope, query, topic])

  const submit = (e) => { e.preventDefault(); setParams(input.trim() ? { q: input.trim() } : {}) }

  return (
    <div className="relative">
      <NeuralBackground className="h-72" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <p className="font-mono text-xs text-primary-light uppercase tracking-[0.2em] mb-2">Universal search</p>
        <form onSubmit={submit} className="relative max-w-2xl mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted pointer-events-none" />
          <input
            autoFocus
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Search across research, devices, organizations…"
            className="w-full pl-12 pr-4 py-3.5 bg-surface/80 border border-divider rounded-2xl text-ink placeholder-muted/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all shadow-panel"
          />
        </form>

        <div className="flex flex-wrap items-center gap-1.5 mb-5">
          {SCOPES.map(s => (
            <button
              key={s.id}
              onClick={() => setScope(s.id)}
              className={`text-sm font-medium px-3.5 py-1.5 rounded-full border transition-all ${
                scope === s.id
                  ? 'bg-primary text-white border-primary shadow-glow'
                  : 'glass text-muted hover:text-ink hover:border-primary/40'
              } ${s.optIn ? 'ml-1' : ''}`}
            >
              {s.label}{s.optIn && <span className="ml-1.5 text-[9px] font-mono uppercase opacity-60">opt-in</span>}
            </button>
          ))}
        </div>

        <div className="mb-8"><TopicBar activeTopic={topic} onTopic={setTopic} /></div>

        <p className="text-sm text-muted mb-5">
          {results.length} {results.length === 1 ? 'result' : 'results'}
          {query && <> for <span className="text-ink font-medium">"{query}"</span></>}
        </p>

        {loading ? (
          <Loader />
        ) : results.length === 0 ? (
          <EmptyState icon={SearchX} title="No results">Try different terms, a broader scope, or clear the topic filter.</EmptyState>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {results.map((entry, i) => (
              <EntryCard key={`${entry._type}-${i}`} entry={entry} onClick={() => setSelected(entry)} />
            ))}
          </div>
        )}
      </div>
      {selected && <DetailPanel entry={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
