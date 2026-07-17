import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { DEVICE_CLASSES } from '../lib/taxonomy'

/**
 * Filters.jsx — compact dropdown filter control, plus the option sets each page
 * uses. One horizontal row of dropdowns keeps the filter area to a single line
 * instead of stacked pill rows.
 */

// ── Option sets ───────────────────────────────────────────────────────────────
export const DEVICE_CLASS_OPTIONS = DEVICE_CLASSES.map(c => ({ id: c.id, label: c.short }))

export const RECENCY_DATE = [ // date-backed pages (feed, trials)
  { id: 'week', label: 'Past week' },
  { id: 'month', label: 'Past month' },
  { id: 'year', label: 'Past year' },
]
export const RECENCY_YEAR = [ // year-only pages (research, devices)
  { id: 'y1', label: 'This year' },
  { id: 'y3', label: 'Last 3 years' },
  { id: 'y10', label: 'Last 10 years' },
]
// The default "ranked" sort orders by our composite score — named per section
// for what it actually measures (not personalized "relevance").
export const SORT_IMPACT = [ // research: OpenAlex field-normalized citation impact
  { id: 'relevant', label: 'Highest impact' },
  { id: 'newest', label: 'Newest' },
]
export const SORT_SIGNIF = [ // trials / feed: composite significance score
  { id: 'relevant', label: 'Most significant' },
  { id: 'newest', label: 'Newest' },
]
export const SORT_DATE = [ // devices: no ranking score, date only
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
]
export const TRIAL_PHASE = [
  { id: 'Phase 1', label: 'Phase 1' },
  { id: 'Phase 2', label: 'Phase 2' },
  { id: 'Phase 3', label: 'Phase 3' },
  { id: 'Phase 4', label: 'Phase 4' },
]
export const TRIAL_STATUS = [
  { id: 'recruiting', label: 'Recruiting' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
  { id: 'notyet', label: 'Not yet recruiting' },
]
export const DEVICE_FDA = [
  { id: '510k', label: '510(k) cleared' },
  { id: 'pma', label: 'PMA approved' },
]
export const RESEARCH_SOURCE = [
  { id: 'pubmed', label: 'Papers' },
  { id: 'arxiv', label: 'Preprints' },
]
export const FEED_TYPE = [
  { id: 'research', label: 'Research' },
  { id: 'media', label: 'News' },
]

/**
 * A compact dropdown filter. `value` is the selected id (or null → shows
 * `allLabel`). `required` drops the "All" option (used for sort, which always
 * has a value). The trigger highlights in accent only when a real filter is set.
 * Props: label, value, onChange(id|null), options [{id,label}], allLabel, required
 */
export default function FilterSelect({ label, value, onChange, options, allLabel = 'All', required = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onEsc = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc) }
  }, [open])

  const current = options.find(o => o.id === value)
  const display = current ? current.label : allLabel
  const active = !required && value != null

  const item = (selected, onClick, key, text) => (
    <button
      key={key}
      onClick={onClick}
      className={`w-full flex items-center gap-2 text-left text-[13px] font-sans px-3 py-1.5 transition-colors hover:bg-canvas ${
        selected ? 'text-accent font-medium' : 'text-ink-soft'
      }`}
    >
      <Check className={`w-3.5 h-3.5 shrink-0 ${selected ? 'opacity-100' : 'opacity-0'}`} />
      {text}
    </button>
  )

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1.5 text-[13px] font-sans pl-3 pr-2 py-1.5 rounded-full border transition-colors ${
          active
            ? 'bg-accent text-paper border-accent'
            : 'bg-paper text-ink-soft border-rule hover:border-ink'
        }`}
      >
        <span className={`text-[10px] uppercase tracking-[0.08em] ${active ? 'text-paper/75' : 'text-muted'}`}>{label}</span>
        <span className="font-medium max-w-[11rem] truncate">{display}</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${active ? 'text-paper/80' : 'text-muted'}`} />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1.5 min-w-[12rem] max-h-72 overflow-auto bg-paper border border-rule rounded-md shadow-lg py-1">
          {!required && item(value == null, () => { onChange(null); setOpen(false) }, '__all', allLabel)}
          {options.map(o => item(value === o.id, () => { onChange(o.id); setOpen(false) }, o.id, o.label))}
        </div>
      )}
    </div>
  )
}
