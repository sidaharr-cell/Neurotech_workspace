import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Search, X, BookOpen, Cpu, Building2, Users, ChevronRight,
  ExternalLink, ArrowUpRight, MapPin, Menu, BrainCircuit,
  Newspaper, FlaskConical, Loader2, TrendingUp
} from 'lucide-react'
import { getPapers, getDevices, getOrganizations, getResearchers, getNewsFeed } from './lib/data'
import { supabase } from './lib/supabase'

// Static JSON counts for the hero badges (always available instantly)
import papersJson from './data/papers.json'
import devicesJson from './data/devices.json'
import organizationsJson from './data/organizations.json'
import researchersJson from './data/researchers.json'

// ─── Navbar ────────────────────────────────────────────────────────────────

function Navbar({ onSearchSubmit }) {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 24)
    window.addEventListener('scroll', fn, { passive: true })
    return () => window.removeEventListener('scroll', fn)
  }, [])

  return (
    <nav
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-white/95 backdrop-blur-md shadow-sm border-b border-divider'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <a href="#" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-sm group-hover:bg-primary-dark transition-colors">
              <BrainCircuit className="w-4.5 h-4.5 text-white" strokeWidth={1.8} />
            </div>
            <span className="font-display font-bold text-ink text-[15px] tracking-tight">
              Neuro<span className="text-primary">Base</span>
            </span>
          </a>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-6">
            <a href="#news" className="text-sm font-medium text-muted hover:text-ink transition-colors">This Week</a>
            <a href="#browse" className="text-sm font-medium text-muted hover:text-ink transition-colors">Browse</a>
            <a href="#about" className="text-sm font-medium text-muted hover:text-ink transition-colors">About</a>
            <a href="#contribute" className="text-sm font-medium text-muted hover:text-ink transition-colors">Contribute</a>
            <a
              href="#contribute"
              className="inline-flex items-center gap-1.5 bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2 rounded-full transition-colors shadow-sm"
            >
              Submit Entry <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden p-2 rounded-lg hover:bg-background transition-colors"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Open menu"
          >
            {menuOpen ? <X className="w-5 h-5 text-ink" /> : <Menu className="w-5 h-5 text-ink" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden bg-white border-b border-divider px-4 pb-4 space-y-1">
          {[['This Week', 'news'], ['Browse', 'browse'], ['About', 'about'], ['Contribute', 'contribute']].map(([label, anchor]) => (
            <a
              key={anchor}
              href={`#${anchor}`}
              onClick={() => setMenuOpen(false)}
              className="block py-2.5 px-3 text-sm font-medium text-ink hover:bg-background rounded-lg transition-colors"
            >
              {label}
            </a>
          ))}
        </div>
      )}
    </nav>
  )
}

// ─── Neural decoration SVG ─────────────────────────────────────────────────

function NeuralDecoration() {
  const nodes = [
    [70, 65], [195, 45], [315, 90], [55, 195], [178, 172],
    [298, 192], [95, 315], [235, 295], [355, 272],
  ]
  const edges = [
    [0, 1], [1, 2], [0, 3], [1, 4], [2, 5],
    [3, 4], [4, 5], [3, 6], [4, 7], [5, 8], [6, 7], [7, 8],
  ]
  return (
    <svg
      className="absolute top-8 right-4 md:right-16 w-80 h-80 md:w-96 md:h-96 opacity-[0.07] pointer-events-none select-none"
      viewBox="0 0 400 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {edges.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a][0]} y1={nodes[a][1]}
          x2={nodes[b][0]} y2={nodes[b][1]}
          stroke="#4A6CE8" strokeWidth="1.5"
        />
      ))}
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 4 ? 10 : 7} fill="#4A6CE8" />
      ))}
    </svg>
  )
}

// ─── Hero ──────────────────────────────────────────────────────────────────

