import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Search, SearchX } from 'lucide-react'
import { getPapers, getDevices, getOrganizations, getResearchers } from '../lib/data'
import { Loader, EmptyState, Kicker, typeWord } from '../components/ui'
import { DetailPanel } from '../components/Directory'
import { FacetFilters, NO_FACETS } from '../components/Filters'
import { entityMatchesFacets } from '../lib/facets'
import { slugify } from '../lib/links'

// People excluded from default scope (opt-in only).
const SCOPES = [
  { id: 'all', label: 'All', types: ['papers', 'devices', 'organizations'] },
  { id: 'research', label: 'Research', types: ['papers'] },
  { id: 'devices', label: 'Devices', types: ['devices'] },
  { id: 'companies', label: 'Companies', types: ['organizations'] },
  { id: 'people', label: 'People', types: ['researchers'], optIn: true },
]

function ResultRow({ entity, onOpen }) {
  const t = entity._type
  const title = entity.name || entity.title
  const sub = t === 'papers'
    ? (Array.isArray(entity.authors) ? entity.authors.slice(0, 3).join(', ') + (entity.authors.length > 3 ? ' et al.' : '') : entity.authors)
    : entity.manufacturer || entity.location || entity.affiliation

  const inner = (
    <div className="min-w-0 flex-1">
      <div className="mb-1.5"><Kicker>{typeWord(t)}</Kicker></div>
      <h3 className="font-serif text-[1.25rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-2">{title}</h3>
      {sub && <p className="mt-1 text-[13px] text-muted font-sans line-clamp-1">{sub}</p>}
      {entity.abstract && <p className="mt-1.5 text-[0.95rem] text-ink-soft font-body line-clamp-2">{entity.abstract}</p>}
      {entity.description && <p className="mt-1.5 text-[0.95rem] text-ink-soft font-body line-clamp-2">{entity.description}</p>}
    </div>
  )

  if (t === 'papers' && entity.url) return <a href={entity.url} target="_blank" rel="noopener noreferrer" className="group flex py-5">{inner}</a>
  if (t === 'researchers') return <Link to={`/people/${slugify(entity.name)}`} className="group flex py-5">{inner}</Link>
  return <button onClick={onOpen} className="group w-full text-left flex py-5">{inner}</button>
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') || ''
  const [input, setInput] = useState(query)
  const [all, setAll] = useState([])
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState('all')
  const [facets, setFacets] = useState(NO_FACETS)
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
    list = list.filter(e => entityMatchesFacets(e, facets))
    return list.slice(0, 100)
  }, [all, scope, query, facets])

  const submit = e => { e.preventDefault(); setParams(input.trim() ? { q: input.trim() } : {}) }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="border-b-2 border-ink pb-4 mb-6">
        <Kicker className="block mb-2">Search</Kicker>
        <form onSubmit={submit} className="relative max-w-2xl">
          <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-5 h-5 text-muted pointer-events-none" />
          <input
            autoFocus
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Search research, devices, companies…"
            className="w-full pl-8 pr-4 py-2 bg-transparent border-b border-rule text-ink font-serif text-2xl placeholder:text-muted/50 focus:outline-none focus:border-ink transition-colors"
          />
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        {SCOPES.map(s => (
          <button key={s.id} onClick={() => setScope(s.id)}
            className={`text-[13px] font-sans px-3 py-1.5 rounded-full border transition-colors ${scope === s.id ? 'bg-ink text-paper border-ink' : 'bg-paper text-ink-soft border-rule hover:border-ink'}`}>
            {s.label}{s.optIn && <span className="ml-1 text-[10px] uppercase opacity-60">opt-in</span>}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-5"><FacetFilters facets={facets} onChange={setFacets} /></div>

      <p className="text-[13px] text-muted font-sans mb-4">
        {results.length}{results.length === 100 ? '+' : ''} {results.length === 1 ? 'result' : 'results'}
        {query && <> for <span className="text-ink font-medium">“{query}”</span></>}
      </p>

      {loading ? (
        <Loader />
      ) : results.length === 0 ? (
        <EmptyState icon={SearchX} title="No results">Try different terms, a broader scope, or clear the filters.</EmptyState>
      ) : (
        <div className="max-w-4xl divide-rule">
          {results.map((e, i) => <ResultRow key={`${e._type}-${i}`} entity={e} onOpen={() => setSelected(e)} />)}
        </div>
      )}
      {selected && <DetailPanel entity={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
