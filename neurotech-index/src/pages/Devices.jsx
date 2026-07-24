import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Cpu, ScrollText, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react'
import { searchDevices, searchPatents, yearHistogram } from '../lib/data'
import { SectionHeading, Loader, EmptyState, Kicker, DeviceClassLabels } from '../components/ui'
import { EntityRow, DetailPanel } from '../components/Directory'
import FilterSelect, { RECENCY_YEAR, DEVICE_FDA, SORT_DATE } from '../components/Filters'
import FacetSidebar, { NO_FACETS } from '../components/FacetSidebar'

const PAGE_SIZE = 20
const KINDS = [
  { id: 'device', label: 'Devices' },
  { id: 'patent', label: 'Patents' },
]

function PatentRow({ p }) {
  return (
    <a href={p.url} target="_blank" rel="noopener noreferrer" className="group block py-5">
      <div className="flex items-center gap-3 mb-1.5 flex-wrap">
        <Kicker>Patent</Kicker>
        <DeviceClassLabels entity={p} max={2} />
        <span className="text-[11px] font-mono text-muted">{p.patent_number}</span>
      </div>
      <h3 className="font-serif text-[1.3rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link inline-flex items-start gap-1.5 line-clamp-2">
        {p.title}<ExternalLink className="w-3.5 h-3.5 mt-1.5 text-muted opacity-60 group-hover:opacity-100 transition-opacity shrink-0" />
      </h3>
      <p className="mt-1 flex items-center gap-2 text-[13px] text-muted font-sans">
        {p.assignee && <span className="truncate max-w-[24rem]">{p.assignee}</span>}
        {p.grant_date && <><span aria-hidden>·</span><span>{String(p.grant_date).slice(0, 4)}</span></>}
      </p>
      {p.abstract && <p className="mt-1.5 text-[0.95rem] leading-relaxed text-ink-soft font-body line-clamp-2">{p.abstract}</p>}
    </a>
  )
}

export default function Devices() {
  const [kind, setKind] = useState('device')
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [facets, setFacets] = useState(NO_FACETS)
  const [recency, setRecency] = useState(null)
  const [fda, setFda] = useState(null)
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(0)
  const [{ rows, total }, setResult] = useState({ rows: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [histogram, setHistogram] = useState(null)
  const [year, setYear] = useState(null)
  const debounce = useRef(null)
  const isPatent = kind === 'patent'

  useEffect(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { setQuery(input); setPage(0) }, 350)
    return () => clearTimeout(debounce.current)
  }, [input])
  useEffect(() => { setPage(0) }, [facets, recency, year, fda, sort, kind])
  useEffect(() => { setYear(null) }, [kind])          // year buckets differ between devices/patents

  const load = useCallback(async () => {
    setLoading(true)
    const res = isPatent
      ? await searchPatents({ query, facets, recency, yearRange: year, sort, page, pageSize: PAGE_SIZE })
      : await searchDevices({ query, facets, recency, yearRange: year, fda, sort, page, pageSize: PAGE_SIZE })
    setResult(res); setLoading(false)
  }, [isPatent, query, facets, recency, year, fda, sort, page])
  useEffect(() => { load() }, [load])

  // Histogram reflects facets + scope only; hide it during a text search.
  useEffect(() => {
    let alive = true
    if (query.trim()) { setHistogram(null); return }
    yearHistogram({ table: isPatent ? 'patents' : 'devices', from: isPatent ? 2000 : 2010, facets })
      .then(h => { if (alive) setHistogram(h) })
    return () => { alive = false }
  }, [facets, isPatent, query])

  const histReflectsResults = histogram && histogram.length > 1 && !query.trim() && !year && !recency && !fda
  const shownTotal = histReflectsResults ? histogram.reduce((a, b) => a + b.n, 0) : total
  const pages = Math.ceil(shownTotal / PAGE_SIZE)

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <SectionHeading
        kicker="Devices & Patents"
        title="Devices & Patents"
        sub="FDA-cleared and approved neurotechnology devices, plus a classification-defined index of neurotech patents."
        right={<span className="font-sans text-[13px] text-muted whitespace-nowrap">{shownTotal.toLocaleString()} {isPatent ? 'patents' : 'devices'}</span>}
      />

      <div className="mb-6">
        <div className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-2.5">View</div>
        <div className="flex flex-wrap items-center gap-2">
          {KINDS.map(k => (
            <button key={k.id} onClick={() => setKind(k.id)}
              className={`text-[13px] font-sans px-3.5 py-1.5 rounded-full border transition-colors ${kind === k.id ? 'bg-ink text-paper border-ink' : 'bg-paper text-ink-soft border-rule hover:border-ink'}`}>
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative max-w-2xl mb-8">
        <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-5 h-5 text-muted pointer-events-none" />
        <input value={input} onChange={e => setInput(e.target.value)}
          placeholder={isPatent ? 'Search patents, assignees…' : 'Search devices and manufacturers…'}
          className="w-full pl-8 pr-4 py-2.5 bg-transparent border-b border-rule text-ink font-serif text-xl placeholder:text-muted/50 focus:outline-none focus:border-ink transition-colors" />
      </div>

      <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
        <FacetSidebar
          facets={facets}
          onChange={setFacets}
          histogram={histogram}
          year={year}
          onYear={setYear}
          extras={[
            ...(!isPatent ? [{ label: 'FDA route', value: fda, onChange: setFda, options: DEVICE_FDA, allLabel: 'Any route' }] : []),
            { label: 'Recency', value: recency, onChange: setRecency, options: RECENCY_YEAR, allLabel: 'Any time' },
          ]}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-4 h-9 mb-6 border-b border-rule">
            <span className="text-[13px] font-sans text-muted">{shownTotal.toLocaleString()} results</span>
            <FilterSelect label="Sort" value={sort} onChange={setSort} options={SORT_DATE} required />
          </div>

          {loading ? (
            <Loader />
          ) : rows.length === 0 ? (
            <EmptyState icon={isPatent ? ScrollText : Cpu} title={`No ${isPatent ? 'patents' : 'devices'} found`}>
              {isPatent ? 'Patents populate after the backfill runs.' : 'Try different terms or clear the filters.'}
            </EmptyState>
          ) : (
            <>
              <div className="divide-rule">
                {isPatent
                  ? rows.map((p, i) => <PatentRow key={p.patent_number || i} p={p} />)
                  : rows.map((d, i) => <EntityRow key={d.id || i} entity={d} onClick={() => setSelected(d)} />)}
              </div>
              {pages > 1 && (
                <div className="flex items-center justify-between mt-8 pt-5 border-t border-rule">
                  <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}
                    className="inline-flex items-center gap-1 text-[13px] font-sans text-ink disabled:text-muted/40 disabled:cursor-not-allowed hover:text-accent transition-colors">
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </button>
                  <span className="text-[13px] font-sans text-muted">Page {page + 1} of {pages.toLocaleString()}</span>
                  <button disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}
                    className="inline-flex items-center gap-1 text-[13px] font-sans text-ink disabled:text-muted/40 disabled:cursor-not-allowed hover:text-accent transition-colors">
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {selected && !isPatent && <DetailPanel entity={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
