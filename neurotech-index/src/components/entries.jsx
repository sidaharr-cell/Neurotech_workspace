import { useEffect } from 'react'
import { X, ExternalLink, MapPin, ChevronRight } from 'lucide-react'
import { TypeBadge } from './ui'
import { topicsForEntity } from '../lib/taxonomy'

// ── Compact cards (used in grids) ────────────────────────────────────────────

function TopicChips({ entity, max = 3 }) {
  const topics = topicsForEntity(entity).slice(0, max)
  if (!topics.length) return null
  return (
    <div className="flex flex-wrap gap-1 mt-3">
      {topics.map(t => (
        <span key={t.id} className="text-[10px] font-mono text-primary-light bg-primary/10 border border-primary/20 px-2 py-0.5 rounded">
          {t.label}
        </span>
      ))}
    </div>
  )
}

function PaperCard({ paper }) {
  const authors = Array.isArray(paper.authors)
    ? paper.authors.slice(0, 3).join(', ') + (paper.authors.length > 3 ? ' et al.' : '')
    : paper.authors
  return (
    <>
      <h3 className="font-display font-semibold text-sm text-ink leading-snug line-clamp-3 mb-2">{paper.title}</h3>
      <p className="text-xs text-muted mb-2 line-clamp-1">{authors}</p>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="font-mono">{paper.year}</span>
        {paper.journal && <><span>·</span><span className="italic truncate">{paper.journal}</span></>}
      </div>
      <TopicChips entity={paper} />
    </>
  )
}

function DeviceCard({ device }) {
  return (
    <>
      <h3 className="font-display font-semibold text-sm text-ink mb-1">{device.name}</h3>
      <p className="text-xs text-muted mb-2">{device.manufacturer}</p>
      <p className="text-xs text-ink/70 line-clamp-2">{device.description}</p>
      <TopicChips entity={device} />
    </>
  )
}

function OrgCard({ org }) {
  return (
    <>
      <h3 className="font-display font-semibold text-sm text-ink mb-1">{org.name}</h3>
      <div className="flex items-center gap-1 text-xs text-muted mb-2">
        <MapPin className="w-3 h-3 shrink-0" /><span className="truncate">{org.location}</span>
      </div>
      <p className="text-xs text-ink/70 line-clamp-2">{org.description}</p>
      <TopicChips entity={org} />
    </>
  )
}

function ResearcherCard({ researcher }) {
  const initials = researcher.name.split(' ').map(n => n[0]).join('').slice(0, 2)
  return (
    <>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-glow">{initials}</div>
        <div className="min-w-0">
          <h3 className="font-display font-semibold text-sm text-ink truncate">{researcher.name}</h3>
          <p className="text-xs text-muted truncate">{researcher.affiliation}</p>
        </div>
      </div>
      <p className="text-xs text-ink/70 line-clamp-2">{researcher.bio}</p>
      <TopicChips entity={researcher} />
    </>
  )
}

export function EntryCard({ entry, onClick }) {
  return (
    <button
      onClick={onClick}
      className="text-left w-full glass rounded-2xl p-5 card-hover group"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <TypeBadge type={entry._type} />
        <ChevronRight className="w-4 h-4 text-muted/40 group-hover:text-primary-light group-hover:translate-x-0.5 transition-all shrink-0" />
      </div>
      {entry._type === 'papers' && <PaperCard paper={entry} />}
      {entry._type === 'devices' && <DeviceCard device={entry} />}
      {entry._type === 'organizations' && <OrgCard org={entry} />}
      {entry._type === 'researchers' && <ResearcherCard researcher={entry} />}
    </button>
  )
}

// ── Detail panel (slide-in) ──────────────────────────────────────────────────

function Field({ label, value }) {
  if (!value) return null
  return (
    <div className="mb-5">
      <p className="text-[10px] font-mono font-semibold text-muted uppercase tracking-wider mb-1">{label}</p>
      <p className="text-sm text-ink leading-relaxed">{value}</p>
    </div>
  )
}

function Section({ label, children }) {
  return (
    <div className="mb-5">
      <p className="text-[10px] font-mono font-semibold text-muted uppercase tracking-wider mb-2">{label}</p>
      {children}
    </div>
  )
}

