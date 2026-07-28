import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, ExternalLink, FlaskConical, Banknote, FileText, Users, Target } from 'lucide-react'
import { getLabById } from '../lib/data'
import { Loader, EmptyState, Kicker } from '../components/ui'
import { cardBadges } from '../lib/facets'
import { StarButton } from '../components/Watch'

function Section({ icon: Icon, title, note, children }) {
  return (
    <section className="border-t border-rule pt-7 mt-9">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h2 className="flex items-center gap-2.5 font-serif text-[1.4rem] font-semibold text-ink tracking-[-0.01em]">
          <Icon className="w-[18px] h-[18px] text-accent shrink-0" strokeWidth={1.75} /> {title}
        </h2>
        {note && <span className="text-[12.5px] font-sans text-muted whitespace-nowrap">{note}</span>}
      </div>
      {children}
    </section>
  )
}

export default function LabPage() {
  const { id } = useParams()
  const [lab, setLab] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getLabById(id).then(l => { if (alive) { setLab(l); setLoading(false) } })
    return () => { alive = false }
  }, [id])

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-12"><Loader /></div>
  if (!lab) return <div className="max-w-3xl mx-auto px-4 py-16"><EmptyState icon={FlaskConical} title="Lab not found">This lab isn’t in the index.</EmptyState></div>

  const pi = Array.isArray(lab.founders) ? lab.founders.filter(Boolean) : []
  const badges = cardBadges(lab, 6)
  // Authoritative publications: a PubMed search for the PI. Any that are in our
  // index also appear under Research (all indexed papers are searchable there).
  const pubmedUrl = pi[0]
    ? `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(`${pi[0]}[Author]`)}`
    : `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(lab.name)}`
  const reporterUrl = pi[0]
    ? `https://reporter.nih.gov/search/?projects.piNames=${encodeURIComponent(pi[0])}`
    : 'https://reporter.nih.gov/'

  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <Link to="/companies" className="inline-flex items-center gap-1.5 text-[13px] font-sans text-muted hover:text-accent transition-colors mb-8">
        <ArrowLeft className="w-4 h-4" /> Back to Companies and Labs
      </Link>

      {/* Header */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <Kicker>Lab</Kicker>
        {badges.map(b => (
          <span key={b} className="text-[11px] font-sans font-semibold uppercase tracking-[0.08em] text-accent">{b}</span>
        ))}
      </div>
      <div className="flex items-start justify-between gap-4">
        <h1 className="font-serif text-3xl sm:text-[2.4rem] leading-[1.12] font-semibold text-ink tracking-[-0.015em]">{lab.name}</h1>
        <div className="pt-1.5 shrink-0"><StarButton item={{ type: 'organizations', id: lab.id, label: lab.name, to: `/lab/${lab.id}` }} /></div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-muted font-sans">
        {lab.institution && <span>{lab.institution}</span>}
        {lab.location && <><span aria-hidden>·</span><span>{lab.location}</span></>}
        {lab.website && <><span aria-hidden>·</span>
          <a href={lab.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-ink hover:text-accent transition-colors">Lab site<ExternalLink className="w-3 h-3" /></a>
        </>}
      </div>

      {/* Objective */}
      {lab.focus && (
        <Section icon={Target} title="Objective">
          <p className="text-[1.08rem] leading-[1.7] text-ink font-body">{lab.focus}</p>
        </Section>
      )}

      {/* Funding */}
      <Section icon={Banknote} title="Funding">
        {lab.funding || lab.projects ? (
          <>
            <div className="flex flex-wrap gap-x-10 gap-y-3">
              {lab.funding && (
                <div>
                  <div className="font-serif text-3xl font-semibold text-ink">{lab.funding}</div>
                  <div className="text-[12px] font-sans uppercase tracking-[0.08em] text-muted mt-0.5">NIH funding</div>
                </div>
              )}
              {lab.projects && (
                <div>
                  <div className="font-serif text-3xl font-semibold text-ink">{lab.projects}</div>
                  <div className="text-[12px] font-sans uppercase tracking-[0.08em] text-muted mt-0.5">NIH-funded projects</div>
                </div>
              )}
            </div>
            <a href={reporterUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 mt-4 text-[13px] font-sans text-accent hover:underline">
              View awards on NIH RePORTER <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <p className="mt-3 text-[11.5px] font-sans text-muted/90">Source: NIH RePORTER</p>
          </>
        ) : <p className="text-[14px] text-muted font-body">No NIH funding figure on record.</p>}
      </Section>

      {/* Publications */}
      <Section icon={FileText} title="Publications">
        <p className="text-[14px] text-muted font-body mb-3">{pi[0] ? `Publications by ${pi[0]}.` : 'Publications for this lab.'} Papers that are also in this index appear under Research.</p>
        <a href={pubmedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-sans text-accent hover:underline">
          Search publications on PubMed <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </Section>

      {/* People */}
      <Section icon={Users} title="People">
        {pi.length > 0
          ? <div className="divide-y divide-rule">
              {pi.map((name, i) => (
                <div key={i} className="py-2.5 flex items-baseline justify-between gap-3">
                  <span className="font-serif text-[1.05rem] text-ink">{name}</span>
                  <span className="text-[12px] font-sans text-muted whitespace-nowrap">Principal investigator</span>
                </div>
              ))}
            </div>
          : <p className="text-[14px] text-muted font-body">No principal investigator on record.</p>}
      </Section>

      {/* Provenance */}
      <footer className="border-t-2 border-ink mt-12 pt-4 text-[12px] font-sans text-muted leading-relaxed">
        <span className="font-semibold text-ink-soft">Sources: </span>NIH RePORTER{lab.website ? ', NeuroTechX academic labs' : ''}, PubMed.
        {' '}Funding and project counts are from NIH award records.
      </footer>
    </article>
  )
}
