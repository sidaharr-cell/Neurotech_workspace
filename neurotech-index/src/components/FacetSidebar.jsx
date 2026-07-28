import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  FUNCTION, ACCESS, APPLICATION,
  FUNCTION_LABEL, ACCESS_LABEL, APPLICATION_LABEL,
} from '../lib/facets'

/**
 * FacetSidebar — a persistent left-rail filter panel (PubMed-style) that
 * replaces the horizontal dropdown row. Facets are multi-select checkbox
 * groups; page-specific `extras` are single-select radio groups. Rendered in
 * NeuroBase's editorial tokens, not a literal copy of the reference.
 *
 * Props:
 *   facets   { function:[], access:[], application:[] }
 *   onChange next facets object
 *   extras   [{ label, value, onChange, options:[{id,label}], allLabel }]
 */

const opt = (values, labels) => values
  .filter(v => v !== 'none' && v !== 'not_applicable')
  .map(v => ({ id: v, label: labels[v] }))

const FUNCTION_OPTS = opt(FUNCTION, FUNCTION_LABEL)
const ACCESS_OPTS = opt(ACCESS, ACCESS_LABEL)
const APPLICATION_OPTS = opt(APPLICATION, APPLICATION_LABEL)

function SectionLabel({ children }) {
  return (
    <div className="text-[11px] font-sans font-semibold uppercase tracking-[0.11em] text-muted mb-2.5">
      {children}
    </div>
  )
}

/**
 * Compact "results by year" bar histogram. Hovering a bar shows its count in
 * the header; clicking a bar filters the results to that year (and toggles).
 * `selected` is the chosen bucket label; `onSelect(bucket | null)` fires on click.
 */
function YearHistogram({ data, selected = null, onSelect }) {
  const [hover, setHover] = useState(null)
  if (!data || data.length < 2) return null
  const max = Math.max(...data.map(d => d.n), 1)
  const active = hover || (selected ? data.find(d => d.label === selected) : null)
  const clickable = typeof onSelect === 'function'
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-2.5">
        <span className="text-[11px] font-sans font-semibold uppercase tracking-[0.11em] text-muted">Results by year</span>
        <span className="text-[11px] font-sans tabular-nums text-ink-soft min-h-[1em]">
          {active ? `${active.label} · ${active.n.toLocaleString()}` : (selected ? '' : '')}
        </span>
      </div>
      <div className="flex items-end gap-px h-16">
        {data.map((d, i) => {
          const isSel = selected === d.label
          const common = {
            title: `${d.label}: ${d.n.toLocaleString()}`,
            onMouseEnter: () => setHover(d),
            onMouseLeave: () => setHover(null),
            className: `flex-1 rounded-t-[1px] transition-colors ${isSel ? 'bg-accent' : 'bg-accent/50 hover:bg-accent/80'} ${clickable ? 'cursor-pointer' : ''}`,
            style: { height: `${Math.max(2, (d.n / max) * 100)}%` },
          }
          return clickable
            ? <button key={i} {...common} onClick={() => onSelect(isSel ? null : d)} aria-label={`Filter to ${d.label}, ${d.n} results`} />
            : <div key={i} {...common} aria-label={`${d.label}: ${d.n}`} />
        })}
      </div>
      <div className="flex justify-between mt-1.5 text-[10px] font-sans text-muted tabular-nums">
        <span>{data[0].label}</span><span>{data[data.length - 1].label}</span>
      </div>
    </div>
  )
}

// A single checkbox row. `count`, when provided, shows how many results the
// value would yield and sits right-aligned.
function CheckRow({ checked, onChange, label, count = null }) {
  return (
    <label className="flex items-center gap-2.5 py-[5px] cursor-pointer group select-none">
      <span
        className={`grid place-items-center w-[17px] h-[17px] rounded-[3px] border shrink-0 transition-colors ${
          checked ? 'bg-accent border-accent' : 'bg-paper border-rule group-hover:border-accent'
        }`}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.5 6.2l2.2 2.3L9.5 3.5" />
          </svg>
        )}
      </span>
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
      <span className={`flex-1 min-w-0 text-[14px] font-sans leading-snug transition-colors ${checked ? 'text-ink font-medium' : 'text-ink-soft group-hover:text-ink'}`}>
        {label}
      </span>
      {count != null && (
        <span className="shrink-0 text-[12px] font-sans tabular-nums text-muted">{count.toLocaleString()}</span>
      )}
    </label>
  )
}

// A single radio row (single-select page filters).
function RadioRow({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-2.5 py-[5px] cursor-pointer group select-none">
      <span
        className={`grid place-items-center w-[17px] h-[17px] rounded-full border shrink-0 transition-colors ${
          checked ? 'border-accent' : 'border-rule group-hover:border-accent'
        }`}
      >
        {checked && <span className="w-[9px] h-[9px] rounded-full bg-accent" />}
      </span>
      <input type="radio" checked={checked} onChange={onChange} className="sr-only" />
      <span className={`text-[14px] font-sans leading-snug transition-colors ${checked ? 'text-ink font-medium' : 'text-ink-soft group-hover:text-ink'}`}>
        {label}
      </span>
    </label>
  )
}