function TopicRow({ entity }) {
  const topics = topicsForEntity(entity)
  if (!topics.length) return null
  return (
    <Section label="Topics">
      <div className="flex flex-wrap gap-1.5">
        {topics.map(t => (
          <span key={t.id} className="text-xs font-mono text-primary-light bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-md">{t.label}</span>
        ))}
      </div>
    </Section>
  )
}

function ExtLink({ href, children }) {
  if (!href) return null
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-light hover:text-cyan transition-colors mt-1">
      {children} <ExternalLink className="w-3.5 h-3.5" />
    </a>
  )
}

function PaperDetail({ paper }) {
  const authors = Array.isArray(paper.authors) ? paper.authors.join(', ') : paper.authors
  return (
    <>
      <h2 className="font-display text-xl font-bold text-ink leading-snug mb-5">{paper.title}</h2>
      <Field label="Authors" value={authors} />
      <Field label="Journal / Source" value={paper.journal} />
      <Field label="Year" value={paper.year} />
      <Field label="DOI" value={paper.doi} />
      {paper.abstract && <Section label="Abstract"><p className="text-sm text-ink/80 leading-relaxed">{paper.abstract}</p></Section>}
      <TopicRow entity={paper} />
      <ExtLink href={paper.url}>View paper</ExtLink>
    </>
  )
}

function DeviceDetail({ device }) {
  return (
    <>
      <h2 className="font-display text-xl font-bold text-ink mb-1">{device.name}</h2>
      <p className="text-muted text-sm mb-6">{device.manufacturer}</p>
      <Field label="Type" value={device.type} />
      <Field label="Year introduced" value={device.year} />
      <Field label="Status" value={device.status} />
      <Field label="Signal type" value={device.signalType} />
      <Field label="Channels" value={device.channels} />
      {device.description && <Section label="Description"><p className="text-sm text-ink/80 leading-relaxed">{device.description}</p></Section>}
      <TopicRow entity={device} />
      <ExtLink href={device.url}>Learn more</ExtLink>
    </>
  )
}

function OrgDetail({ org }) {
  return (
    <>
      <h2 className="font-display text-xl font-bold text-ink mb-1">{org.name}</h2>
      <p className="text-muted text-sm mb-6">{org.type}</p>
      <Field label="Location" value={org.location} />
      <Field label="Founded" value={org.founded} />
      {org.description && <Section label="Description"><p className="text-sm text-ink/80 leading-relaxed">{org.description}</p></Section>}
      {org.founders?.length > 0 && <Field label="Key founders" value={org.founders.join(', ')} />}
      <TopicRow entity={org} />
      <ExtLink href={org.website}>Visit website</ExtLink>
    </>
  )
}

function ResearcherDetail({ researcher }) {
  const initials = researcher.name.split(' ').map(n => n[0]).join('').slice(0, 2)
  return (
    <>
      <div className="flex items-center gap-4 mb-6">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-lg font-bold shrink-0 shadow-glow">{initials}</div>
        <div>
          <h2 className="font-display text-xl font-bold text-ink">{researcher.name}</h2>
          <p className="text-muted text-sm">{researcher.affiliation}</p>
        </div>
      </div>
      <Field label="Role / Title" value={researcher.role} />
      {researcher.bio && <Section label="Biography"><p className="text-sm text-ink/80 leading-relaxed">{researcher.bio}</p></Section>}
      {researcher.notableWork?.length > 0 && (
        <Section label="Notable work">
          <ul className="space-y-2">
            {researcher.notableWork.map(w => (
              <li key={w} className="text-sm text-ink/80 flex gap-2"><span className="text-primary-light mt-0.5 shrink-0">·</span><span>{w}</span></li>
            ))}
          </ul>
        </Section>
      )}
      <TopicRow entity={researcher} />
    </>
  )
}

export function DetailPanel({ entry, onClose }) {
  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', fn)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', fn); document.body.style.overflow = '' }
  }, [onClose])

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-fade-in" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 w-full max-w-lg bg-surface border-l border-divider shadow-panel z-50 overflow-y-auto animate-slide-in-right">
        <div className="sticky top-0 glass border-b border-divider px-6 py-4 flex items-center justify-between z-10">
          <TypeBadge type={entry._type} />
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 transition-colors" aria-label="Close">
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
