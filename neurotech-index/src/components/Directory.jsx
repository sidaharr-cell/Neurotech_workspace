import { useEffect } from 'react'
import { X, ExternalLink, MapPin } from 'lucide-react'
import { Kicker, DeviceClassLabels, typeWord } from './ui'
import { classesForEntity } from '../lib/taxonomy'

// ── List row for a reference entity (device / company / researcher) ──────────
export function EntityRow({ entity, onClick }) {
  const isDevice = entity._type === 'devices'
  const isOrg = entity._type === 'organizations'
  const sub = isDevice ? entity.manufacturer : isOrg ? entity.location : entity.affiliation
  return (
    <button onClick={onClick} className="group w-full text-left flex gap-5 py-5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3 mb-1.5">
          <Kicker>{typeWord(entity._type)}</Kicker>
          <DeviceClassLabels entity={entity} max={1} />
        </div>
        <h3 className="font-serif text-[1.3rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link">
          {entity.name}
        </h3>
        {sub && (
          <p className="mt-1 flex items-center gap-1 text-[13px] text-muted font-sans">
            {isOrg && <MapPin className="w-3.5 h-3.5" />}{sub}
          </p>
        )}
        {entity.description && (
          <p className="mt-1.5 text-[0.95rem] leading-relaxed text-ink-soft font-body line-clamp-2">{entity.description}</p>
        )}
      </div>
    </button>
  )
}

// ── Detail panel (slide-in) ──────────────────────────────────────────────────
function Field({ label, value }) {
  if (!value) return null
  return (
    <div className="mb-4">
      <p className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-0.5">{label}</p>
      <p className="text-[15px] text-ink font-body leading-relaxed">{value}</p>
    </div>
  )
}

function ClassRow({ entity }) {
  const classes = classesForEntity(entity)
  if (!classes.length) return null
  return (
    <div className="mb-4">
      <p className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-1.5">Device class</p>
      <div className="flex flex-wrap gap-1.5">
        {classes.map(c => (
          <span key={c.id} className="text-[12px] font-sans text-accent bg-accent-soft border border-accent/20 px-2.5 py-1 rounded-sm">{c.label}</span>
        ))}
      </div>
    </div>
  )
}

function ExtLink({ href, children }) {
  if (!href) return null
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[15px] font-sans font-medium text-accent hover:text-accent-dark transition-colors mt-1">
      {children} <ExternalLink className="w-3.5 h-3.5" />
    </a>
  )
}

function DeviceDetail({ d }) {
  return (
    <>
      <Field label="Manufacturer" value={d.manufacturer} />
      <Field label="Type" value={d.type} />
      <Field label="Year" value={d.year} />
      <Field label="Status" value={d.status} />
      <Field label="Signal type" value={d.signalType} />
      <Field label="Channels" value={d.channels} />
      {d.description && <div className="mb-4"><p className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-1">About</p><p className="text-[15px] text-ink-soft font-body leading-relaxed">{d.description}</p></div>}
      <ClassRow entity={d} />
      <ExtLink href={d.url}>Learn more</ExtLink>
    </>
  )
}

function OrgDetail({ o }) {
  return (
    <>
      <Field label="Type" value={o.type} />
      <Field label="Location" value={o.location} />
      <Field label="Founded" value={o.founded} />
      {o.description && <div className="mb-4"><p className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-1">About</p><p className="text-[15px] text-ink-soft font-body leading-relaxed">{o.description}</p></div>}
      {o.founders?.length > 0 && <Field label="Key founders" value={o.founders.join(', ')} />}
      <ClassRow entity={o} />
      <ExtLink href={o.website}>Visit website</ExtLink>
    </>
  )
}

export function DetailPanel({ entity, onClose }) {
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', fn)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', fn); document.body.style.overflow = '' }
  }, [onClose])

  return (
    <>
      <div className="fixed inset-0 bg-ink/30 z-40 animate-fade-in" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 w-full max-w-md bg-paper border-l border-rule shadow-xl z-50 overflow-y-auto">
        <div className="sticky top-0 bg-paper border-b border-rule px-6 py-4 flex items-center justify-between">
          <Kicker>{typeWord(entity._type)}</Kicker>
          <button onClick={onClose} className="p-1.5 rounded-sm hover:bg-canvas" aria-label="Close"><X className="w-4 h-4 text-muted" /></button>
        </div>
        <div className="px-6 py-6">
          <h2 className="font-serif text-2xl font-semibold text-ink leading-tight mb-5">{entity.name}</h2>
          {entity._type === 'devices' && <DeviceDetail d={entity} />}
          {entity._type === 'organizations' && <OrgDetail o={entity} />}
        </div>
      </aside>
    </>
  )
}
