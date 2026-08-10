import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Search, ChevronLeft, ChevronRight, SearchX } from 'lucide-react'
import { searchPapers, yearHistogram, facetCounts, getPaperSignalsBatch } from '../lib/data'
import { SectionHeading, Loader, EmptyState, Kicker, DeviceClassLabels } from '../components/ui'
import FilterSelect, { RECENCY_YEAR, RESEARCH_SOURCE, SORT_IMPACT, withPotentialImpact } from '../components/Filters'
import FilterBar from '../components/FilterBar'
import { useUrlFacets } from '../lib/useUrlFacets'
import { KindBadge, ReproBadges } from '../components/PaperSignals'
import { StarButton } from '../components/Watch'
import { CiteButton } from '../components/Cite'

const PAGE_SIZE = 20

function PaperRow({ paper, signals }) {
  const authors = Array.isArray(paper.authors)
    ? paper.authors.slice(0, 4).join(', ') + (paper.authors.length > 4 ? ' et al.' : '')
    : paper.authors
  return (
    <div className="group py-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 gap-y-1.5 mb-1.5 flex-wrap min-w-0">
          <Kicker>Research</Kicker>
          <KindBadge source={paper.source} />
          <DeviceClassLabels entity={paper} max={2} />
          <ReproBadges paper={paper} signals={signals} />
        </div>
        <CiteButton paper={paper} variant="icon" />
      </div>
      <Link to={`/paper/${paper.pubmed_id}`} className="block">
        <h3 className="font-serif text-[1.3rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-2">{paper.title}</h3>
        {authors && <p className="mt-1 text-[13px] text-muted font-sans line-clamp-1">{authors}</p>}
        <div className="mt-1 flex items-center gap-2 text-[13px] text-muted font-sans">
          {paper.journal && <span className="italic truncate max-w-[24rem]">{paper.journal}</span>}
          {paper.year && <><span aria-hidden>·</span><span>{paper.year}</span></>}
        </div>
        {paper.abstract && <p className="mt-1.5 text-[0.95rem] leading-relaxed text-ink-soft font-body line-clamp-2">{paper.abstract}</p>}
      </Link>
    </div>
  )
}

