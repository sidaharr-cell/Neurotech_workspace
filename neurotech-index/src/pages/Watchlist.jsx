import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Star, Download, Activity, Building2, Cpu, FlaskConical, FileText, Filter } from 'lucide-react'
import { useWatchlist, removeWatch, getLastSeen, markSeen } from '../lib/watchlist'
import { getOrgTrialIds, getWatchlistChanges } from '../lib/data'
import { SectionHeading, EmptyState, fmtDate } from '../components/ui'

const GROUPS = [
  { type: 'organizations', label: 'Organizations', icon: Building2 },
  { type: 'devices', label: 'Devices', icon: Cpu },
  { type: 'trials', label: 'Trials', icon: FlaskConical },
  { type: 'papers', label: 'Papers', icon: FileText },
  { type: 'query', label: 'Saved searches', icon: Filter },
]
const prettyStatus = s => (s || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())

function exportJson(items) {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), items }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'neurobase-watchlist.json'; a.click()
  URL.revokeObjectURL(url)
}

export default function Watchlist() {
  const items = useWatchlist()
  const [changes, setChanges] = useState([])
  // The "since" boundary is captured once, on mount, so it reflects the PREVIOUS
  // visit even after the user marks things seen this session.
  const [since] = useState(() => getLastSeen())

  useEffect(() => {
    let alive = true
    const trialIds = items.filter(i => i.type === 'trials').map(i => i.id)
    const orgIds = items.filter(i => i.type === 'organizations').map(i => i.id)
    getOrgTrialIds(orgIds).then(orgTrials => {
      const all = [...new Set([...trialIds, ...orgTrials])]
      return getWatchlistChanges(all, since ? new Date(since).toISOString() : null)
    }).then(c => { if (alive) setChanges(c) })
    return () => { alive = false }
  }, [items, since])

  const byType = Object.fromEntries(GROUPS.map(g => [g.type, items.filter(i => i.type === g.type)]))

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <SectionHeading
        kicker="My watchlist"
        title="Watchlist"
        sub="Entities and searches you follow. Stored in this browser only; nothing is sent to a server."
        right={items.length > 0 && (
          <button onClick={() => exportJson(items)} className="inline-flex items-center gap-1.5 text-[13px] font-sans text-ink-soft hover:text-accent transition-colors whitespace-nowrap">
            <Download className="w-4 h-4" /> Export JSON
          </button>
        )}
      />

      {items.length === 0 ? (
        <EmptyState icon={Star} title="Nothing on your watchlist yet">
          Use the Watch button on a company, device, trial, or paper to follow it. Your list lives in this browser and can be exported as JSON.
        </EmptyState>
      ) : (
        <>
          {/* What changed since the last visit */}
          <div className="mb-9 border border-rule rounded-sm bg-canvas/50 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <span className="flex items-center gap-2 text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted">
                <Activity className="w-3.5 h-3.5 text-accent" /> What changed{since ? ' since your last visit' : ''}
              </span>
              <button onClick={markSeen} className="text-[12px] font-sans text-muted hover:text-accent transition-colors">Mark as seen</button>
            </div>
            {changes.length === 0 ? (
              <p className="text-[13.5px] text-muted font-body">No trial status changes on your watched items yet. Changes appear here as trials you follow move between statuses. Email delivery is not available (it needs a server account, which NeuroBase does not have).</p>
            ) : (
              <ul className="flex flex-col divide-y divide-rule">
                {changes.map(c => (
                  <li key={c.id} className="py-2 first:pt-0 last:pb-0 flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-[13.5px] font-sans text-ink">
                      <span className="text-muted">{c.field}:</span> {c.field === 'status' ? prettyStatus(c.old_value) : (c.old_value || '—')} → <span className="font-medium">{c.field === 'status' ? prettyStatus(c.new_value) : (c.new_value || '—')}</span>
                      {c.title && <span className="text-muted"> · {c.title}</span>}
                    </span>
                    <span className="shrink-0 text-[12px] font-mono text-muted tabular-nums">{fmtDate(c.changed_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Watched items, grouped */}
          {GROUPS.filter(g => byType[g.type].length > 0).map(g => (
            <section key={g.type} className="mb-8">
              <h2 className="flex items-center gap-2 font-serif text-[1.25rem] font-semibold text-ink mb-3">
                <g.icon className="w-[17px] h-[17px] text-accent" strokeWidth={1.75} /> {g.label}
                <span className="text-[13px] font-sans font-normal text-muted">{byType[g.type].length}</span>
              </h2>
              <div className="divide-y divide-rule">
                {byType[g.type].map(item => (
                  <div key={`${item.type}:${item.id}`} className="flex items-center justify-between gap-3 py-2.5">
                    {item.to
                      ? <Link to={item.to} className="min-w-0 text-[15px] font-serif text-ink hover:text-accent truncate">{item.label}</Link>
                      : <span className="min-w-0 text-[15px] font-serif text-ink truncate">{item.label}</span>}
                    <button onClick={() => removeWatch(item.type, item.id)} aria-label="Remove from watchlist"
                      className="shrink-0 text-accent hover:text-highlight transition-colors" title="Remove">
                      <Star className="w-4 h-4" fill="currentColor" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
