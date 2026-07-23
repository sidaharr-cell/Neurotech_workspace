import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, ExternalLink, FileQuestion } from 'lucide-react'
import { getPaperByPmid } from '../lib/data'
import { Loader, EmptyState, Kicker } from '../components/ui'
import { cardBadges } from '../lib/facets'

export default function PaperDetail() {
  const { pmid } = useParams()
  const [paper, setPaper] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getPaperByPmid(pmid).then(d => { if (alive) { setPaper(d); setLoading(false) } })
    return () => { alive = false }
  }, [pmid])

  if (loading) return <div className="max-w-prose mx-auto px-4 py-10"><Loader /></div>
  if (!paper) return <div className="max-w-prose mx-auto px-4 py-16"><EmptyState icon={FileQuestion} title="Paper not found">This paper isn’t in the index.</EmptyState></div>

  const authors = Array.isArray(paper.authors) ? paper.authors.join(', ') : paper.authors
  const badges = cardBadges(paper, 4)

  return (
    <article className="max-w-prose mx-auto px-4 sm:px-6 py-10">
      <Link to="/research" className="inline-flex items-center gap-1.5 text-[13px] font-sans text-muted hover:text-accent transition-colors mb-8">
        <ArrowLeft className="w-4 h-4" /> Back to Research
      </Link>

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <Kicker>Research</Kicker>
        {badges.map(b => (
          <span key={b} className="text-[11px] font-sans font-semibold uppercase tracking-[0.08em] text-accent">{b}</span>
        ))}
      </div>

      <h1 className="font-serif text-3xl sm:text-[2.4rem] leading-[1.12] font-semibold text-ink tracking-[-0.015em]">{paper.title}</h1>

      {authors && <p className="mt-4 text-[15px] text-ink-soft font-body leading-relaxed">{authors}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted font-sans">
        {paper.journal && <span className="italic">{paper.journal}</span>}
        {paper.year && <><span aria-hidden>·</span><span>{paper.year}</span></>}
        {paper.doi && <><span aria-hidden>·</span><span>DOI {paper.doi}</span></>}
      </div>

      <div className="mb-8" />

      {paper.abstract ? (
        <div className="mb-8">
          <p className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-2">Abstract</p>
          <p className="text-[1.12rem] leading-[1.7] text-ink font-body">{paper.abstract}</p>
        </div>
      ) : (
        <p className="mb-8 text-[15px] text-muted font-body italic">No abstract available. Read the full paper at the source.</p>
      )}

      {paper.url && (
        <a href={paper.url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-ink text-paper text-[14px] font-sans font-medium px-5 py-2.5 rounded-sm hover:bg-accent transition-colors">
          Read the full paper <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </article>
  )
}
