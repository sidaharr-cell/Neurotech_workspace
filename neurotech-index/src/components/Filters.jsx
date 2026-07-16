/**
 * Filters.jsx — reusable editorial pill-group filter, plus the option sets each
 * page uses. Matches the DeviceClassFilter aesthetic (hairline pills, ink/accent
 * active states) so the whole filter area reads as one system.
 */

// ── Option sets ───────────────────────────────────────────────────────────────
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
export const SORT_RANK = [
  { id: 'relevant', label: 'Most relevant' },
  { id: 'newest', label: 'Newest' },
]
export const SORT_DATE = [
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
 * A labeled pill group. `value` is the selected id (or null). Clicking the
 * active pill clears it (unless `required`, in which case one is always on and
 * there's no "All").
 * Props: label, value, onChange(id|null), options [{id,label}], required, allLabel
 */
export default function FilterPills({ label, value, onChange, options, required = false, allLabel = 'All' }) {
  const pill = (active, on, key, text) => (
    <button
      key={key}
      onClick={on}
      className={`text-[13px] font-sans px-3 py-1.5 rounded-full border transition-colors ${
        active
          ? 'bg-accent text-paper border-accent'
          : 'bg-paper text-ink-soft border-rule hover:border-accent hover:text-accent'
      }`}
    >
      {text}
    </button>
  )
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted">{label}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {!required && pill(value == null, () => onChange(null), '__all', allLabel)}
        {options.map(o => pill(value === o.id, () => onChange(value === o.id && !required ? null : o.id), o.id, o.label))}
      </div>
    </div>
  )
}
