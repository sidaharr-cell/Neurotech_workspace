import { X } from 'lucide-react'
import { TOPICS, AXES } from '../lib/taxonomy'

/**
 * Cross-cutting topic + axis filter. Driven entirely by taxonomy.js, so the
 * same bar narrows Research, Devices, Trials, Organizations identically.
 *
 * Props:
 *  activeTopic  : topic id | null
 *  onTopic(id)  : toggle a topic
 *  axes         : { modality, application, stage } current selections (id|null)
 *  onAxis(k,id) : toggle an axis option
 *  showAxes     : array of axis keys to display (default none)
 */
export default function TopicBar({ activeTopic, onTopic, axes = {}, onAxis, showAxes = [] }) {
  const hasAxisSel = Object.values(axes).some(Boolean)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {TOPICS.map(t => {
          const on = activeTopic === t.id
          return (
            <button
              key={t.id}
              onClick={() => onTopic(on ? null : t.id)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${
                on
                  ? 'bg-primary text-white border-primary shadow-glow'
                  : 'glass text-muted hover:text-ink hover:border-primary/40'
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {showAxes.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-3 pt-1">
          {showAxes.map(key => {
            const axis = AXES[key]
            if (!axis) return null
            return (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted/70">{axis.label}</span>
                <div className="flex gap-1.5">
                  {axis.options.map(opt => {
                    const on = axes[key] === opt.id
                    return (
                      <button
                        key={opt.id}
                        onClick={() => onAxis(key, on ? null : opt.id)}
                        className={`text-[11px] font-mono px-2.5 py-1 rounded-md border transition-all ${
                          on
                            ? 'bg-accent/20 border-accent/50 text-accent'
                            : 'bg-white/[0.03] border-divider text-muted hover:text-ink hover:border-accent/40'
                        }`}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {(activeTopic || hasAxisSel) && (
            <button
              onClick={() => { onTopic(null); showAxes.forEach(k => onAxis(k, null)) }}
              className="text-[11px] font-mono px-2.5 py-1 rounded-md text-muted hover:text-ink flex items-center gap-1 border border-divider"
            >
              <X className="w-3 h-3" /> Clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}
