import { DEVICE_CLASSES } from '../lib/taxonomy'

/**
 * Device Class filter — the cross-cutting filter used on the feed and every
 * section. Editorial pill row, driven entirely by taxonomy.js.
 *
 * Props: value (classId | null), onChange(classId | null)
 */
export default function DeviceClassFilter({ value, onChange, label = 'Filter by device class' }) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted">{label}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onChange(null)}
          className={`text-[13px] font-sans px-3 py-1.5 rounded-full border transition-colors ${
            value == null
              ? 'bg-ink text-paper border-ink'
              : 'bg-paper text-ink-soft border-rule hover:border-ink'
          }`}
        >
          All
        </button>
        {DEVICE_CLASSES.map(c => {
          const on = value === c.id
          return (
            <button
              key={c.id}
              onClick={() => onChange(on ? null : c.id)}
              title={c.label}
              className={`text-[13px] font-sans px-3 py-1.5 rounded-full border transition-colors ${
                on
                  ? 'bg-accent text-paper border-accent'
                  : 'bg-paper text-ink-soft border-rule hover:border-accent hover:text-accent'
              }`}
            >
              {c.short}
            </button>
          )
        })}
      </div>
    </div>
  )
}