function Hero({ onSearch }) {
  const [q, setQ] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    onSearch(q)
    document.getElementById('browse')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <section className="relative pt-28 pb-24 overflow-hidden bg-gradient-to-b from-[#EEF2FF] via-[#F0F3FF] to-background">
      <div className="absolute inset-0 grid-bg" />
      <NeuralDecoration />

      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 bg-white border border-primary/20 text-primary text-xs font-mono font-medium px-3 py-1.5 rounded-full mb-8 shadow-sm">
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse-slow" />
          NeuroBase · {papersJson.length + devicesJson.length + organizationsJson.length + researchersJson.length} entries
        </div>

        {/* Headline */}
        <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.5rem] font-bold text-ink tracking-tight leading-[1.1] mb-4">
          Neuro
          <span className="font-serif italic font-medium text-primary">Base</span>
        </h1>

        <p className="text-muted text-base sm:text-lg leading-relaxed max-w-2xl mx-auto mb-10">
          An open, auto-updating research database built exclusively for neurotechnology —
          papers, devices, organizations, clinical trials, and the researchers who define the field.
        </p>

        {/* Search */}
        <form onSubmit={handleSubmit} className="relative max-w-2xl mx-auto mb-12">
          <div className="relative flex items-center shadow-md shadow-primary/10 rounded-2xl">
            <Search className="absolute left-4 w-5 h-5 text-muted pointer-events-none" />
            <input
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search papers, devices, researchers, organizations…"
              className="w-full pl-12 pr-36 py-4 bg-white border border-divider rounded-2xl text-ink placeholder-muted/50 font-body text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40 transition-all"
            />
            <button
              type="submit"
              className="absolute right-1.5 bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
            >
              Search
            </button>
          </div>
        </form>

        {/* Stats */}
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm">
          <StatChip icon={<BookOpen className="w-4 h-4" />} count={papersJson.length} label="Papers" />
          <div className="w-px h-4 bg-divider hidden sm:block" />
          <StatChip icon={<Cpu className="w-4 h-4" />} count={devicesJson.length} label="Devices" />
          <div className="w-px h-4 bg-divider hidden sm:block" />
          <StatChip icon={<Building2 className="w-4 h-4" />} count={organizationsJson.length} label="Organizations" />
          <div className="w-px h-4 bg-divider hidden sm:block" />
          <StatChip icon={<Users className="w-4 h-4" />} count={researchersJson.length} label="Researchers" />
        </div>
      </div>
    </section>
  )
}

function StatChip({ icon, count, label }) {
  return (
    <div className="flex items-center gap-2 text-muted">
      <span className="text-primary">{icon}</span>
      <span className="font-display font-bold text-ink">{count}</span>
      <span>{label}</span>
    </div>
  )
}

// ─── Type badge ────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  papers: { label: 'Paper', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  devices: { label: 'Device', color: 'bg-violet-50 text-violet-700 border-violet-200' },
  organizations: { label: 'Organization', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  researchers: { label: 'Researcher', color: 'bg-amber-50 text-amber-700 border-amber-200' },
}

function TypeBadge({ type }) {
  const c = TYPE_CONFIG[type]
  return (
    <span className={`text-[10px] font-mono font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${c.color}`}>
      {c.label}
    </span>
  )
}

// ─── Entry cards ───────────────────────────────────────────────────────────

