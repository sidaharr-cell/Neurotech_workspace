import { useState, useMemo } from 'react'
import { MapPin, ExternalLink } from 'lucide-react'
import { SectionHeading, Kicker, EmptyState, DeviceClassLabels } from '../components/ui'
import DeviceClassFilter from '../components/DeviceClassFilter'
import FundingChart from '../components/FundingChart'
import { entityMatchesClass } from '../lib/taxonomy'
import companiesJson from '../data/companies.json'

const fmtMoney = m => (m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${m}M`)

const KINDS = [
  { id: 'all', label: 'All' },
  { id: 'company', label: 'Companies' },
  { id: 'lab', label: 'Labs' },
]

function OrgRow({ org }) {
  const inner = (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-3 mb-1.5 flex-wrap">
        <Kicker>{org.type === 'lab' ? 'Lab' : 'Company'}</Kicker>
        <DeviceClassLabels entity={org} max={1} />
        {org.type === 'company' && org.funding > 0 && (
          <span className="text-[11px] font-mono text-accent">{fmtMoney(org.funding)} raised</span>
        )}
      </div>
      <h3 className="font-serif text-[1.3rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link inline-flex items-center gap-1.5">
        {org.name}{org.website && <ExternalLink className="w-3.5 h-3.5 text-muted opacity-0 group-hover:opacity-100 transition-opacity" />}
      </h3>
      <p className="mt-1 flex items-center gap-1 text-[13px] text-muted font-sans">
        {org.location && <><MapPin className="w-3.5 h-3.5" />{org.location}</>}
        {org.founded && <><span aria-hidden>·</span>Founded {org.founded}</>}
        {org.type === 'company' && org.latestRound && <><span aria-hidden>·</span>{org.latestRound} {org.roundYear}</>}
      </p>
      {org.description && <p className="mt-1.5 text-[0.95rem] leading-relaxed text-ink-soft font-body line-clamp-2">{org.description}</p>}
    </div>
  )
  return org.website
    ? <a href={org.website} target="_blank" rel="noopener noreferrer" className="group block py-5">{inner}</a>
    : <div className="py-5">{inner}</div>
}

export default function Companies() {
  const [kind, setKind] = useState('all')
  const [cls, setCls] = useState(null)

  const shown = useMemo(() => {
    let list = companiesJson
    if (kind !== 'all') list = list.filter(o => o.type === kind)
    if (cls) list = list.filter(o => entityMatchesClass(o, cls))
    // companies first (by funding), then labs (alpha)
    return [...list].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'company' ? -1 : 1
      if (a.type === 'company') return (b.funding || 0) - (a.funding || 0)
      return a.name.localeCompare(b.name)
    })
  }, [kind, cls])

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <SectionHeading
        kicker="Companies & Labs"
        title="Companies"
        sub="Neurotechnology companies and individual research labs — funding, focus, and location."
        right={<span className="font-sans text-[13px] text-muted">{shown.length} entries</span>}
      />

      <FundingChart companies={companiesJson} />

      <div className="mb-6">
        <div className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-2.5">Filter by organization type</div>
        <div className="flex flex-wrap items-center gap-2">
          {KINDS.map(k => (
            <button key={k.id} onClick={() => setKind(k.id)}
              className={`text-[13px] font-sans px-3.5 py-1.5 rounded-full border transition-colors ${kind === k.id ? 'bg-ink text-paper border-ink' : 'bg-paper text-ink-soft border-rule hover:border-ink'}`}>
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <DeviceClassFilter value={cls} onChange={setCls} />

      {shown.length === 0 ? (
        <EmptyState icon={MapPin} title="No entries match these filters" />
      ) : (
        <div className="max-w-4xl divide-rule">
          {shown.map((o, i) => <OrgRow key={i} org={o} />)}
        </div>
      )}
    </div>
  )
}
