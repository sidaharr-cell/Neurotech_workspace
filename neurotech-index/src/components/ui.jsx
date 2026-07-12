import { Loader2 } from 'lucide-react'
import { classesForEntity, classShort } from '../lib/taxonomy'

// Kicker / eyebrow label above a headline
export function Kicker({ children, className = '' }) {
  return <span className={`kicker ${className}`}>{children}</span>
}

// Small device-class label(s) derived from an entity
export function DeviceClassLabels({ entity, max = 2 }) {
  const classes = classesForEntity(entity).slice(0, max)
  if (!classes.length) return null
  return (
    <span className="inline-flex flex-wrap gap-x-2 gap-y-0.5">
      {classes.map(c => (
        <span key={c.id} className="text-[11px] font-sans font-semibold uppercase tracking-[0.08em] text-accent">
          {c.short}
        </span>
      ))}
    </span>
  )
}

// Entry-type kicker word (Research / Preprint / News / Device / Company)
const TYPE_WORD = {
  paper: 'Research', preprint: 'Preprint', news: 'News',
  papers: 'Research', devices: 'Device', organizations: 'Company',
  researchers: 'Researcher', trials: 'Clinical Trial',
}
export const typeWord = t => TYPE_WORD[t] || 'Entry'

// Metadata line: source · date · citations
export function Meta({ source, date, cites }) {
  return (
    <div className="flex items-center flex-wrap gap-x-2 text-[13px] text-muted font-sans">
      {source && <span className="truncate max-w-[16rem]">{source}</span>}
      {date && <><span aria-hidden>·</span><span>{date}</span></>}
      {cites > 0 && <><span aria-hidden>·</span><span>{cites.toLocaleString()} citation{cites === 1 ? '' : 's'}</span></>}
    </div>
  )
}

export function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export function Loader({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center py-24 text-muted gap-2">
      <Loader2 className="w-5 h-5 animate-spin text-accent" />
      <span className="text-sm font-sans">{label}</span>
    </div>
  )
}

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center border border-rule rounded-sm bg-canvas/60">
      {Icon && <Icon className="w-8 h-8 text-muted/60 mb-3" strokeWidth={1.4} />}
      <p className="font-serif text-lg text-ink">{title}</p>
      {children && <p className="text-sm text-muted mt-1.5 max-w-md font-sans leading-relaxed">{children}</p>}
    </div>
  )
}

// Section masthead heading with a rule underline
export function SectionHeading({ kicker, title, sub, right }) {
  return (
    <div className="mb-6 pb-3 border-b-2 border-ink">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          {kicker && <Kicker className="block mb-1">{kicker}</Kicker>}
          <h1 className="font-serif text-3xl sm:text-[2.5rem] leading-none font-semibold text-ink tracking-[-0.01em]">{title}</h1>
          {sub && <p className="text-muted text-sm mt-2 font-sans max-w-2xl leading-relaxed">{sub}</p>}
        </div>
        {right}
      </div>
    </div>
  )
}

export { classShort }
