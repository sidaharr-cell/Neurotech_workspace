import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Users } from 'lucide-react'
import { getResearchers, getPapers } from '../lib/data'
import { Loader, EmptyState, Kicker } from '../components/ui'
import { slugify, buildGraph, papersByAuthor } from '../lib/links'
import { cardBadges } from '../lib/facets'

export default function PersonProfile() {
  const { slug } = useParams()
  const [person, setPerson] = useState(null)
  const [pubs, setPubs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    Promise.all([getResearchers(), getPapers()]).then(([researchers, papers]) => {
      if (!alive) return
      const found = researchers.find(r => slugify(r.name) === slug) || null
      setPerson(found)
      if (found) setPubs(papersByAuthor(buildGraph({ papers, researchers }), found.name))
      setLoading(false)
    })
    return () => { alive = false }
  }, [slug])

  if (loading) return <div className="max-w-prose mx-auto px-4 py-8"><Loader label="Loading profile…" /></div>
  if (!person) return <div className="max-w-prose mx-auto px-4 py-16"><EmptyState icon={Users} title="Profile not found">This person isn’t in the index yet.</EmptyState></div>

  const badges = cardBadges(person, 6)

  return (
    <div className="max-w-prose mx-auto px-4 sm:px-6 py-10">
      <Link to="/research" className="inline-flex items-center gap-1.5 text-[13px] font-sans text-muted hover:text-accent transition-colors mb-8">
        <ArrowLeft className="w-4 h-4" /> Back
      </Link>

      <Kicker className="block mb-2">Researcher</Kicker>
      <h1 className="font-serif text-4xl font-semibold text-ink tracking-[-0.015em] leading-tight">{person.name}</h1>
      <p className="text-muted font-sans mt-2">{person.affiliation}</p>
      {person.role && <p className="text-[15px] text-accent font-sans mt-0.5">{person.role}</p>}

      {person.bio && <p className="mt-6 text-[1.05rem] leading-relaxed text-ink-soft font-body">{person.bio}</p>}

      {badges.length > 0 && (
        <div className="mt-8">
          <p className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-2">Focus</p>
          <div className="flex flex-wrap gap-1.5">
            {badges.map(b => <span key={b} className="text-[12px] font-sans text-accent bg-accent-soft border border-accent/20 px-2.5 py-1 rounded-sm">{b}</span>)}
          </div>
        </div>
      )}

      {pubs.length > 0 && (
        <div className="mt-8 pt-6 border-t border-rule">
          <p className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-3">Publications in the index ({pubs.length})</p>
          <ul className="space-y-4">
            {pubs.map((p, i) => (
              <li key={i}>
                <p className="font-serif text-[1.1rem] leading-snug text-ink">{p.title}</p>
                <p className="text-[13px] text-muted font-sans mt-0.5">{p.journal} · {p.year}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {person.notableWork?.length > 0 && (
        <div className="mt-8 pt-6 border-t border-rule">
          <p className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-3">Notable work</p>
          <ul className="space-y-2">
            {person.notableWork.map(w => <li key={w} className="text-[15px] text-ink-soft font-body flex gap-2"><span className="text-accent">·</span><span>{w}</span></li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
