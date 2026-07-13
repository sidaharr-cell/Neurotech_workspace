import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { FlaskConical } from 'lucide-react'
import { getTrials } from '../lib/data'
import { SectionHeading, Loader, EmptyState, Kicker, DeviceClassLabels, fmtDate } from '../components/ui'
import DeviceClassFilter from '../components/DeviceClassFilter'
import { entityMatchesClass } from '../lib/taxonomy'

const STATUS_STYLE = {
  RECRUITING: 'text-mint border-mint/40 bg-mint/10',
  ENROLLING_BY_INVITATION: 'text-mint border-mint/40 bg-mint/10',
  ACTIVE_NOT_RECRUITING: 'text-accent border-accent/30 bg-accent-soft',
  COMPLETED: 'text-muted border-rule bg-canvas',
}
function StatusBadge({ status }) {
  if (!status) return null
  const label = status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
  return <span className={`text-[10px] font-sans font-semibold uppercase tracking-[0.08em] px-2 py-0.5 rounded-sm border ${STATUS_STYLE[status] || 'text-muted border-rule bg-canvas'}`}>{label}</span>
}

function TrialRow({ trial }) {
  const m = trial.metadata || {}
  return (
    <Link to={`/item/${trial.id}`} className="group block py-5">
      <div className="flex items-center gap-3 mb-1.5 flex-wrap">
        <Kicker>Clinical Trial</Kicker>
        <StatusBadge status={m.status} />
        {m.phase && <span className="text-[11px] font-sans font-semibold uppercase tracking-[0.06em] text-ink-soft">{m.phase}</span>}
        <DeviceClassLabels entity={trial} max={1} />
      </div>
      <h3 className="font-serif text-[1.3rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-2">{trial.title}</h3>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted font-sans">
        {m.sponsor && <span className="truncate max-w-[22rem]">{m.sponsor}</span>}
        {m.conditions?.[0] && <><span aria-hidden>·</span><span>{m.conditions.slice(0, 2).join(', ')}</span></>}
        {trial.published_at && <><span aria-hidden>·</span><span>Started {fmtDate(trial.published_at)}</span></>}
      </div>
    </Link>
  )
}

export default function Trials() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [cls, setCls] = useState(null)

  useEffect(() => {
    let alive = true
    getTrials().then(d => { if (alive) { setItems(d); setLoading(false) } })
    return () => { alive = false }
  }, [])

  const shown = useMemo(() => (cls ? items.filter(t => entityMatchesClass(t, cls)) : items), [items, cls])

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <SectionHeading
        kicker="Clinical Trials"
        title="Trials & Studies"
        sub="Neurotechnology trials from ClinicalTrials.gov — sponsors, phases, conditions, and interventions."
        right={<span className="font-sans text-[13px] text-muted">{shown.length} trials</span>}
      />
      <DeviceClassFilter value={cls} onChange={setCls} />
      {loading ? (
        <Loader />
      ) : shown.length === 0 ? (
        <EmptyState icon={FlaskConical} title="No trials match this device class" />
      ) : (
        <div className="max-w-4xl divide-rule">
          {shown.map((t, i) => <TrialRow key={t.id || i} trial={t} />)}
        </div>
      )}
    </div>
  )
}
