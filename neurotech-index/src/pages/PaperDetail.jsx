import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, ExternalLink, FileQuestion, Code2, Database, AlertTriangle, CopyCheck, ChevronDown } from 'lucide-react'
import { getPaperByPmid, getPaperSignals, getPaperCitations } from '../lib/data'
import { Loader, EmptyState, Kicker } from '../components/ui'
import { cardBadges } from '../lib/facets'
import { KindBadge } from '../components/PaperSignals'
import { StarButton } from '../components/Watch'
import { CiteButton } from '../components/Cite'

// Highwire Press + Dublin Core tags so the Zotero connector detects the page as
// one item. React 19 hoists <title>/<meta> rendered here into <head>.
function CitationMeta({ paper }) {
  const authors = Array.isArray(paper.authors) ? paper.authors : []
  const pdf = paper.source === 'arxiv' && paper.arxiv_id ? `https://arxiv.org/pdf/${paper.arxiv_id}` : null
  return (
    <>
      <title>{`${paper.title} · NeuroBase`}</title>
      <meta name="citation_title" content={paper.title} />
      {authors.map((a, i) => <meta key={i} name="citation_author" content={a} />)}
      {paper.year && <meta name="citation_publication_date" content={String(paper.year)} />}
      {paper.journal && <meta name="citation_journal_title" content={paper.journal} />}
      {paper.doi && <meta name="citation_doi" content={paper.doi} />}
      {pdf && <meta name="citation_pdf_url" content={pdf} />}
      <meta name="DC.title" content={paper.title} />
      {authors.length > 0 && <meta name="DC.creator" content={authors.join('; ')} />}
      {paper.year && <meta name="DC.date" content={String(paper.year)} />}
      {paper.doi && <meta name="DC.identifier" content={`doi:${paper.doi}`} />}
    </>
  )
}

const host = url => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

// A collapsible dropdown of linked papers (references / citations). Closed by
// default; the full list expands on click. cap guards the DOM on huge lists.
function CitedList({ title, papers, cap = 200 }) {
  if (!papers.length) return null
  return (
    <details className="group border-b border-rule">
      <summary className="flex items-center justify-between gap-3 py-3 cursor-pointer list-none select-none">
        <span className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted">
          {title} <span className="text-muted/70">{papers.length}</span>
        </span>
        <ChevronDown className="w-4 h-4 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="divide-y divide-rule pb-2">
        {papers.slice(0, cap).map(p => {
          const inner = (
            <>
              <span className="font-serif text-[1.02rem] leading-snug text-ink group-hover/row:text-accent">{p.title}</span>
              <span className="mt-0.5 block text-[12px] font-sans text-muted italic">{[p.journal, p.year].filter(Boolean).join(' · ')}</span>
            </>
          )
          return p.pubmed_id
            ? <Link key={p.id} to={`/paper/${p.pubmed_id}`} className="group/row block py-2.5">{inner}</Link>
            : <div key={p.id} className="py-2.5">{inner}</div>
        })}
        {papers.length > cap && <p className="pt-2.5 text-[13px] font-sans text-muted">{papers.length - cap} more.</p>}
      </div>
    </details>
  )
}

