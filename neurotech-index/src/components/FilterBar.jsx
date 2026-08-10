import { useState, useRef, useEffect, useId } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  FUNCTION, ACCESS, APPLICATION,
  FUNCTION_LABEL, ACCESS_LABEL, APPLICATION_LABEL,
} from '../lib/facets'

/**
 * FilterBar — every filter on one line, with the options closed.
 *
 * This is the only facet UI. It replaced a left rail that held the same
 * controls permanently open down a 240px column: the rail is about 300px tall
 * and the pages are thousands, so it left a column of nothing beside most of
 * the content, and took a fifth of the page's width from the results to do it.
 * Closed, the same controls cost one line.
 *
 * This is a relocation, not a redefinition. Same facets, same option sets, same
 * `{ function, access, application }` shape, same `extras`, `counts`,
 * `histogram` and `year` contracts the sidebar took, so no page's filtering
 * behaviour changes with the move.
 *
 * Props:
 *   facets    { function:[], access:[], application:[] }   multi-select
 *   onChange  next facets object
 *   extras    [{ label, value, onChange, options:[{id,label}], allLabel }]  single-select
 *   counts    { function:{id:n}, ... } per-value result counts, printed beside
 *             each value; a zero-count value is hidden, so a reader can tell a
 *             filter will return something before spending a click on it. Null
 *             means "not counted", which is a different thing from zero: no
 *             numbers are printed and nothing is hidden. Every page supplies
 *             these — from one grouped query where the results are paginated
 *             server-side, and from the loaded list where they are not (see
 *             facetCounts in lib/data.js and countFacets in lib/facets.js).
 *   histogram [{label,n}] results by year, shown inside a Year dropdown
 *   year      the selected histogram bucket, and onYear(bucket|null)
 *   sort      the Sort control, pinned to the right end of the bar
 */

// The exclusive sentinels are never offered as filters, same as the sidebar.
const opt = (values, labels) => values
  .filter(v => v !== 'none' && v !== 'not_applicable')
  .map(v => ({ id: v, label: labels[v] }))

const FUNCTION_OPTS = opt(FUNCTION, FUNCTION_LABEL)
const ACCESS_OPTS = opt(ACCESS, ACCESS_LABEL)
const APPLICATION_OPTS = opt(APPLICATION, APPLICATION_LABEL)

export const NO_FACETS = { function: [], access: [], application: [] }

/**
 * One closed control: a trigger that reads out its own state, and a panel.
 *
 * The trigger fills with accent once the control holds a selection, because a
 * closed panel is the one place a filter can be set and not seen. A reader who
 * scrolls past a half-empty page has to be able to tell from the bar alone that
 * something is narrowing it.
 */
