import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { MapPin, ExternalLink, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { SectionHeading, Kicker, EmptyState, Loader, DeviceClassLabels } from '../components/ui'
import { FacetFilters, NO_FACETS } from '../components/Filters'
import FundingChart from '../components/FundingChart'
import { searchLabs } from '../lib/data'
import { entityMatchesFacets } from '../lib/facets'
import { classify } from '../lib/classify'
import companiesJson from '../data/companies.json'

const PAGE_SIZE = 20
const fmtMoney = m => (m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${m}M`)
// Curated companies are static JSON with no facet columns, so classify them
// once here (the classifier is pure browser-safe ES modules) — the same
// deterministic classifier the database rows went through.
const CURATED_COMPANIES = companiesJson
  .filter(o => o.type === 'company')
  .map(c => ({ ...c, ...classify(c, 'organizations') }))

const KINDS = [
  { id: 'company', label: 'Companies' },
  { id: 'lab', label: 'Labs' },
]

// NIH RePORTER doesn't give lab website URLs, so link the lab name to a
// targeted search (PI + institution) whose top result is the lab's homepage.
function labSearchUrl(org) {
  const pi = (org.founders?.[0] || org.name.replace(/\s*Lab\s*$/i, '')).replace(/\s+/g, ' ').trim()
  const inst = (org.description || '').split(' · ')[0].trim()
  const q = `${pi} ${inst} lab`.replace(/\s+/g, ' ').trim()
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`
}

function OrgRow({ org }) {
  const isLab = org.type === 'lab'
  const nameHref = isLab ? labSearchUrl(org) : org.website
  const inner = (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-3 mb-1.5 flex-wrap">
        <Kicker>{isLab ? 'Lab' : 'Company'}</Kicker>
        <DeviceClassLabels entity={org} max={1} />
        {!isLab && org.funding > 0 && <span className="text-[11px] font-mono text-accent">{fmtMoney(org.funding)} raised</span>}
      </div>
      <h3 className="font-serif text-[1.3rem] leading-snug font-semibold text-ink tracking-[-0.01em]">
        {nameHref ? (
          <a href={nameHref} target="_blank" rel="noopener noreferrer"
            className="headline-link inline-flex items-center gap-1.5 hover:text-accent transition-colors">
            {org.name}<ExternalLink className="w-3.5 h-3.5 text-muted opacity-60 group-hover:opacity-100 transition-opacity" />
          </a>
        ) : (
          <span className="headline-link inline-flex items-center gap-1.5">{org.name}</span>
        )}
      </h3>
      <p className="mt-1 flex items-center gap-1 text-[13px] text-muted font-sans">
        {org.location && <><MapPin className="w-3.5 h-3.5" />{org.location}</>}
        {!isLab && org.founded && <><span aria-hidden>·</span>Founded {org.founded}</>}
        {!isLab && org.latestRound && <><span aria-hidden>·</span>{org.latestRound} {org.roundYear}</>}
      </p>
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
  // Companies still link the whole row to their site; labs link only the name
  // (so the row itself isn't a dead link).
  return (!isLab && org.website)
    ? <a href={org.website} target="_blank" rel="noopener noreferrer" className="group block py-5">{inner}</a>
    : <div className="group py-5">{inner}</div>
}

export default function Companies() {
  const [kind, setKind] = useState('company')
  const [facets, setFacets] = useState(NO_FACETS)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [labs, setLabs] = useState({ rows: [], total: 0 })
  const [loading, setLoading] = useState(false)
  const debounce = useRef(null)

  useEffect(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { setQuery(input); setPage(0) }, 350)
    return () => clearTimeout(debounce.current)
  }, [input])
  useEffect(() => { setPage(0) }, [facets, kind])

  const loadLabs = useCallback(async () => {
    if (kind !== 'lab') return
    setLoading(true)
    setLabs(await searchLabs({ query, facets, page, pageSize: PAGE_SIZE }))
    setLoading(false)
  }, [kind, query, facets, page])
  useEffect(() => { loadLabs() }, [loadLabs])

  // Companies are curated + static; filter client-side.
  const companies = useMemo(() => {
    let list = CURATED_COMPANIES
    const t = query.trim().toLowerCase()
    if (t) list = list.filter(c => c.name.toLowerCase().includes(t))
    list = list.filter(c => entityMatchesFacets(c, facets))
    return [...list].sort((a, b) => (b.funding || 0) - (a.funding || 0))
  }, [query, facets])

  const pages = Math.ceil(labs.total / PAGE_SIZE)
  const total = kind === 'company' ? companies.length : labs.total

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <SectionHeading
        kicker="Companies & Labs"
        title="Companies"
        sub="Neurotechnology companies and NIH-funded research labs, with funding, focus, and location."
        right={<span className="font-sans text-[13px] text-muted whitespace-nowrap">{total.toLocaleString()} {kind === 'company' ? 'companies' : 'labs'}</span>}
      />

      <FundingChart companies={companiesJson} />

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

      <div className="relative max-w-2xl mb-6">
        <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-5 h-5 text-muted pointer-events-none" />
        <input value={input} onChange={e => setInput(e.target.value)} placeholder={kind === 'lab' ? 'Search labs…' : 'Search companies…'}
          className="w-full pl-8 pr-4 py-2.5 bg-transparent border-b border-rule text-ink font-serif text-xl placeholder:text-muted/50 focus:outline-none focus:border-ink transition-colors" />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-8"><FacetFilters facets={facets} onChange={setFacets} /></div>

      {kind === 'company' ? (
        companies.length === 0
          ? <EmptyState icon={MapPin} title="No companies match these filters" />
          : <div className="max-w-4xl divide-rule">{companies.map((o, i) => <OrgRow key={i} org={o} />)}</div>
      ) : loading ? (
        <Loader />
      ) : labs.rows.length === 0 ? (
        <EmptyState icon={MapPin} title="No labs match these filters" />
      ) : (
        <>
          <div className="max-w-4xl divide-rule">{labs.rows.map((o, i) => <OrgRow key={o.id || i} org={o} />)}</div>
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
