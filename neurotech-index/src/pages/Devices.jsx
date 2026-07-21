import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Cpu, ScrollText, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react'
import { searchDevices, searchPatents } from '../lib/data'
import { SectionHeading, Loader, EmptyState, Kicker, DeviceClassLabels } from '../components/ui'
import { EntityRow, DetailPanel } from '../components/Directory'
import FilterSelect, { DEVICE_CLASS_OPTIONS, RECENCY_YEAR, DEVICE_FDA, SORT_DATE } from '../components/Filters'

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
  const [cls, setCls] = useState(null)
  const [recency, setRecency] = useState(null)
  const [fda, setFda] = useState(null)
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(0)
  const [{ rows, total }, setResult] = useState({ rows: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const debounce = useRef(null)
  const isPatent = kind === 'patent'

  useEffect(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { setQuery(input); setPage(0) }, 350)
    return () => clearTimeout(debounce.current)
  }, [input])
  useEffect(() => { setPage(0) }, [cls, recency, fda, sort, kind])

  const load = useCallback(async () => {
    setLoading(true)
    const res = isPatent
      ? await searchPatents({ query, deviceClass: cls, recency, sort, page, pageSize: PAGE_SIZE })
      : await searchDevices({ query, deviceClass: cls, recency, fda, sort, page, pageSize: PAGE_SIZE })
    setResult(res); setLoading(false)
  }, [isPatent, query, cls, recency, fda, sort, page])
  useEffect(() => { load() }, [load])

  const pages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <SectionHeading
        kicker="Devices & Patents"
        title="Devices & Patents"
        sub="FDA-cleared and approved neurotechnology devices, plus a classification-defined index of neurotech patents."
        right={<span className="font-sans text-[13px] text-muted whitespace-nowrap">{total.toLocaleString()} {isPatent ? 'patents' : 'devices'}</span>}
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

      <div className="relative max-w-2xl mb-6">
        <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-5 h-5 text-muted pointer-events-none" />
        <input value={input} onChange={e => setInput(e.target.value)}
          placeholder={isPatent ? 'Search patents, assignees…' : 'Search devices and manufacturers…'}
          className="w-full pl-8 pr-4 py-2.5 bg-transparent border-b border-rule text-ink font-serif text-xl placeholder:text-muted/50 focus:outline-none focus:border-ink transition-colors" />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-8">
        <FilterSelect label="Class" value={cls} onChange={setCls} options={DEVICE_CLASS_OPTIONS} allLabel="All classes" />
        {!isPatent && <FilterSelect label="FDA route" value={fda} onChange={setFda} options={DEVICE_FDA} allLabel="Any route" />}
        <FilterSelect label="Recency" value={recency} onChange={setRecency} options={RECENCY_YEAR} allLabel="Any time" />
        <FilterSelect label="Sort" value={sort} onChange={setSort} options={SORT_DATE} required />
      </div>

      {loading ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyState icon={isPatent ? ScrollText : Cpu} title={`No ${isPatent ? 'patents' : 'devices'} found`}>
          {isPatent ? 'Patents populate after the backfill runs.' : 'Try different terms or clear the device-class filter.'}
        </EmptyState>
      ) : (
        <>
          <div className="max-w-4xl divide-rule">
            {isPatent
              ? rows.map((p, i) => <PatentRow key={p.patent_number || i} p={p} />)
              : rows.map((d, i) => <EntityRow key={d.id || i} entity={d} onClick={() => setSelected(d)} />)}
          </div>
          {pages > 1 && (
            <div className="max-w-4xl flex items-center justify-between mt-8 pt-5 border-t border-rule">
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
      {selected && !isPatent && <DetailPanel entity={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