export default function PaperDetail() {
  const { pmid } = useParams()
  const [paper, setPaper] = useState(null)
  const [signals, setSignals] = useState({ contradictedBy: [], replicatedBy: [] })
  const [cites, setCites] = useState({ references: [], citedBy: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true); setSignals({ contradictedBy: [], replicatedBy: [] }); setCites({ references: [], citedBy: [] })
    getPaperByPmid(pmid).then(d => {
      if (!alive) return
      setPaper(d); setLoading(false)
      if (d?.id) {
        getPaperSignals(d.id).then(s => alive && setSignals(s))
        getPaperCitations(d.id).then(c => alive && setCites(c))
      }
    })
    return () => { alive = false }
  }, [pmid])

  if (loading) return <div className="max-w-prose mx-auto px-4 py-10"><Loader /></div>
  if (!paper) return <div className="max-w-prose mx-auto px-4 py-16"><EmptyState icon={FileQuestion} title="Paper not found">This paper isn’t in the index.</EmptyState></div>

  const authors = Array.isArray(paper.authors) ? paper.authors.join(', ') : paper.authors
  const badges = cardBadges(paper, 4)
  const codeUrls = Array.isArray(paper.code_urls) ? paper.code_urls : []
  const dataUrls = Array.isArray(paper.data_urls) ? paper.data_urls : []
  const versions = Array.isArray(paper.versions) ? paper.versions : []

  return (
    <article className="max-w-prose mx-auto px-4 sm:px-6 py-10">
      <Link to="/research" className="inline-flex items-center gap-1.5 text-[13px] font-sans text-muted hover:text-accent transition-colors mb-8">
        <ArrowLeft className="w-4 h-4" /> Back to Research
      </Link>

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <Kicker>Research</Kicker>
        <KindBadge source={paper.source} />
        {badges.map(b => (
          <span key={b} className="text-[11px] font-sans font-semibold uppercase tracking-[0.08em] text-accent">{b}</span>
        ))}
      </div>

      <CitationMeta paper={paper} />
      <div className="flex items-start justify-between gap-4">
        <h1 className="font-serif text-3xl sm:text-[2.4rem] leading-[1.12] font-semibold text-ink tracking-[-0.015em]">{paper.title}</h1>
        <div className="pt-1.5 shrink-0 flex items-center gap-2">
          <CiteButton paper={paper} />
          {paper.pubmed_id && <StarButton item={{ type: 'papers', id: paper.pubmed_id, label: paper.title, to: `/paper/${paper.pubmed_id}` }} />}
        </div>
      </div>

      {authors && <p className="mt-4 text-[15px] text-ink-soft font-body leading-relaxed">{authors}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted font-sans">
        {paper.journal && <span className="italic">{paper.journal}</span>}
        {paper.year && <><span aria-hidden>·</span><span>{paper.year}</span></>}
        {paper.doi && <><span aria-hidden>·</span><span>DOI {paper.doi}</span></>}
      </div>

      <div className="mb-8" />

      {/* Version history (Phase 6): the preprint(s) and published version this
          canonical record collapses. Shown only when more than one version. */}
      {versions.length > 1 && (
        <div className="mb-8 border border-rule rounded-sm bg-canvas/50 p-4">
          <p className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-2.5">Versions</p>
          <ul className="flex flex-col divide-y divide-rule">
            {versions.map((v, i) => (
              <li key={i} className="py-2 first:pt-0 last:pb-0 flex items-baseline justify-between gap-3">
                <span className="text-[13.5px] font-sans text-ink">
                  <span className={`font-semibold ${v.peer_reviewed ? 'text-accent' : 'text-muted'}`}>{v.peer_reviewed ? 'Peer-reviewed' : 'Preprint'}</span>
                  {v.source && <span className="text-muted"> · {v.source}</span>}
                  {v.year && <span className="text-muted"> · {v.year}</span>}
                </span>
                {v.url && <a href={v.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[13px] font-sans text-accent hover:underline">View</a>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {paper.abstract ? (
        <div className="mb-8">
          <p className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-2">Abstract</p>
          <p className="text-[1.12rem] leading-[1.7] text-ink font-body">{paper.abstract}</p>
        </div>
      ) : (
        <p className="mb-8 text-[15px] text-muted font-body italic">No abstract available. Read the full paper at the source.</p>
      )}

      {/* Reproducibility and provenance signals. Each appears only when present;
          absence of a code/data link is not evidence of absence, so nothing is
          shown in that case, and no reproducibility score is synthesized. */}
      {(signals.contradictedBy.length > 0 || signals.replicatedBy.length > 0) && (
        <div className="mb-8 border-t border-rule pt-6">
          {signals.contradictedBy.map(p => (
            <div key={p.id} className="mb-3">
              <span className="inline-flex items-center gap-1 text-[11px] font-sans font-semibold uppercase tracking-[0.07em] text-highlight mb-1"><AlertTriangle className="w-3.5 h-3.5" /> Contradicted by a later record</span>
              {p.pubmed_id
                ? <Link to={`/paper/${p.pubmed_id}`} className="block font-serif text-[1.05rem] text-ink hover:text-accent">{p.title}</Link>
                : <span className="block font-serif text-[1.05rem] text-ink">{p.title}</span>}
            </div>
          ))}
          {signals.replicatedBy.map(p => (
            <div key={p.id} className="mb-3">
              <span className="inline-flex items-center gap-1 text-[11px] font-sans font-semibold uppercase tracking-[0.07em] text-accent mb-1"><CopyCheck className="w-3.5 h-3.5" /> Replicated by a later record</span>
              {p.pubmed_id
                ? <Link to={`/paper/${p.pubmed_id}`} className="block font-serif text-[1.05rem] text-ink hover:text-accent">{p.title}</Link>
                : <span className="block font-serif text-[1.05rem] text-ink">{p.title}</span>}
            </div>
          ))}
        </div>
      )}

      {(codeUrls.length > 0 || dataUrls.length > 0) && (
        <div className="mb-8 flex flex-wrap gap-3">
          {codeUrls.map(u => (
            <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-sans px-3 py-1.5 rounded-full border border-rule text-ink-soft hover:border-accent hover:text-accent transition-colors">
              <Code2 className="w-3.5 h-3.5" /> Code available · {host(u)}
            </a>
          ))}
          {dataUrls.map(u => (
            <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-sans px-3 py-1.5 rounded-full border border-rule text-ink-soft hover:border-accent hover:text-accent transition-colors">
              <Database className="w-3.5 h-3.5" /> Data available · {host(u)}
            </a>
          ))}
        </div>
      )}

      {/* Intra-database citation graph (Phase 1 `cites` edges from OpenAlex).
          Shows only indexed papers; empty when this paper has no indexed
          references or citers. */}
      {(cites.references.length > 0 || cites.citedBy.length > 0) && (
        <div className="border-t border-rule pt-4 mb-8">
          <CitedList title="References in this index" papers={cites.references} />
          <CitedList title="Citations in this index" papers={cites.citedBy} />
        </div>
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