/**
 * A checkbox facet section with a "See all" expander when it has many options.
 * When `counts` (a value->n map) is supplied, each row shows its count and
 * values that would return zero results are hidden (a selected value is never
 * hidden, so a filter can always be cleared).
 */
function CheckSection({ label, options, selected, onToggle, collapseAt = 99, counts = null }) {
  const [expanded, setExpanded] = useState(false)
  const visible = counts
    ? options.filter(o => (counts[o.id] ?? 0) > 0 || selected.includes(o.id))
    : options
  const shown = expanded ? visible : visible.slice(0, collapseAt)
  if (counts && visible.length === 0) return null
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      {/* Horizontal (wrapping) on narrow screens to save vertical space; a
          single column on the desktop left rail. */}
      <div className="flex flex-wrap gap-x-4 gap-y-0 lg:flex-col lg:gap-x-0">
        {shown.map(o => (
          <CheckRow key={o.id} label={o.label} count={counts ? (counts[o.id] ?? 0) : null}
            checked={selected.includes(o.id)} onChange={() => onToggle(o.id)} />
        ))}
      </div>
      {visible.length > collapseAt && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-1 text-[13px] font-sans text-accent hover:text-accent-dark transition-colors"
        >
          {expanded ? 'Show fewer' : `See all ${visible.length}`}
        </button>
      )}
    </div>
  )
}

/**
 * The "Filter" toggle, styled identically to the Sort dropdown (FilterSelect) so
 * the two controls match. Used in the mobile toolbar next to Sort.
 */
function FiltersPill({ open, count, onClick }) {
  const active = count > 0
  return (
    <button onClick={onClick} aria-expanded={open}
      className={`inline-flex items-center gap-1.5 text-[13px] font-sans pl-3 pr-2 py-1.5 rounded-full border transition-colors ${
        active ? 'bg-accent text-paper border-accent' : 'bg-paper text-ink-soft border-rule hover:border-ink'
      }`}>
      <span className={`text-[10px] uppercase tracking-[0.08em] ${active ? 'text-paper/75' : 'text-muted'}`}>Filter</span>
      <span className="font-medium">{count > 0 ? `${count} selected` : 'All'}</span>
      <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${active ? 'text-paper/80' : 'text-muted'}`} />
    </button>
  )
}

export const NO_FACETS = { function: [], access: [], application: [] }

export default function FacetSidebar({ facets = NO_FACETS, onChange, extras = [], histogram = null, year = null, onYear, counts = null, sortControl = null }) {
  const sel = key => facets[key] || []
  const toggle = (key, id) => {
    const cur = sel(key)
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]
    onChange({ ...facets, [key]: next })
  }
  const [open, setOpen] = useState(false)          // mobile: whether the panel is expanded
  const anyFacet = sel('function').length || sel('access').length || sel('application').length
  const activeCount =
    sel('function').length + sel('access').length + sel('application').length +
    extras.filter(e => e.value != null).length + (year ? 1 : 0)
  const clearAll = anyFacet ? (
    <button onClick={() => onChange({ ...facets, ...NO_FACETS })}
      className="text-[13px] font-sans text-muted hover:text-accent transition-colors shrink-0">Clear all</button>
  ) : null

  return (
    <aside className="w-full lg:w-60 shrink-0">
      {/* Mobile: Filter and Sort sit on one line as matching pills; the panel
          drops below when Filter is open, with facets laid out horizontally. */}
      <div className="lg:hidden flex items-center gap-2.5 mb-5">
        <FiltersPill open={open} count={activeCount} onClick={() => setOpen(o => !o)} />
        {sortControl}
        {clearAll && <span className="ml-auto">{clearAll}</span>}
      </div>

      {/* Desktop: a static left-rail header; height/rule align with the results
          header so the two underlines line up. */}
      <div className="hidden lg:flex items-center justify-between h-11 mb-6 border-b border-rule">
        <span className="flex items-center gap-1.5 text-[13px] font-sans text-muted">
          Filters
          {activeCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-accent text-paper text-[11px] font-semibold tabular-nums">
              {activeCount}
            </span>
          )}
        </span>
        {clearAll}
      </div>

      <div className={`${open ? 'flex' : 'hidden'} lg:flex flex-col gap-5 lg:gap-6`}>
        {histogram && <YearHistogram data={histogram} selected={year?.label ?? null} onSelect={onYear} />}
        <CheckSection label="Function" options={FUNCTION_OPTS} selected={sel('function')} onToggle={id => toggle('function', id)} counts={counts?.function} />
        <CheckSection label="Access" options={ACCESS_OPTS} selected={sel('access')} onToggle={id => toggle('access', id)} counts={counts?.access} />
        <CheckSection label="Application" options={APPLICATION_OPTS} selected={sel('application')} onToggle={id => toggle('application', id)} collapseAt={6} counts={counts?.application} />

        {extras.map(ex => (
          <div key={ex.label}>
            <SectionLabel>{ex.label}</SectionLabel>
            <div className="flex flex-wrap gap-x-4 gap-y-0 lg:flex-col lg:gap-x-0">
              <RadioRow label={ex.allLabel || 'Any'} checked={ex.value == null} onChange={() => ex.onChange(null)} />
              {ex.options.map(o => (
                <RadioRow key={o.id} label={o.label} checked={ex.value === o.id} onChange={() => ex.onChange(o.id)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
