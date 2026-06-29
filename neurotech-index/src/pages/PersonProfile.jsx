import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Users } from 'lucide-react'
import { getResearchers, getPapers } from '../lib/data'
import { NeuralBackground, Loader, EmptyState } from '../components/ui'
import { slugify, buildGraph, papersByAuthor } from '../lib/links'
import { topicsForEntity } from '../lib/taxonomy'

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
      if (found) {
        const graph = buildGraph({ papers, researchers })
        setPubs(papersByAuthor(graph, found.name))
      }
      setLoading(false)
    })
    return () => { alive = false }
  }, [slug])

  if (loading) return <div className="relative"><Loader label="Loading profile…" /></div>
  if (!person) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16">
        <EmptyState icon={Users} title="Profile not found">This person isn’t in the index yet.</EmptyState>
      </div>
    )
  }

  const initials = person.name.split(' ').map(n => n[0]).join('').slice(0, 2)
  const topics = topicsForEntity(person)

  return (
    <div className="relative">
      <NeuralBackground className="h-64" />
      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <Link to="/research" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors mb-8">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>

        <div className="flex items-center gap-5 mb-8">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-2xl font-bold shrink-0 shadow-glow">{initials}</div>
          <div>
            <h1 className="font-display text-3xl font-bold text-ink">{person.name}</h1>
            <p className="text-muted mt-1">{person.affiliation}</p>
            {person.role && <p className="text-sm text-primary-light mt-0.5">{person.role}</p>}
          </div>
        </div>

        {person.bio && <p className="text-ink/80 leading-relaxed mb-8">{person.bio}</p>}

        {topics.length > 0 && (
          <div className="mb-8">
            <p className="text-[10px] font-mono font-semibold text-muted uppercase tracking-wider mb-3">Research focus</p>
            <div className="flex flex-wrap gap-1.5">
              {topics.map(t => (
                <span key={t.id} className="text-xs font-mono text-primary-light bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-md">{t.label}</span>
              ))}
            </div>
          </div>
        )}

        {pubs.length > 0 && (
          <div className="mb-8">
            <p className="text-[10px] font-mono font-semibold text-muted uppercase tracking-wider mb-3">Publications in the index ({pubs.length})</p>
            <ul className="space-y-3">
              {pubs.map((p, i) => (
                <li key={i} className="glass rounded-xl p-4">
                  <p className="text-sm font-medium text-ink leading-snug">{p.title}</p>
                  <p className="text-xs text-muted mt-1">{p.journal} · {p.year}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {person.notableWork?.length > 0 && (
          <div className="mb-8">
            <p className="text-[10px] font-mono font-semibold text-muted uppercase tracking-wider mb-3">Notable work</p>
            <ul className="space-y-2">
              {person.notableWork.map(w => (
                <li key={w} className="text-sm text-ink/80 flex gap-2"><span className="text-primary-light mt-0.5 shrink-0">·</span><span>{w}</span></li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