function Dropdown({ label, summary, active, children, width = 'w-64' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onEsc = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc) }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={id}
        className={`inline-flex items-center gap-1.5 text-[13px] font-sans pl-3 pr-2 py-1.5 rounded-full border transition-colors ${
          active ? 'bg-accent text-paper border-accent' : 'bg-paper text-ink-soft border-rule hover:border-ink'
        }`}
      >
        <span className={`text-[10px] uppercase tracking-[0.08em] ${active ? 'text-paper/75' : 'text-muted'}`}>{label}</span>
        <span className="font-medium max-w-[11rem] truncate">{summary}</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${active ? 'text-paper/80' : 'text-muted'}`} />
      </button>
      {open && (
        <div id={id} className={`absolute left-0 z-30 mt-1.5 ${width} max-h-80 overflow-auto bg-paper border border-rule rounded-md shadow-lg p-3 animate-slide-down`}>
          {children}
        </div>
      )}
    </div>
  )
}

/**
 * Results by year, as a bar per bucket. Hovering names the bucket and its
 * count; clicking filters to that year and clicking again clears it.
 *
 * It lives inside the Year dropdown rather than on the bar, because it is the
 * one control here that is a picture as well as a control and there is no
 * reading it at the height of a line of type.
 */
function YearHistogram({ data, selected = null, onSelect }) {
  const [hover, setHover] = useState(null)
  if (!data || data.length < 2) return null
  const max = Math.max(...data.map(d => d.n), 1)
  const active = hover || (selected ? data.find(d => d.label === selected) : null)
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-2.5">
        <span className="text-[11px] font-sans font-semibold uppercase tracking-[0.11em] text-muted">Results by year</span>
        <span className="text-[11px] font-sans tabular-nums text-ink-soft min-h-[1em]">
          {active ? `${active.label} · ${active.n.toLocaleString()}` : ''}
        </span>
      </div>
      <div className="flex items-end gap-px h-16">
        {data.map((d, i) => {
          const isSel = selected === d.label
          return (
            <button
              key={i}
              title={`${d.label}: ${d.n.toLocaleString()}`}
              aria-label={`Filter to ${d.label}, ${d.n} results`}
              onMouseEnter={() => setHover(d)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect(isSel ? null : d)}
              style={{ height: `${Math.max(2, (d.n / max) * 100)}%` }}
              className={`flex-1 rounded-t-[1px] transition-colors cursor-pointer ${isSel ? 'bg-accent' : 'bg-accent/50 hover:bg-accent/80'}`}
            />
          )
        })}
      </div>
      <div className="flex justify-between mt-1.5 text-[10px] font-sans text-muted tabular-nums">
        <span>{data[0].label}</span><span>{data[data.length - 1].label}</span>
      </div>
    </div>
  )
}

// Checkbox and radio rows, carried over from the sidebar so the two read the
// same wherever a reader meets them. `count`, when given, sits right-aligned.
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

/** What a closed trigger says about a multi-select: the value itself when there
 *  is one, a count when there are several. A name is more use than "1 selected"
 *  and there is room for exactly one. */
function summarize(selected, options, allLabel) {
  if (!selected.length) return allLabel
  if (selected.length === 1) return options.find(o => o.id === selected[0])?.label || allLabel
  return `${selected.length} selected`
}

export default function FilterBar({
  facets = NO_FACETS, onChange, extras = [], counts = null,
  histogram = null, year = null, onYear, sort = null,
}) {
  const sel = key => facets[key] || []
  const toggle = (key, id) => {
    const cur = sel(key)
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]
    onChange({ ...facets, [key]: next })
  }

  const groups = [
    { key: 'function', label: 'Function', options: FUNCTION_OPTS, allLabel: 'Any' },
    { key: 'access', label: 'Access', options: ACCESS_OPTS, allLabel: 'Any' },
    { key: 'application', label: 'Application', options: APPLICATION_OPTS, allLabel: 'Any', width: 'w-72' },
  ]

  // A value that would return nothing is not offered, which is the sidebar's
  // rule. A value already selected is never hidden, or a filter could be set
  // with no way left to unset it.
  const visible = g => (counts?.[g.key]
    ? g.options.filter(o => (counts[g.key][o.id] ?? 0) > 0 || sel(g.key).includes(o.id))
    : g.options)

  const facetCount = sel('function').length + sel('access').length + sel('application').length
  const activeCount = facetCount + extras.filter(e => e.value != null).length + (year ? 1 : 0)

  const clearAll = () => {
    onChange({ ...facets, ...NO_FACETS })
    for (const e of extras) if (e.value != null) e.onChange(null)
    if (year && onYear) onYear(null)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap py-3">
      <span className="text-[11px] font-sans font-semibold uppercase tracking-[0.11em] text-muted mr-1">Filter</span>

      {groups.map(g => {
        const opts = visible(g)
        if (!opts.length) return null
        return (
          <Dropdown
            key={g.key}
            label={g.label}
            summary={summarize(sel(g.key), g.options, g.allLabel)}
            active={sel(g.key).length > 0}
            width={g.width}
          >
            {opts.map(o => (
              <CheckRow
                key={o.id}
                label={o.label}
                count={counts?.[g.key] ? (counts[g.key][o.id] ?? 0) : null}
                checked={sel(g.key).includes(o.id)}
                onChange={() => toggle(g.key, o.id)}
              />
            ))}
          </Dropdown>
        )
      })}

      {extras.map(ex => (
        <Dropdown
          key={ex.label}
          label={ex.label}
          summary={ex.options.find(o => o.id === ex.value)?.label || ex.allLabel || 'Any'}
          active={ex.value != null}
        >
          <RadioRow label={ex.allLabel || 'Any'} checked={ex.value == null} onChange={() => ex.onChange(null)} />
          {ex.options.map(o => (
            <RadioRow key={o.id} label={o.label} checked={ex.value === o.id} onChange={() => ex.onChange(o.id)} />
          ))}
        </Dropdown>
      ))}

      {histogram && histogram.length > 1 && (
        <Dropdown label="Year" summary={year?.label ?? 'Any'} active={Boolean(year)} width="w-72">
          <YearHistogram data={histogram} selected={year?.label ?? null} onSelect={onYear} />
        </Dropdown>
      )}

      {activeCount > 0 && (
        <button
          onClick={clearAll}
          className="text-[13px] font-sans text-muted hover:text-accent underline underline-offset-2 transition-colors"
        >
          Clear all
        </button>
      )}

      {sort && <div className="ml-auto">{sort}</div>}
    </div>
  )
}
