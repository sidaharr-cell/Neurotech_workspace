import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, ArrowUpRight, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { SectionHeading, Kicker, EmptyState, Loader, DeviceClassLabels } from '../components/ui'
import FilterBar from '../components/FilterBar'
import FundingChart from '../components/FundingChart'
import CapitalStageScatter from '../components/CapitalStageScatter'
import { searchLabs, searchCompanies, getOrgCounts, facetCounts } from '../lib/data'
import { useUrlFacets } from '../lib/useUrlFacets'
import { fmtMonthYear, getFundingBoard } from '../lib/fundingBoard'

const PAGE_SIZE = 20
const fmtMoney = m => (m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${m}M`)

const KINDS = [
  { id: 'company', label: 'Companies' },
  { id: 'lab', label: 'Labs' },
]

function OrgRow({ org, counts }) {
  const isLab = org.type === 'lab'
  const c = counts?.[org.id]
  // Both companies and labs route to their own internal NeuroBase page.
  const inner = (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-3 mb-1.5 flex-wrap">
        <Kicker>{isLab ? 'Lab' : 'Company'}</Kicker>
        <DeviceClassLabels entity={org} max={1} />
        {!isLab && org.funding > 0 && <span className="text-[11px] font-mono text-accent">{fmtMoney(org.funding)} raised</span>}
      </div>
      <h3 className="font-serif text-[1.3rem] leading-snug font-semibold text-ink tracking-[-0.01em]">
        <span className="headline-link inline-flex items-center gap-1.5 group-hover:text-accent transition-colors">
          {org.name}<ArrowUpRight className="w-3.5 h-3.5 text-muted opacity-60 group-hover:opacity-100 transition-opacity" />
        </span>
      </h3>
      <p className="mt-1 flex items-center gap-1 text-[13px] text-muted font-sans">
        {org.location && <><MapPin className="w-3.5 h-3.5" />{org.location}</>}
        {!isLab && org.founded && <><span aria-hidden>·</span>Founded {org.founded}</>}
        {/* Form D does not name the round, so this is the amount and month of
            the most recent filing rather than a "Series C" label. */}
        {!isLab && org.latestRaise > 0 && (
          <><span aria-hidden>·</span>Latest {fmtMoney(org.latestRaise)}
            {org.latestRaiseDate && ` ${fmtMonthYear(org.latestRaiseDate)}`}</>
        )}
      </p>
      {!isLab && c && (c.devices > 0 || c.trials > 0) && (
        <p className="mt-1 text-[12px] font-sans text-accent">
          {c.devices > 0 && <>{c.devices} linked device{c.devices === 1 ? '' : 's'}</>}
          {c.devices > 0 && c.trials > 0 && <span className="text-muted"> · </span>}
          {c.trials > 0 && <>{c.trials} linked trial{c.trials === 1 ? '' : 's'}</>}
        </p>
      )}
      {org.description && (
        isLab && org.description.includes('Focus:')
          ? (() => {
              const i = org.description.indexOf('Focus:')
              const head = org.description.slice(0, i).replace(/\s*$/, '')
              const focus = org.description.slice(i)
              return (
                <div className="mt-1.5 text-[0.95rem] leading-relaxed text-ink-soft font-body">
                  <div className="line-clamp-1">{head}</div>
                  <div className="line-clamp-1">{focus}</div>
                </div>
              )
            })()
          : <p className="mt-1.5 text-[0.95rem] leading-relaxed text-ink-soft font-body line-clamp-2">{org.description}</p>
      )}
    </div>
  )
  return <Link to={isLab ? `/lab/${org.id}` : `/company/${org.id}`} className="group block py-5">{inner}</Link>
}

export default function Companies() {
  const [kind, setKind] = useState('company')
  const [facets, setFacets] = useUrlFacets()
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [result, setResult] = useState({ rows: [], total: 0 })
  const [counts, setCounts] = useState({})          // per-org device/trial counts
  const [facetCts, setFacetCts] = useState(null)    // per-facet-value result counts
  const [loading, setLoading] = useState(false)
  const [board, setBoard] = useState(null)          // funding rows, shared by both charts
  const debounce = useRef(null)

  // One query feeds the funding chart and the capital-versus-stage scatter.
  useEffect(() => {
    let alive = true
    getFundingBoard().then(b => { if (alive) setBoard(b) }).catch(() => {})
    return () => { alive = false }
  }, [])

  // Per-facet-value counts, scoped to the current organization type.
  useEffect(() => {
    let alive = true
    facetCounts({ table: 'organizations', facets, extraFilter: q => q.eq('type', kind) })
      .then(c => { if (alive) setFacetCts(c) })
    return () => { alive = false }
  }, [facets, kind])

  useEffect(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { setQuery(input); setPage(0) }, 350)
    return () => clearTimeout(debounce.current)
  }, [input])
  useEffect(() => { setPage(0) }, [facets, kind])

  // Both companies and labs are server-side, paginated queries over the
  // organizations table (type='company' | 'lab').
  const load = useCallback(async () => {
    setLoading(true)
    setCounts({})
    const search = kind === 'lab' ? searchLabs : searchCompanies
    const res = await search({ query, facets, page, pageSize: PAGE_SIZE })
    setResult(res)
    setLoading(false)
    // Companies show graph-derived device/trial counts; labs do not.
    if (kind === 'company' && res.rows.length) {
      getOrgCounts(res.rows.map(r => r.id)).then(setCounts)
    }
  }, [kind, query, facets, page])
  useEffect(() => { load() }, [load])

  const pages = Math.ceil(result.total / PAGE_SIZE)
  const total = result.total

  return (
    <div className="page-wide py-8">
      <SectionHeading
        kicker="Companies and Labs"
        title="Companies"
        sub="Neurotechnology companies and NIH-funded research labs, with funding, focus, and location."
        right={<span className="font-sans text-[13px] text-muted whitespace-nowrap">{total.toLocaleString()} {kind === 'company' ? 'companies' : 'labs'}</span>}
      />

      <FundingChart board={board} />
      <CapitalStageScatter board={board} />

      <div className="mb-6">
        <div className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-2.5">Filter by organization type</div>
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
        <input value={input} onChange={e => setInput(e.target.value)} placeholder={kind === 'lab' ? 'Search labs…' : 'Search companies…'}
          className="w-full pl-8 pr-4 py-2.5 bg-transparent border-b border-rule text-ink font-serif text-xl placeholder:text-muted/50 focus:outline-none focus:border-ink transition-colors" />
      </div>

      <div className="border-b border-rule mb-6">
        <FilterBar facets={facets} onChange={setFacets} counts={facetCts} />
      </div>

      <div>
        <div className="min-w-0">
          <div className="flex items-center h-11 mb-6 border-b border-rule">
            <span className="text-[13px] font-sans text-muted">{total.toLocaleString()} {kind === 'company' ? 'companies' : 'labs'}</span>
          </div>
          {loading ? (
            <Loader />
          ) : result.rows.length === 0 ? (
            <EmptyState icon={MapPin} title={`No ${kind === 'company' ? 'companies' : 'labs'} match these filters`} />
          ) : (
            <>
              <div className="divide-rule">{result.rows.map((o, i) => <OrgRow key={o.id || i} org={o} counts={counts} />)}</div>
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
    </div>
  )
}
