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

// A single checkbox row.
function CheckRow({ checked, onChange, label }) {
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
      <span className={`text-[14px] font-sans leading-snug transition-colors ${checked ? 'text-ink font-medium' : 'text-ink-soft group-hover:text-ink'}`}>
        {label}
      </span>
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

/** A checkbox facet section with a "See all" expander when it has many options. */
function CheckSection({ label, options, selected, onToggle, collapseAt = 99 }) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? options : options.slice(0, collapseAt)
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="flex flex-col">
        {shown.map(o => (
          <CheckRow key={o.id} label={o.label} checked={selected.includes(o.id)} onChange={() => onToggle(o.id)} />
        ))}
      </div>
      {options.length > collapseAt && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-1 text-[13px] font-sans text-accent hover:text-accent-dark transition-colors"
        >
          {expanded ? 'Show fewer' : `See all ${options.length}`}
        </button>
      )}
    </div>
  )
}

export const NO_FACETS = { function: [], access: [], application: [] }

export default function FacetSidebar({ facets = NO_FACETS, onChange, extras = [], histogram = null, year = null, onYear }) {
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

  return (
    <aside className="w-full lg:w-60 shrink-0">
      {/* Header height (h-9) and rule match the results header so the two
          underlines align. On desktop it is a static label; on mobile it is a
          tap target that expands/collapses the whole panel, so the results stay
          prominent on narrow screens. */}
      <div className="flex items-center justify-between h-9 mb-4 lg:mb-6 border-b border-rule">
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-[13px] font-sans text-muted lg:pointer-events-none"
        >
          Filters
          {activeCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-accent text-paper text-[11px] font-semibold tabular-nums">
              {activeCount}
            </span>
          )}
          <ChevronDown className={`w-4 h-4 lg:hidden transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {anyFacet ? (
          <button
            onClick={() => onChange({ ...facets, ...NO_FACETS })}
            className="text-[13px] font-sans text-muted hover:text-accent transition-colors"
          >
            Clear all
          </button>
        ) : null}
      </div>

      <div className={`${open ? 'flex' : 'hidden'} lg:flex flex-col gap-6`}>
        {histogram && <YearHistogram data={histogram} selected={year?.label ?? null} onSelect={onYear} />}
        <CheckSection label="Function" options={FUNCTION_OPTS} selected={sel('function')} onToggle={id => toggle('function', id)} />
        <CheckSection label="Access" options={ACCESS_OPTS} selected={sel('access')} onToggle={id => toggle('access', id)} />
        <CheckSection label="Application" options={APPLICATION_OPTS} selected={sel('application')} onToggle={id => toggle('application', id)} collapseAt={6} />

        {extras.map(ex => (
          <div key={ex.label}>
            <SectionLabel>{ex.label}</SectionLabel>
            <div className="flex flex-col">
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
