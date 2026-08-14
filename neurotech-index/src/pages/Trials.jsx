import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Search, FlaskConical, ChevronLeft, ChevronRight, ExternalLink, Activity } from 'lucide-react'
import { searchTrials, yearHistogram, facetCounts, getRecentTrialChanges, getTrialSponsors } from '../lib/data'
import { SectionHeading, Loader, EmptyState, Kicker, DeviceClassLabels, fmtDate } from '../components/ui'
import FilterSelect, { RECENCY_DATE, TRIAL_PHASE, TRIAL_STATUS, withPotentialImpact } from '../components/Filters'
import FilterBar from '../components/FilterBar'
import { useUrlFacets } from '../lib/useUrlFacets'
import { StarButton } from '../components/Watch'
import { groupTrialChanges, RECENT_CHANGES_FETCH, CHANGES_PER_TRIAL } from '../lib/trial-changes'

const PAGE_SIZE = 20
// Trials lead with recent status changes; that is the point of the view.
const SORT_TRIALS = [
  { id: 'changed', label: 'Recently changed' },
  { id: 'relevant', label: 'Most significant' },
  { id: 'newest', label: 'Newest' },
]
const prettyStatus = s => (s || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())

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

function TrialRow({ trial, sponsor }) {
  const m = trial.metadata || {}
  return (
    <div className="py-5">
      <div className="flex items-center gap-3 mb-1.5 flex-wrap">
        <Kicker>Clinical Trial</Kicker>
        <StatusBadge status={m.status} />
        {m.phase && <span className="text-[11px] font-sans font-semibold uppercase tracking-[0.06em] text-ink-soft">{m.phase}</span>}
        {m.nctId && <span className="text-[11px] font-mono text-muted">{m.nctId}</span>}
        <DeviceClassLabels entity={trial} max={1} />
      </div>
      <div className="flex items-start justify-between gap-3">
        <Link to={`/item/${trial.id}`} className="group block min-w-0">
          <h3 className="font-serif text-[1.3rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-2">{trial.title}</h3>
        </Link>
        <StarButton variant="icon" item={{ type: 'trials', id: trial.id, label: trial.title, to: `/item/${trial.id}` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted font-sans">
        {/* Sponsor links to the company page when the sponsored_by edge resolves it. */}
        {sponsor?.id
          ? <Link to={`/company/${sponsor.id}`} className="text-accent hover:underline truncate max-w-[22rem]">{sponsor.name || m.sponsor}</Link>
          : m.sponsor && <span className="truncate max-w-[22rem]">{m.sponsor}</span>}
        {m.enrollment ? <><span aria-hidden>·</span><span>n={m.enrollment}</span></> : null}
        {m.conditions?.[0] && <><span aria-hidden>·</span><span>{m.conditions.slice(0, 2).join(', ')}</span></>}
        {trial.published_at && <><span aria-hidden>·</span><span>{new Date(trial.published_at) > new Date() ? 'Starts' : 'Started'} {fmtDate(trial.published_at)}</span></>}
        <span aria-hidden>·</span>
        <a href={m.nctId ? `https://clinicaltrials.gov/study/${m.nctId}` : trial.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-accent transition-colors">ClinicalTrials.gov<ExternalLink className="w-3 h-3" /></a>
      </div>
    </div>
  )
}

const changeText = c => `${c.field}: ${c.field === 'status' ? prettyStatus(c.old_value) : (c.old_value || 'none')} to `
// Local day, to match the date the row prints rather than the UTC stamp.
const dayOf = iso => (iso ? new Date(iso).toDateString() : '')

/** Recently changed trials: dated status/phase/enrollment transitions. */
function RecentChanges({ changes }) {
  const groups = groupTrialChanges(changes)
  if (!groups.length) return null
  return (
    <div className="mb-8 border border-rule rounded-sm bg-canvas/50 p-4">
      <div className="flex items-center gap-2 text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-3">
        <Activity className="w-3.5 h-3.5 text-accent" /> Recently changed
      </div>
      {/* Borders are set per row rather than by `divide-y`, so the first row of
          each new day can carry a heavier rule and the days read as blocks. */}
      <ul className="flex flex-col">
        {groups.map((g, i) => {
          const newDay = i > 0 && dayOf(g.changedAt) !== dayOf(groups[i - 1].changedAt)
          return (
          <li key={g.key} className={`py-2.5 first:pt-0 last:pb-0 flex items-baseline justify-between gap-3 ${i === 0 ? '' : newDay ? 'border-t-2 border-ink/25 mt-1.5 pt-3.5' : 'border-t border-rule'}`}>
            <span className="min-w-0 font-sans">
              {/* The trial names itself first, and links to its record here rather
                  than to ClinicalTrials.gov; a reader following a status change
                  wants the trial, not the registry entry. Titles run past 150
                  characters, so the name takes its own line above the changes. */}
              {/* No `block` alongside line-clamp: both set `display`, and `block`
                  wins the cascade, so the clamp silently stops clamping. */}
              {g.itemId
                ? <Link to={`/item/${g.itemId}`} className="text-[13.5px] text-ink font-medium headline-link line-clamp-2">{g.title}</Link>
                : <span className="text-[13.5px] text-ink font-medium line-clamp-2">{g.title}</span>}
              {g.changes.slice(0, CHANGES_PER_TRIAL).map(c => (
                <span key={c.id} className="block mt-0.5 text-[12.5px] text-muted">
                  {changeText(c)}<span className="font-medium text-ink-soft">{c.field === 'status' ? prettyStatus(c.new_value) : (c.new_value || 'none')}</span>
                </span>
              ))}
              {g.changes.length > CHANGES_PER_TRIAL && (
                <span className="block mt-0.5 text-[12.5px] text-muted">+{g.changes.length - CHANGES_PER_TRIAL} earlier {g.changes.length - CHANGES_PER_TRIAL === 1 ? 'change' : 'changes'}</span>
              )}
            </span>
            {/* The date the trial last changed — the newest of the group. */}
            <span className="shrink-0 text-[12px] font-mono text-muted tabular-nums">{fmtDate(g.changedAt)}</span>
          </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function Trials() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [facets, setFacets] = useUrlFacets()
  const [recency, setRecency] = useState(null)
  const [phase, setPhase] = useState(null)
  const [status, setStatus] = useState(null)
  const [sort, setSort] = useState('changed')
  const [page, setPage] = useState(0)
  const [{ rows, total }, setResult] = useState({ rows: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [histogram, setHistogram] = useState(null)
  const [facetCts, setFacetCts] = useState(null)
  const [year, setYear] = useState(null)
  const [changes, setChanges] = useState([])
  const [sponsors, setSponsors] = useState({})
  const debounce = useRef(null)

  useEffect(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { setQuery(input); setPage(0) }, 350)
    return () => clearTimeout(debounce.current)
  }, [input])
  useEffect(() => { setPage(0) }, [facets, recency, year, phase, status, sort])

  const load = useCallback(async () => {
    setLoading(true)
    setSponsors({})
    const res = await searchTrials({ query, facets, recency, yearRange: year, phase, status, sort, page, pageSize: PAGE_SIZE })
    setResult(res); setLoading(false)
    // Resolve sponsor orgs for the visible rows so each can link to its company.
    if (res.rows.length) getTrialSponsors(res.rows.map(r => r.id)).then(setSponsors)
  }, [query, facets, recency, year, phase, status, sort, page])
  useEffect(() => { load() }, [load])

  // Recently changed trials (status/phase/enrollment), loaded once. Reads more
  // change rows than the panel shows trials, because grouping collapses several
  // rows into one entry and 12 rows would leave the panel short.
  useEffect(() => { getRecentTrialChanges(RECENT_CHANGES_FETCH).then(setChanges) }, [])

  // Histogram reflects facets + scope only; hide it during a text search.
  useEffect(() => {
    let alive = true
    if (query.trim()) { setHistogram(null); return }
    yearHistogram({ table: 'news_feed', from: 2010, facets }).then(h => { if (alive) setHistogram(h) })
    return () => { alive = false }
  }, [facets, query])

  // Per-facet-value counts, on the same terms as the histogram: facets and scope
  // only, hidden during a text search. Trials share news_feed with the press
  // items, so the count is scoped to entry_type='trial' the way searchTrials is.
  useEffect(() => {
    let alive = true
    if (query.trim()) { setFacetCts(null); return }
    facetCounts({ table: 'news_feed', facets, kind: ['trial'] })
      .then(c => { if (alive) setFacetCts(c) })
    return () => { alive = false }
  }, [facets, query])

  // searchTrials counts `exact` and scopes to entry_type='trial', so its own
  // total is right for every filter this page offers, and nothing here needs a
  // fallback. It used to print the year histogram's bucket sum instead, which
  // was wrong twice over: the histogram reads the whole news_feed table, so it
  // counted press items as trials, and it drops any row it cannot place in a
  // year it emits — on a facet of 155 trials it printed 152, losing one undated
  // record and two dated 2027. The facet count agrees with this independently,
  // which is the check that it is right.
  const shownTotal = total
  const pages = Math.ceil(shownTotal / PAGE_SIZE)

  return (
    <div className="page-wide py-8">
      <SectionHeading
        kicker="Clinical Trials"
        title="Trials & Studies"
        sub="A searchable index of neurotechnology trials from ClinicalTrials.gov."
        right={<span className="font-sans text-[13px] text-muted whitespace-nowrap">{shownTotal.toLocaleString()} trials</span>}
      />

      <div className="relative max-w-2xl mb-8">
        <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-5 h-5 text-muted pointer-events-none" />
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="Search trials…"
          className="w-full pl-8 pr-4 py-2.5 bg-transparent border-b border-rule text-ink font-serif text-xl placeholder:text-muted/50 focus:outline-none focus:border-ink transition-colors" />
      </div>

      <RecentChanges changes={changes} />

      <div className="border-b border-rule mb-6">
        <FilterBar
          facets={facets}
          onChange={setFacets}
          histogram={histogram}
          year={year}
          onYear={setYear}
          counts={facetCts}
          sort={<FilterSelect label="Sort" value={sort} onChange={setSort} options={withPotentialImpact(SORT_TRIALS, 'trial')} required />}
          extras={[
            { label: 'Phase', value: phase, onChange: setPhase, options: TRIAL_PHASE, allLabel: 'All phases' },
            { label: 'Status', value: status, onChange: setStatus, options: TRIAL_STATUS, allLabel: 'Any status' },
            { label: 'Recency', value: recency, onChange: setRecency, options: RECENCY_DATE, allLabel: 'Any time' },
          ]}
        />
      </div>

      <div>
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-4 h-11 mb-6 border-b border-rule">
            <span className="text-[13px] font-sans text-muted">{shownTotal.toLocaleString()} results</span>
          </div>

          {loading ? (
            <Loader />
          ) : rows.length === 0 ? (
            <EmptyState icon={FlaskConical} title="No trials found">Try different terms or clear the filters.</EmptyState>
          ) : (
            <>
              <div className="divide-rule">
                {rows.map((t, i) => <TrialRow key={t.id || i} trial={t} sponsor={sponsors[t.id]} />)}
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
    </div>
  )
}
