import { useState, useEffect, useLayoutEffect, useId, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Info } from 'lucide-react'
import { cardBadges } from '../lib/facets'

// Kicker / eyebrow label above a headline
export function Kicker({ children, className = '' }) {
  return <span className={`kicker ${className}`}>{children}</span>
}

/**
 * A note that explains itself. The trigger is a small "i", and the panel it
 * opens holds the sentence a section heading has no room for, plus the link to
 * whoever computed the number.
 *
 * It opens on hover and on keyboard focus, and it is a button rather than a
 * bare title attribute because the panel carries a link a reader has to be
 * able to reach: the pointer moves from the trigger into the panel without
 * crossing a gap, and Escape or a click outside closes it again.
 */
export function InfoTip({ label, children, className = '' }) {
  const [open, setOpen] = useState(false)
  // How far the panel has to slide to stay on screen. The panel hangs off the
  // right of a trigger that can sit anywhere on the line, and on a phone that
  // puts its left edge past the edge of the window, so it is measured once on
  // open and nudged back. Measuring is safe because the shift resets to 0
  // first: the rect read here is always the unshifted one.
  const [shift, setShift] = useState(0)
  const id = useId()
  const wrap = useRef(null)
  const panel = useRef(null)

  useEffect(() => {
    if (!open) { setShift(0); return }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    const onDown = e => { if (!wrap.current?.contains(e.target)) setOpen(false) }
    // The nudge below is measured once, so a resize would leave it stale and
    // push the panel back off the edge it was moved away from. Closing is the
    // honest answer: the next open measures the window it now has.
    const onResize = () => setOpen(false)
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !panel.current) return
    const pad = 12
    const r = panel.current.getBoundingClientRect()
    if (r.left < pad) setShift(Math.round(pad - r.left))
    else if (r.right > window.innerWidth - pad) setShift(Math.round(window.innerWidth - pad - r.right))
  }, [open])

  return (
    <span
      ref={wrap}
      className={`relative inline-flex items-center align-middle ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlur={e => { if (!wrap.current?.contains(e.relatedTarget)) setOpen(false) }}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(o => !o)}
        onFocus={() => setOpen(true)}
        className="inline-flex items-center text-muted hover:text-accent focus:outline-none focus-visible:text-accent focus-visible:ring-1 focus-visible:ring-accent rounded-sm"
      >
        <Info className="w-3.5 h-3.5" strokeWidth={1.8} aria-hidden />
      </button>
      {open && (
        <span
          id={id}
          ref={panel}
          role="tooltip"
          style={shift ? { transform: `translateX(${shift}px)` } : undefined}
          className="absolute right-0 top-full z-30 mt-2 w-72 max-w-[calc(100vw-1.5rem)] p-3 rounded-sm border border-rule bg-paper shadow-lg font-sans text-[12px] leading-relaxed text-ink-soft normal-case tracking-normal text-left animate-fade-in-fast"
        >
          {children}
        </span>
      )}
    </span>
  )
}

// Facet badges for an entity, read straight from its stored facet columns.
// (Kept the old name so callers don't all need touching; it now renders
// function + application + derived BCI/closed-loop badges.)
export function DeviceClassLabels({ entity, max = 2 }) {
  const badges = cardBadges(entity, max)
  if (!badges.length) return null
  return (
    <span className="inline-flex flex-wrap gap-x-2 gap-y-0.5">
      {badges.map(b => (
        <span key={b} className="text-[11px] font-sans font-semibold uppercase tracking-[0.08em] text-accent">
          {b}
        </span>
      ))}
    </span>
  )
}
export { DeviceClassLabels as FacetLabels }

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

// Relevance score readout (AI significance rating, 1–10)
export function ScoreRow({ score }) {
  if (!score) return null
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted">Relevance</span>
      <span className="flex gap-1" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={`w-1.5 h-4 rounded-[1px] ${i < score ? 'bg-accent' : 'bg-rule'}`} />
        ))}
      </span>
      <span className="font-sans text-[13px] text-ink-soft">{score}/10</span>
    </div>
  )
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

/**
 * A section rule: a heavy line, the section's name under it, and the way out.
 *
 * Both reference journals mark a section by weight rather than by size. The
 * rule sits ABOVE the heading and runs the full measure, so the eye reads it as
 * "a new thing starts here" before it reads the words. The heading itself is
 * small — a section on a front page is a signpost, not a headline, and setting
 * it large makes it compete with the stories underneath it.
 */
export function RuleHeading({ title, note, tip, to, linkLabel }) {
  return (
    <div className="border-t-2 border-ink pt-2 mb-4">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h2 className="font-sans text-[13px] font-bold uppercase tracking-[0.1em] text-ink">{title}</h2>
        <div className="flex items-baseline gap-3">
          {note && <span className="text-[12px] font-sans text-muted">{note}{tip ? <> {tip}</> : null}</span>}
          {to && (
            <Link to={to} className="text-[12px] font-sans font-medium text-accent hover:underline whitespace-nowrap">
              {linkLabel} <span aria-hidden>›</span>
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The line at the foot of a card: what kind of thing it is, then when.
 *
 * Nature sets the type in bold against a hairline bar and the date in grey, and
 * the pairing does something a plain metadata line does not: the type word is
 * the first thing scanned down a column, so a reader picking research out of
 * news never has to read a headline to do it. The source sits above it, because
 * a venue name is often long and would push the date off the line.
 */
export function Byline({ type, source, date, cites }) {
  return (
    <div className="font-sans text-[12px] text-muted">
      {source && <div className="truncate mb-0.5">{source}</div>}
      <div className="flex items-center gap-2">
        {type && <span className="font-semibold text-ink-soft">{type}</span>}
        {type && date && <span className="w-px h-3 bg-rule" aria-hidden />}
        {date && <span className="tabular-nums">{date}</span>}
        {cites > 0 && (
          <>
            <span className="w-px h-3 bg-rule" aria-hidden />
            <span className="tabular-nums">{cites.toLocaleString()} citation{cites === 1 ? '' : 's'}</span>
          </>
        )}
      </div>
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

