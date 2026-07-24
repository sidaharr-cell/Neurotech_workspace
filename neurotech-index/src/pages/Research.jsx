import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Search, ChevronLeft, ChevronRight, SearchX } from 'lucide-react'
import { searchPapers, yearHistogram } from '../lib/data'
import { SectionHeading, Loader, EmptyState, Kicker, DeviceClassLabels } from '../components/ui'
import FilterSelect, { RECENCY_YEAR, RESEARCH_SOURCE, SORT_IMPACT } from '../components/Filters'
import FacetSidebar, { NO_FACETS } from '../components/FacetSidebar'

const PAGE_SIZE = 20

function PaperRow({ paper }) {
  const authors = Array.isArray(paper.authors)
    ? paper.authors.slice(0, 4).join(', ') + (paper.authors.length > 4 ? ' et al.' : '')
    : paper.authors
  return (
    <Link to={`/paper/${paper.pubmed_id}`} className="group block py-5">
      <div className="flex items-center gap-3 mb-1.5">
        <Kicker>Research</Kicker>
        <DeviceClassLabels entity={paper} max={2} />
      </div>
      <h3 className="font-serif text-[1.3rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-2">{paper.title}</h3>
      {authors && <p className="mt-1 text-[13px] text-muted font-sans line-clamp-1">{authors}</p>}
      <div className="mt-1 flex items-center gap-2 text-[13px] text-muted font-sans">
        {paper.journal && <span className="italic truncate max-w-[24rem]">{paper.journal}</span>}
        {paper.year && <><span aria-hidden>·</span><span>{paper.year}</span></>}
      </div>
      {paper.abstract && <p className="mt-1.5 text-[0.95rem] leading-relaxed text-ink-soft font-body line-clamp-2">{paper.abstract}</p>}
    </Link>
  )
}

export default function Research() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [facets, setFacets] = useState(NO_FACETS)
  const [recency, setRecency] = useState(null)
  const [year, setYear] = useState(null)          // histogram year selection { label, lo, hi }
  const [source, setSource] = useState(null)
  const [sort, setSort] = useState('relevant')
  const [page, setPage] = useState(0)
  const [{ rows, total }, setResult] = useState({ rows: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [histogram, setHistogram] = useState(null)
  const debounce = useRef(null)

  // Debounce the search box → query
  useEffect(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { setQuery(input); setPage(0) }, 350)
    return () => clearTimeout(debounce.current)
  }, [input])

  useEffect(() => { setPage(0) }, [facets, recency, year, source, sort])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await searchPapers({ query, facets, recency, yearRange: year, source, sort, page, pageSize: PAGE_SIZE })
    setResult(res); setLoading(false)
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

  // The histogram reflects facets + scope only. When no other filter narrows the
  // results (no search term, year click, recency, or source), its exact bucket
  // sum IS the result total — so show that, and the bars reconcile with the
  // count exactly. Otherwise show the actual search result count.
  const histReflectsResults = histogram && histogram.length > 1 && !query.trim() && !year && !recency && !source
  const shownTotal = histReflectsResults ? histogram.reduce((a, b) => a + b.n, 0) : total
  const pages = Math.ceil(shownTotal / PAGE_SIZE)

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
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

      <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
        <FacetSidebar
          facets={facets}
          onChange={setFacets}
          histogram={histogram}
          year={year}
          onYear={setYear}
          extras={[
            { label: 'Article type', value: source, onChange: setSource, options: RESEARCH_SOURCE, allLabel: 'All types' },
            { label: 'Publication date', value: recency, onChange: setRecency, options: RECENCY_YEAR, allLabel: 'Any time' },
          ]}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-4 h-9 mb-6 border-b border-rule">
            <span className="text-[13px] font-sans text-muted">{shownTotal.toLocaleString()} results</span>
            <FilterSelect label="Sort" value={sort} onChange={setSort} options={SORT_IMPACT} required />
          </div>

          {loading ? (
            <Loader />
          ) : rows.length === 0 ? (
            <EmptyState icon={SearchX} title="No papers found">Try different terms or clear the filters.</EmptyState>
          ) : (
            <>
              <div className="divide-rule">
                {rows.map((p, i) => <PaperRow key={p.pubmed_id || i} paper={p} />)}
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
