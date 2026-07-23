import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Search, FlaskConical, ChevronLeft, ChevronRight } from 'lucide-react'
import { searchTrials } from '../lib/data'
import { SectionHeading, Loader, EmptyState, Kicker, DeviceClassLabels, fmtDate } from '../components/ui'
import FilterSelect, { FacetFilters, NO_FACETS, RECENCY_DATE, TRIAL_PHASE, TRIAL_STATUS, SORT_SIGNIF } from '../components/Filters'

const PAGE_SIZE = 20

const STATUS_STYLE = {
  RECRUITING: 'text-mint border-mint/40 bg-mint/10',
  ENROLLING_BY_INVITATION: 'text-mint border-mint/40 bg-mint/10',
  ACTIVE_NOT_RECRUITING: 'text-accent border-accent/30 bg-accent-soft',
  COMPLETED: 'text-muted border-rule bg-canvas',
}
function StatusBadge({ status }) {
  if (!status) return null
  const label = status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
  return <span className={`text-[10px] font-sans font-semibold uppercase tracking-[0.08em] px-2 py-0.5 rounded-sm border ${STATUS_STYLE[status] || 'text-muted border-rule bg-canvas'}`}>{label}</span>
}

function TrialRow({ trial }) {
  const m = trial.metadata || {}
  return (
    <Link to={`/item/${trial.id}`} className="group block py-5">
      <div className="flex items-center gap-3 mb-1.5 flex-wrap">
        <Kicker>Clinical Trial</Kicker>
        <StatusBadge status={m.status} />
        {m.phase && <span className="text-[11px] font-sans font-semibold uppercase tracking-[0.06em] text-ink-soft">{m.phase}</span>}
        <DeviceClassLabels entity={trial} max={1} />
      </div>
      <h3 className="font-serif text-[1.3rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-2">{trial.title}</h3>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted font-sans">
        {m.sponsor && <span className="truncate max-w-[22rem]">{m.sponsor}</span>}
        {m.conditions?.[0] && <><span aria-hidden>·</span><span>{m.conditions.slice(0, 2).join(', ')}</span></>}
        {trial.published_at && <><span aria-hidden>·</span><span>{new Date(trial.published_at) > new Date() ? 'Starts' : 'Started'} {fmtDate(trial.published_at)}</span></>}
      </div>
    </Link>
  )
}

export default function Trials() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [facets, setFacets] = useState(NO_FACETS)
  const [recency, setRecency] = useState(null)
  const [phase, setPhase] = useState(null)
  const [status, setStatus] = useState(null)
  const [sort, setSort] = useState('relevant')
  const [page, setPage] = useState(0)
  const [{ rows, total }, setResult] = useState({ rows: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const debounce = useRef(null)

  useEffect(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { setQuery(input); setPage(0) }, 350)
    return () => clearTimeout(debounce.current)
  }, [input])
  useEffect(() => { setPage(0) }, [facets, recency, phase, status, sort])

  const load = useCallback(async () => {
    setLoading(true)
    setResult(await searchTrials({ query, facets, recency, phase, status, sort, page, pageSize: PAGE_SIZE }))
    setLoading(false)
  }, [query, facets, recency, phase, status, sort, page])
  useEffect(() => { load() }, [load])

  const pages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <SectionHeading
        kicker="Clinical Trials"
        title="Trials & Studies"
        sub="A searchable index of neurotechnology trials from ClinicalTrials.gov."
        right={<span className="font-sans text-[13px] text-muted whitespace-nowrap">{total.toLocaleString()} trials</span>}
      />

      <div className="relative max-w-2xl mb-6">
        <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-5 h-5 text-muted pointer-events-none" />
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="Search trials…"
          className="w-full pl-8 pr-4 py-2.5 bg-transparent border-b border-rule text-ink font-serif text-xl placeholder:text-muted/50 focus:outline-none focus:border-ink transition-colors" />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-8">
        <FacetFilters facets={facets} onChange={setFacets} />
        <FilterSelect label="Phase" value={phase} onChange={setPhase} options={TRIAL_PHASE} allLabel="All phases" />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={TRIAL_STATUS} allLabel="Any status" />
        <FilterSelect label="Recency" value={recency} onChange={setRecency} options={RECENCY_DATE} allLabel="Any time" />
        <FilterSelect label="Sort" value={sort} onChange={setSort} options={SORT_SIGNIF} required />
      </div>

      {loading ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyState icon={FlaskConical} title="No trials found">Try different terms or clear the filters.</EmptyState>
      ) : (
        <>
          <div className="max-w-4xl divide-rule">
            {rows.map((t, i) => <TrialRow key={t.id || i} trial={t} />)}
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
    </div>
  )
}
