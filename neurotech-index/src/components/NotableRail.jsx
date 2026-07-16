import { Link } from 'react-router-dom'
import { Award } from 'lucide-react'
import notable from '../data/notable.json'
import { Kicker, fmtDate } from './ui'

// OpenAlex percentile → "Top N%" (field- and age-normalized citation impact).
const topPct = p => `Top ${Math.max(1, Math.round((1 - p) * 100))}%`

function NotableCard({ p }) {
  const inner = (
    <>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] font-sans font-semibold uppercase tracking-[0.06em] text-accent">
          <Award size={12} strokeWidth={2.5} /> {topPct(p.pctile)}
        </span>
        {p.citedBy > 0 && <span className="text-[11px] font-sans text-muted">· {p.citedBy} citation{p.citedBy === 1 ? '' : 's'}</span>}
      </div>
      <h3 className="font-serif text-[1.15rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-3">{p.title}</h3>
      {p.significance && <p className="mt-1.5 text-[0.9rem] leading-relaxed text-ink-soft font-body line-clamp-2">{p.significance}</p>}
      <div className="mt-2 text-[13px] font-sans text-muted truncate">
        {p.journal}{p.publishedAt ? ` · ${fmtDate(p.publishedAt)}` : ''}
      </div>
    </>
  )
  return p.pmid
    ? <Link to={`/paper/${p.pmid}`} className="group block py-4">{inner}</Link>
    : <a href={p.url} target="_blank" rel="noopener noreferrer" className="group block py-4">{inner}</a>
}

/**
 * "Notable research" — a rolling ~90-day set of the highest FIELD-normalized
 * citation-impact neurotech papers (OpenAlex percentile). Gives landmark work a
 * longer runway than the 7-day feed. Data in src/data/notable.json, refreshed
 * daily by scripts/refresh.js → syncNotable().
 */
export default function NotableRail() {
  if (!notable?.length) return null
  return (
    <section className="mt-12 pt-8 border-t-2 border-ink">
      <div className="flex items-baseline justify-between mb-1">
        <Kicker>Notable research</Kicker>
        <span className="text-[12px] font-sans text-muted">Highest field-normalized citation impact · past 90 days</span>
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 md:gap-x-10">
        {notable.map((p, i) => (
          <div key={p.doi || p.pmid || i} className="border-b border-rule"><NotableCard p={p} /></div>
        ))}
      </div>
    </section>
  )
}
