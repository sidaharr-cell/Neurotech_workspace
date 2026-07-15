import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Search, ChevronLeft, ChevronRight, SearchX } from 'lucide-react'
import { searchPapers } from '../lib/data'
import { SectionHeading, Loader, EmptyState, Kicker, DeviceClassLabels } from '../components/ui'
import DeviceClassFilter from '../components/DeviceClassFilter'

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
  const [cls, setCls] = useState(null)
  const [page, setPage] = useState(0)
  const [{ rows, total }, setResult] = useState({ rows: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const debounce = useRef(null)

  // Debounce the search box → query
  useEffect(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { setQuery(input); setPage(0) }, 350)
    return () => clearTimeout(debounce.current)
  }, [input])

  useEffect(() => { setPage(0) }, [cls])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await searchPapers({ query, deviceClass: cls, page, pageSize: PAGE_SIZE })
    setResult(res); setLoading(false)
  }, [query, cls, page])

  useEffect(() => { load() }, [load])

  const pages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <SectionHeading
        kicker="Research"
        title="Research"
        sub="A searchable index of neurotechnology papers and preprints from PubMed."
        right={<span className="font-sans text-[13px] text-muted whitespace-nowrap">{total.toLocaleString()} papers</span>}
      />

      <div className="relative max-w-2xl mb-6">
        <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-5 h-5 text-muted pointer-events-none" />
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Search titles and abstracts…"
          className="w-full pl-8 pr-4 py-2.5 bg-transparent border-b border-rule text-ink font-serif text-xl placeholder:text-muted/50 focus:outline-none focus:border-ink transition-colors"
        />
      </div>

      <DeviceClassFilter value={cls} onChange={setCls} />

      {loading ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyState icon={SearchX} title="No papers found">Try different terms or clear the device-class filter.</EmptyState>
      ) : (
        <>
          <div className="max-w-4xl divide-rule">
            {rows.map((p, i) => <PaperRow key={p.pubmed_id || i} paper={p} />)}
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