function Tag({ color = 'primary', children }) {
  const styles = {
    primary: 'bg-primary/8 text-primary',
    violet: 'bg-violet-50 text-violet-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    muted: 'bg-background text-muted border border-divider',
  }
  return (
    <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${styles[color]}`}>
      {children}
    </span>
  )
}

function PaperCard({ paper }) {
  return (
    <>
      <h3 className="font-display font-semibold text-sm text-ink leading-snug line-clamp-3 mb-2">
        {paper.title}
      </h3>
      <p className="text-xs text-muted mb-3 line-clamp-1">
        {Array.isArray(paper.authors) ? paper.authors.slice(0, 3).join(', ') + (paper.authors.length > 3 ? ' et al.' : '') : paper.authors}
      </p>
      <div className="flex items-center gap-2 text-xs text-muted mb-3">
        <span className="font-mono">{paper.year}</span>
        <span>·</span>
        <span className="italic truncate">{paper.journal}</span>
      </div>
      {paper.tags && (
        <div className="flex flex-wrap gap-1">
          {paper.tags.slice(0, 3).map(tag => <Tag key={tag} color="primary">{tag}</Tag>)}
        </div>
      )}
    </>
  )
}

function DeviceCard({ device }) {
  return (
    <>
      <h3 className="font-display font-semibold text-sm text-ink mb-1">{device.name}</h3>
      <p className="text-xs text-muted mb-2">{device.manufacturer}</p>
      <p className="text-xs text-ink/70 line-clamp-2 mb-3">{device.description}</p>
      <div className="flex flex-wrap gap-1 items-center">
        <Tag color="violet">{device.type}</Tag>
        <span className="text-[10px] font-mono text-muted">{device.year}</span>
      </div>
    </>
  )
}

function OrgCard({ org }) {
  return (
    <>
      <h3 className="font-display font-semibold text-sm text-ink mb-1">{org.name}</h3>
      <div className="flex items-center gap-1 text-xs text-muted mb-2">
        <MapPin className="w-3 h-3 shrink-0" />
        <span className="truncate">{org.location}</span>
      </div>
      <p className="text-xs text-ink/70 line-clamp-2 mb-3">{org.description}</p>
      <div className="flex flex-wrap gap-1">
        <Tag color="emerald">{org.type}</Tag>
        {org.focusAreas?.slice(0, 2).map(a => <Tag key={a} color="muted">{a}</Tag>)}
      </div>
    </>
  )
}

function ResearcherCard({ researcher }) {
  const initials = researcher.name.split(' ').map(n => n[0]).join('').slice(0, 2)
  return (
    <>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-xs font-bold shrink-0">
          {initials}
        </div>
        <div className="min-w-0">
          <h3 className="font-display font-semibold text-sm text-ink truncate">{researcher.name}</h3>
          <p className="text-xs text-muted truncate">{researcher.affiliation}</p>
        </div>
      </div>
      <p className="text-xs text-ink/70 line-clamp-2 mb-3">{researcher.bio}</p>
      <div className="flex flex-wrap gap-1">
        {researcher.expertise?.slice(0, 3).map(e => <Tag key={e} color="amber">{e}</Tag>)}
      </div>
    </>
  )
}

function EntryCard({ entry, onClick }) {
  return (
    <button
      onClick={onClick}
      className="text-left w-full bg-surface border border-divider rounded-xl p-5 hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 group"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <TypeBadge type={entry._type} />
        <ChevronRight className="w-4 h-4 text-muted/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
      </div>
      {entry._type === 'papers' && <PaperCard paper={entry} />}
      {entry._type === 'devices' && <DeviceCard device={entry} />}
      {entry._type === 'organizations' && <OrgCard org={entry} />}
      {entry._type === 'researchers' && <ResearcherCard researcher={entry} />}
    </button>
  )
}

// ─── Detail panel ──────────────────────────────────────────────────────────

function DetailField({ label, value }) {
  if (!value) return null
  return (
    <div className="mb-5">
      <p className="text-[10px] font-mono font-semibold text-muted uppercase tracking-wider mb-1">{label}</p>
      <p className="text-sm text-ink leading-relaxed">{value}</p>
    </div>
  )
}

function PaperDetail({ paper }) {
  const authors = Array.isArray(paper.authors) ? paper.authors.join(', ') : paper.authors
  return (
    <>
      <h2 className="font-display text-xl font-bold text-ink leading-snug mb-5">{paper.title}</h2>
      <DetailField label="Authors" value={authors} />
      <DetailField label="Journal" value={paper.journal} />
      <DetailField label="Year" value={paper.year} />
      <DetailField label="DOI" value={paper.doi} />
      {paper.abstract && (
        <div className="mb-5">
          <p className="text-[10px] font-mono font-semibold text-muted uppercase tracking-wider mb-2">Abstract</p>
          <p className="text-sm text-ink/80 leading-relaxed">{paper.abstract}</p>
        </div>
      )}
      {paper.tags && (
        <div className="mb-5">
          <p className="text-[10px] font-mono font-semibold text-muted uppercase tracking-wider mb-2">Tags</p>
          <div className="flex flex-wrap gap-1.5">
            {paper.tags.map(tag => (
              <span key={tag} className="text-xs font-mono bg-primary/8 text-primary px-2.5 py-1 rounded-md">{tag}</span>
            ))}
          </div>
        </div>
      )}
      {paper.url && (
        <a href={paper.url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline mt-1">
          View paper <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </>
  )
}

function DeviceDetail({ device }) {
  return (
    <>
      <h2 className="font-display text-xl font-bold text-ink mb-1">{device.name}</h2>
      <p className="text-muted text-sm mb-6">{device.manufacturer}</p>
      <DetailField label="Type" value={device.type} />
      <DetailField label="Year introduced" value={device.year} />
      <DetailField label="Status" value={device.status} />
      <DetailField label="Signal type" value={device.signalType} />
      <DetailField label="Channels" value={device.channels} />
      {device.description && (
        <div className="mb-5">
          <p className="text-[10px] font-mono font-semibold text-muted uppercase tracking-wider mb-2">Description</p>
          <p className="text-sm text-ink/80 leading-relaxed">{device.description}</p>
        </div>
      )}
      {device.tags && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          {device.tags.map(t => (
            <span key={t} className="text-xs font-mono bg-violet-50 text-violet-700 px-2.5 py-1 rounded-md border border-violet-100">{t}</span>
          ))}
        </div>
      )}
      {device.url && (
        <a href={device.url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
          Learn more <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </>
  )
}

function OrgDetail({ org }) {
  return (
    <>
      <h2 className="font-display text-xl font-bold text-ink mb-1">{org.name}</h2>
      <p className="text-muted text-sm mb-6">{org.type}</p>
      <DetailField label="Location" value={org.location} />
      <DetailField label="Founded" value={org.founded} />
      {org.description && (
        <div className="mb-5">
          <p className="text-[10px] font-mono font-semibold text-muted uppercase tracking-wider mb-2">Description</p>
          <p className="text-sm text-ink/80 leading-relaxed">{org.description}</p>
        </div>
      )}
      {org.focusAreas && (
        <div className="mb-5">
          <p className="text-[10px] font-mono font-semibold text-muted uppercase tracking-wider mb-2">Focus Areas</p>
          <div className="flex flex-wrap gap-1.5">
            {org.focusAreas.map(a => (
              <span key={a} className="text-xs font-mono bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-md border border-emerald-100">{a}</span>
            ))}
          </div>
        </div>
      )}
      {org.founders?.length > 0 && (
        <DetailField label="Key founders" value={org.founders.join(', ')} />
      )}
      {org.website && (
        <a href={org.website} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
          Visit website <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </>
  )
}

function ResearcherDetail({ researcher }) {
  const initials = researcher.name.split(' ').map(n => n[0]).join('').slice(0, 2)
  return (
    <>
      <div className="flex items-center gap-4 mb-6">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-lg font-bold shrink-0">
          {initials}
        </div>
        <div>
          <h2 className="font-display text-xl font-bold text-ink">{researcher.name}</h2>
          <p className="text-muted text-sm">{researcher.affiliation}</p>
        </div>
      </div>
      <DetailField label="Role / Title" value={researcher.role} />
      {researcher.bio && (
        <div className="mb-5">
          <p className="text-[10px] font-mono font-semibold text-muted uppercase tracking-wider mb-2">Biography</p>
          <p className="text-sm text-ink/80 leading-relaxed">{researcher.bio}</p>
        </div>
      )}
      {researcher.expertise && (
        <div className="mb-5">
          <p className="text-[10px] font-mono font-semibold text-muted uppercase tracking-wider mb-2">Expertise</p>
          <div className="flex flex-wrap gap-1.5">
            {researcher.expertise.map(e => (
              <span key={e} className="text-xs font-mono bg-amber-50 text-amber-700 px-2.5 py-1 rounded-md border border-amber-100">{e}</span>
            ))}
          </div>
        </div>
      )}
      {researcher.notableWork && (
        <div className="mb-5">
          <p className="text-[10px] font-mono font-semibold text-muted uppercase tracking-wider mb-2">Notable Work</p>
          <ul className="space-y-2">
            {researcher.notableWork.map(w => (
              <li key={w} className="text-sm text-ink/80 flex gap-2">
                <span className="text-primary mt-0.5 shrink-0">·</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

function DetailPanel({ entry, onClose }) {
  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', fn)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', fn)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <>
      <div
        className="fixed inset-0 bg-black/25 backdrop-blur-[2px] z-40 animate-fade-in"
        onClick={onClose}
      />
      <aside className="fixed inset-y-0 right-0 w-full max-w-lg bg-surface shadow-2xl z-50 overflow-y-auto animate-slide-in-right">
        <div className="sticky top-0 bg-surface/95 backdrop-blur-sm border-b border-divider px-6 py-4 flex items-center justify-between">
          <TypeBadge type={entry._type} />
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-background transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-muted" />
          </button>
        </div>
        <div className="px-6 py-6">
          {entry._type === 'papers' && <PaperDetail paper={entry} />}
          {entry._type === 'devices' && <DeviceDetail device={entry} />}
          {entry._type === 'organizations' && <OrgDetail org={entry} />}
          {entry._type === 'researchers' && <ResearcherDetail researcher={entry} />}
        </div>
      </aside>
    </>
  )
}

// ─── Database browser ──────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'all', label: 'All entries', icon: null },
  { id: 'papers', label: 'Papers', icon: BookOpen },
  { id: 'devices', label: 'Devices', icon: Cpu },
  { id: 'organizations', label: 'Organizations', icon: Building2 },
  { id: 'researchers', label: 'Researchers', icon: Users },
]

const MODALITIES = ['EEG', 'ECoG', 'BCI', 'fMRI', 'fNIRS', 'DBS', 'TMS', 'Ultrasound']

const YEAR_OPTS = [
  { id: 'all', label: 'All time' },
  { id: '2020', label: '2020 – present' },
  { id: '2015', label: '2015 – present' },
  { id: '2010', label: '2010 – present' },
]

// ─── News feed ─────────────────────────────────────────────────────────────

const ENTRY_TYPE_CONFIG = {
  paper:    { label: 'Paper',    color: 'bg-blue-50 text-blue-700 border-blue-200' },
  preprint: { label: 'Preprint', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  news:     { label: 'News',     color: 'bg-rose-50 text-rose-700 border-rose-200' },
}

function ScoreDot({ score }) {
  const color = score >= 8 ? 'bg-emerald-500' : score >= 6 ? 'bg-amber-400' : 'bg-muted/40'
  return (
    <span className="flex items-center gap-1.5 text-xs font-mono text-muted">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {score}/10
    </span>
  )
}

function NewsFeedCard({ item }) {
  const cfg = ENTRY_TYPE_CONFIG[item.entry_type] || ENTRY_TYPE_CONFIG.news
  const authors = item.metadata?.authors
  const date = item.published_at
    ? new Date(item.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : ''

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block bg-surface border border-divider rounded-xl p-5 hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <span className={`text-[10px] font-mono font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${cfg.color}`}>
          {cfg.label}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <ScoreDot score={item.relevance_score} />
          <ExternalLink className="w-3.5 h-3.5 text-muted/40 group-hover:text-primary transition-colors" />
        </div>
      </div>

      <h3 className="font-display font-semibold text-sm text-ink leading-snug line-clamp-3 mb-2 group-hover:text-primary transition-colors">
        {item.title}
      </h3>

      {item.summary && (
        <p className="text-xs text-muted line-clamp-2 mb-3 leading-relaxed">{item.summary}</p>
      )}

      <div className="flex items-center justify-between gap-2 mt-auto">
        <span className="text-xs text-muted truncate">
          {item.source}{authors?.length ? ` · ${authors.slice(0, 2).join(', ')}${authors.length > 2 ? ' et al.' : ''}` : ''}
        </span>
        {date && <span className="text-[10px] font-mono text-muted/60 shrink-0">{date}</span>}
      </div>

      {item.topics?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {item.topics.slice(0, 3).map(t => (
            <span key={t} className="text-[10px] font-mono bg-primary/6 text-primary px-2 py-0.5 rounded">{t}</span>
          ))}
        </div>
      )}
    </a>
  )
}

function NewsFeed({ onTopicFilter }) {
  const [feed, setFeed] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTopic, setActiveTopic] = useState(null)

  const loadFeed = useCallback(async (topic = null) => {
    setLoading(true)
    const data = await getNewsFeed({ topic, limit: 10 })
    setFeed(data)
    setLoading(false)
  }, [])

  useEffect(() => { loadFeed(null) }, [loadFeed])

  const handleTopic = (topic) => {
    const next = activeTopic === topic ? null : topic
    setActiveTopic(next)
    loadFeed(next)
    onTopicFilter?.(next)
  }

  // Don't render section at all if Supabase isn't configured (local dev)
  if (!supabase) return null

  const allTopics = [...new Set(feed.flatMap(i => i.topics || []))].slice(0, 12)

  return (
    <section id="news" className="py-14 border-t border-divider bg-[#F8F9FF]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-primary" />
              <p className="font-mono text-xs text-primary uppercase tracking-wider font-semibold">This Week in Neurotech</p>
            </div>
            <h2 className="font-display text-2xl font-bold text-ink">
              Top stories &amp; papers
            </h2>
            <p className="text-muted text-sm mt-0.5">
              Auto-curated daily · ranked by relevance
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1.5 rounded-full font-mono">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse-slow" />
            Live · updates daily at 6am UTC
          </div>
        </div>

        {/* Topic filter chips */}
        {allTopics.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-6">
            {allTopics.map(t => (
              <button
                key={t}
                onClick={() => handleTopic(t)}
                className={`text-xs font-mono px-3 py-1 rounded-full transition-all ${
                  activeTopic === t
                    ? 'bg-primary text-white'
                    : 'bg-white border border-divider text-muted hover:border-primary/40 hover:text-ink'
                }`}
              >
                {t}
              </button>
            ))}
            {activeTopic && (
              <button
                onClick={() => handleTopic(activeTopic)}
                className="text-xs font-mono px-3 py-1 rounded-full bg-background text-muted hover:text-ink flex items-center gap-1 border border-divider"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
        )}

        {/* Cards */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading feed…</span>
          </div>
        ) : feed.length === 0 ? (
          <div className="text-center py-20">
            <Newspaper className="w-10 h-10 mx-auto mb-3 text-muted/30" />
            <p className="text-sm font-medium text-muted">Feed populates after the first daily refresh</p>
            <p className="text-xs text-muted/60 mt-1">
              Trigger manually: <span className="font-mono bg-background px-1.5 py-0.5 rounded border border-divider">npm run refresh</span>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {feed.map(item => <NewsFeedCard key={item.id} item={item} />)}
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Database browser ──────────────────────────────────────────────────────

function DatabaseBrowser({ searchQuery }) {
  const [category, setCategory] = useState('all')
  const [modalities, setModalities] = useState([])
  const [yearFloor, setYearFloor] = useState('all')
  const [selected, setSelected] = useState(null)
  const [allEntries, setAllEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [p, d, o, r] = await Promise.all([
        getPapers(), getDevices(), getOrganizations(), getResearchers(),
      ])
      setAllEntries([...p, ...d, ...o, ...r])
      setLoading(false)
    }
    load()
  }, [])

  const results = useMemo(() => {
    let list = allEntries

    if (category !== 'all') list = list.filter(e => e._type === category)

    const q = searchQuery.toLowerCase().trim()
    if (q) {
      list = list.filter(e => JSON.stringify(e).toLowerCase().includes(q))
    }

    if (modalities.length > 0) {
      list = list.filter(e => {
        const blob = JSON.stringify({ tags: e.tags, modality: e.modality, type: e.type, expertise: e.expertise }).toLowerCase()
        return modalities.some(m => blob.includes(m.toLowerCase()))
      })
    }

    if (yearFloor !== 'all') {
      const cutoff = parseInt(yearFloor)
      list = list.filter(e => parseInt(e.year || e.founded || '0') >= cutoff)
    }

    return list
  }, [allEntries, category, searchQuery, modalities, yearFloor])

  const toggleModality = (m) =>
    setModalities(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])

  const clearFilters = () => { setModalities([]); setYearFloor('all') }
  const hasFilters = modalities.length > 0 || yearFloor !== 'all'

  return (
    <section id="browse" className="py-14 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="mb-7 flex items-end justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold text-ink">Browse the Index</h2>
            <p className="text-muted text-sm mt-0.5">
              {results.length} {results.length === 1 ? 'entry' : 'entries'}
              {searchQuery && <> matching <span className="text-ink font-medium">"{searchQuery}"</span></>}
            </p>
          </div>
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs text-muted hover:text-ink flex items-center gap-1 transition-colors">
              <X className="w-3.5 h-3.5" /> Clear filters
            </button>
          )}
        </div>

        {/* Category tabs */}
        <div className="flex gap-1.5 mb-7 overflow-x-auto scrollbar-hide pb-0.5">
          {CATEGORIES.map(cat => {
            const Icon = cat.icon
            return (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                  category === cat.id
                    ? 'bg-primary text-white shadow-sm'
                    : 'bg-surface text-muted hover:text-ink hover:bg-divider border border-divider'
                }`}
              >
                {Icon && <Icon className="w-3.5 h-3.5" />}
                {cat.label}
              </button>
            )
          })}
        </div>

        <div className="flex gap-6">
          {/* Sidebar filters */}
          <aside className="hidden lg:block w-52 shrink-0">
            <div className="bg-surface border border-divider rounded-xl p-4 sticky top-20">
              <p className="text-[10px] font-mono font-semibold text-muted uppercase tracking-wider mb-3">Modality</p>
              <div className="flex flex-wrap gap-1.5 mb-5">
                {MODALITIES.map(m => (
                  <button
                    key={m}
                    onClick={() => toggleModality(m)}
                    className={`text-[11px] font-mono px-2.5 py-1 rounded-md transition-all ${
                      modalities.includes(m)
                        ? 'bg-primary text-white'
                        : 'bg-background text-muted hover:bg-divider border border-divider'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>

              <p className="text-[10px] font-mono font-semibold text-muted uppercase tracking-wider mb-2">Publication year</p>
              <div className="flex flex-col gap-0.5">
                {YEAR_OPTS.map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setYearFloor(opt.id)}
                    className={`text-xs text-left px-2.5 py-1.5 rounded-md transition-all ${
                      yearFloor === opt.id
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-muted hover:bg-background'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </aside>

          {/* Results */}
          <div className="flex-1 min-w-0">
            {/* Active modality chips (mobile) */}
            {modalities.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4 lg:hidden">
                {modalities.map(m => (
                  <span key={m} className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs font-mono px-2.5 py-1 rounded-full">
                    {m}
                    <button onClick={() => toggleModality(m)} aria-label={`Remove ${m}`}>
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-24 text-muted gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Loading database…</span>
              </div>
            ) : results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-muted">
                <Search className="w-10 h-10 mb-3 opacity-20" />
                <p className="font-medium text-sm">No entries found</p>
                <p className="text-xs mt-1">Try different terms or clear your filters</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {results.map((entry, i) => (
                  <EntryCard
                    key={`${entry._type}-${i}`}
                    entry={entry}
                    onClick={() => setSelected(entry)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {selected && <DetailPanel entry={selected} onClose={() => setSelected(null)} />}
    </section>
  )
}

// ─── About ─────────────────────────────────────────────────────────────────

function About() {
  const pillars = [
    { title: 'Open Access', desc: 'All entries are freely searchable with no account required.' },
    { title: 'Author-linked', desc: 'Papers connect to their authors and institutions.' },
    { title: 'Community-curated', desc: 'Researchers and enthusiasts submit entries for review.' },
    { title: 'Continuously updated', desc: 'New research added as it is published.' },
  ]
  return (
    <section id="about" className="py-20 border-t border-divider bg-surface">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <p className="font-mono text-xs text-primary uppercase tracking-wider mb-3">About NeuroBase</p>
            <h2 className="font-display text-3xl font-bold text-ink mb-5 leading-snug">
              Making neuroscience{' '}
              <span className="font-serif italic font-medium text-primary">discoverable</span>
            </h2>
            <p className="text-muted leading-relaxed mb-4">
              NeuroBase is an open, auto-updating research database built exclusively for neurotechnology.
              Its scope reaches past peer-reviewed academic papers to include emerging research,
              commercial developments, and clinical trials, all within one intelligent, interactive,
              and searchable index.
            </p>
            <p className="text-muted leading-relaxed">
              Each entry links researchers to their affiliations, devices to their manufacturers,
              and papers to their authors — creating a connected view of the neurotechnology
              landscape for researchers, students, and the curious public alike.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {pillars.map(p => (
              <div key={p.title} className="bg-background border border-divider rounded-xl p-5">
                <h3 className="font-display text-sm font-semibold text-ink mb-1.5">{p.title}</h3>
                <p className="text-xs text-muted leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Contribute ────────────────────────────────────────────────────────────

function Contribute() {
  const [status, setStatus] = useState('idle')
  const [form, setForm] = useState({ name: '', email: '', type: 'paper', details: '' })

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

  const handleSubmit = (e) => {
    e.preventDefault()
    setStatus('sending')
    setTimeout(() => setStatus('sent'), 1200)
  }

  const fieldClass = "w-full px-3.5 py-2.5 text-sm border border-divider rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all placeholder-muted/50"
  const labelClass = "block text-[10px] font-mono font-semibold text-muted uppercase tracking-wider mb-1.5"

  return (
    <section id="contribute" className="py-20 border-t border-divider bg-gradient-to-br from-primary/4 to-accent/4">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center">
        <p className="font-mono text-xs text-primary uppercase tracking-wider mb-3">Contribute</p>
        <h2 className="font-display text-3xl font-bold text-ink mb-4">
          Help build the Index
        </h2>
        <p className="text-muted mb-8 leading-relaxed">
          Know of a paper, device, researcher, or organization not yet in the database?
          Submit it and our team will review and add it.
        </p>

        {status === 'sent' ? (
          <div className="bg-surface border border-divider rounded-2xl p-12 text-center">
            <div className="w-12 h-12 bg-emerald-50 border border-emerald-200 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-emerald-600 font-bold text-lg">✓</span>
            </div>
            <h3 className="font-display font-semibold text-ink mb-2">Submission received</h3>
            <p className="text-sm text-muted">
              We'll review your entry and add it to the Index within 3–5 business days.
              Thank you for contributing!
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-surface border border-divider rounded-2xl p-8 text-left space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className={labelClass}>Your name</label>
                <input type="text" required value={form.name} onChange={set('name')} className={fieldClass} placeholder="Jane Smith" />
              </div>
              <div>
                <label className={labelClass}>Email</label>
                <input type="email" required value={form.email} onChange={set('email')} className={fieldClass} placeholder="jane@lab.edu" />
              </div>
            </div>
            <div>
              <label className={labelClass}>Entry type</label>
              <select value={form.type} onChange={set('type')} className={fieldClass}>
                <option value="paper">Research Paper</option>
                <option value="device">Device</option>
                <option value="organization">Organization / Lab</option>
                <option value="researcher">Researcher</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Details</label>
              <textarea
                required rows={4}
                value={form.details}
                onChange={set('details')}
                placeholder="Title, authors, year, DOI, URL, or any other relevant information…"
                className={`${fieldClass} resize-none`}
              />
            </div>
            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full bg-primary hover:bg-primary-dark text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-60 text-sm"
            >
              {status === 'sending' ? 'Submitting…' : 'Submit Entry'}
            </button>
          </form>
        )}
      </div>
    </section>
  )
}

// ─── Footer ────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-divider py-10 bg-surface">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-primary rounded-md flex items-center justify-center">
              <BrainCircuit className="w-3.5 h-3.5 text-white" strokeWidth={1.8} />
            </div>
            <span className="font-display font-bold text-ink text-sm">
              Neuro<span className="text-primary">Base</span>
            </span>
          </div>
          <p className="text-xs text-muted text-center">
            An open research database for the neurotechnology community · Not affiliated with any institution
          </p>
          <div className="flex items-center gap-5 text-xs text-muted">
            <a href="#browse" className="hover:text-ink transition-colors">Browse</a>
            <a href="#about" className="hover:text-ink transition-colors">About</a>
            <a href="#contribute" className="hover:text-ink transition-colors">Contribute</a>
          </div>
        </div>
      </div>
    </footer>
  )
}

// ─── App root ──────────────────────────────────────────────────────────────

export default function App() {
  const [searchQuery, setSearchQuery] = useState('')

  const handleSearch = (q) => {
    setSearchQuery(q)
    document.getElementById('browse')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className="min-h-screen bg-background font-body">
      <Navbar onSearchSubmit={handleSearch} />
      <main>
        <Hero onSearch={handleSearch} />
        <NewsFeed />
        <DatabaseBrowser searchQuery={searchQuery} />
        <About />
        <Contribute />
      </main>
      <Footer />
    </div>
  )
}