export default function Research() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [facets, setFacets] = useUrlFacets()
  const [recency, setRecency] = useState(null)
  const [year, setYear] = useState(null)          // histogram year selection { label, lo, hi }
  const [source, setSource] = useState(null)
  const [sort, setSort] = useState('relevant')
  const [page, setPage] = useState(0)
  const [{ rows, total }, setResult] = useState({ rows: [], total: 0 })
  const [signals, setSignals] = useState({})
  const [loading, setLoading] = useState(true)
  const [histogram, setHistogram] = useState(null)
  const [facetCts, setFacetCts] = useState(null)
  const debounce = useRef(null)
  const location = useLocation()
  // A saveable facet query (Phase 8): only meaningful when a facet is selected.
  const facetVals = [...facets.function, ...facets.access, ...facets.application]
  const queryItem = facetVals.length
    ? { type: 'query', id: `/research${location.search}`, to: `/research${location.search}`, label: `Research: ${facetVals.join(', ')}` }
    : null

  // Debounce the search box → query
  useEffect(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { setQuery(input); setPage(0) }, 350)
    return () => clearTimeout(debounce.current)
  }, [input])

  useEffect(() => { setPage(0) }, [facets, recency, year, source, sort])

  const load = useCallback(async () => {
    setLoading(true); setSignals({})
    const res = await searchPapers({ query, facets, recency, yearRange: year, source, sort, page, pageSize: PAGE_SIZE })
    setResult(res); setLoading(false)
    // Contradiction/replication badges for the visible rows, from the graph.
    const ids = res.rows.map(r => r.id).filter(Boolean)
    if (ids.length) getPaperSignalsBatch(ids).then(setSignals)
  }, [query, facets, recency, year, source, sort, page])

  useEffect(() => { load() }, [load])

  // Year histogram reflects the facet filters and scope, but not the search box —
  // so hide it during a text search, where its bars would not match the results.
  useEffect(() => {
    let alive = true
    if (query.trim()) { setHistogram(null); return }
    yearHistogram({ table: 'papers', facets }).then(h => { if (alive) setHistogram(h) })
    return () => { alive = false }
  }, [facets, query])

  // Per-facet-value counts, on the same terms as the histogram: facets and scope
  // only, hidden during a text search. One grouped query answered from the
  // covering index (migration 017) — a value at a time is not affordable here.
  useEffect(() => {
    let alive = true
    if (query.trim()) { setFacetCts(null); return }
    facetCounts({ table: 'papers', facets }).then(c => { if (alive) setFacetCts(c) })
    return () => { alive = false }
  }, [facets, query])

  // Three sources for one number, most trustworthy first, and all three are only
  // usable while nothing but the facets narrows the results.
  //
  //   facetCts.total   exact, and drops nothing.
  //   histogram sum    exact for every row it can PLACE, which is not every row:
  //                    an unparseable year, or one outside the buckets it emits,
  //                    is counted nowhere. Kept as the middle tier so a database
  //                    without migration 017's total row shows what it showed
  //                    before rather than falling through to the estimate.
  //   total            searchPapers counts `estimated` — a planner guess,
  //                    measured 25-28% low. It is the last resort, not the
  //                    default: the bar said 9,723 for Images and this said
  //                    7,293, on the same screen.
  const onlyFacetsNarrow = !query.trim() && !year && !recency && !source
  const shownTotal = onlyFacetsNarrow && facetCts?.total != null ? facetCts.total
    : onlyFacetsNarrow && histogram && histogram.length > 1 ? histogram.reduce((a, b) => a + b.n, 0)
    : total
  const pages = Math.ceil(shownTotal / PAGE_SIZE)

  return (
    <div className="page-wide py-8">
      <SectionHeading
        kicker="Research"
        title="Research"
        sub="A searchable index of neurotechnology papers and preprints from PubMed."
        right={<span className="font-sans text-[13px] text-muted whitespace-nowrap">{shownTotal.toLocaleString()} papers</span>}
      />

      <div className="relative max-w-2xl mb-8">
        <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-5 h-5 text-muted pointer-events-none" />
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Search titles and abstracts…"
          className="w-full pl-8 pr-4 py-2.5 bg-transparent border-b border-rule text-ink font-serif text-xl placeholder:text-muted/50 focus:outline-none focus:border-ink transition-colors"
        />
      </div>

      <div className="border-b border-rule mb-6">
        <FilterBar
          facets={facets}
          onChange={setFacets}
          histogram={histogram}
          year={year}
          onYear={setYear}
          counts={facetCts}
          sort={<FilterSelect label="Sort" value={sort} onChange={setSort} options={withPotentialImpact(SORT_IMPACT, 'research')} required />}
          extras={[
            { label: 'Article type', value: source, onChange: setSource, options: RESEARCH_SOURCE, allLabel: 'All types' },
            { label: 'Publication date', value: recency, onChange: setRecency, options: RECENCY_YEAR, allLabel: 'Any time' },
          ]}
        />
      </div>

      <div>
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-4 h-11 mb-6 border-b border-rule">
            <span className="text-[13px] font-sans text-muted">{shownTotal.toLocaleString()} results</span>
            <div className="flex items-center gap-3">
              {queryItem && <StarButton item={queryItem} />}
            </div>
          </div>

          {loading ? (
            <Loader />
          ) : rows.length === 0 ? (
            <EmptyState icon={SearchX} title="No papers found">Try different terms or clear the filters.</EmptyState>
          ) : (
            <>
              <div className="divide-rule">
                {rows.map((p, i) => <PaperRow key={p.pubmed_id || i} paper={p} signals={signals[p.id]} />)}
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
