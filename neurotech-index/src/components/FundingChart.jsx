import { useState } from 'react'
import funding from '../data/funding.json'

const fmtMoney = m => (m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${m}M`)
const monthsSince = d => (d ? (Date.now() - new Date(d).getTime()) / (30 * 864e5) : Infinity)
const dateLabel = d => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) : '')

const SORTS = [
  { id: 'total', label: 'Total raised' },
  { id: 'latest', label: 'Latest raise size' },
  { id: 'recent', label: 'Latest raise date' },
]

/** Top companies by funding, with a live "latest raise" column and sorting. */
export default function FundingChart({ companies, limit = 20 }) {
  const [sort, setSort] = useState('total')

  const rows = companies
    .filter(c => c.type === 'company')
    .map(c => {
      const f = funding[c.name] || {}
      return { name: c.name, total: f.total ?? c.funding ?? 0, latestAmount: f.latestAmount || 0, latestDate: f.latestDate || null }
    })
    .filter(c => c.total > 0)

  const cmp = {
    total: (a, b) => b.total - a.total,
    latest: (a, b) => b.latestAmount - a.latestAmount,
    recent: (a, b) => monthsSince(a.latestDate) - monthsSince(b.latestDate),
  }[sort]
  const data = [...rows].sort(cmp).slice(0, limit)
  if (!data.length) return null

  const barOf = c => (sort === 'latest' ? c.latestAmount : c.total)
  const max = Math.max(...data.map(barOf), 1)

  return (
    <figure className="border border-rule rounded-sm bg-canvas/50 p-5 sm:p-6 mb-10">
      <figcaption className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker mb-1">Investment</p>
          <h2 className="font-serif text-xl sm:text-2xl font-semibold text-ink">Top {data.length} neurotech companies by funding raised</h2>
          <p className="text-[13px] text-muted font-sans mt-1">Total capital and most-recent round, auto-updated from SEC Form D filings where available.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-sans uppercase tracking-[0.08em] text-muted/70 mr-1">Sort</span>
          {SORTS.map(s => (
            <button key={s.id} onClick={() => setSort(s.id)}
              className={`text-[12px] font-sans px-2.5 py-1 rounded-full border transition-colors ${sort === s.id ? 'bg-ink text-paper border-ink' : 'bg-paper text-ink-soft border-rule hover:border-ink'}`}>
              {s.label}
            </button>
          ))}
        </div>
      </figcaption>

      <div className="flex items-center gap-3 pb-1.5 mb-1 border-b border-rule text-[10px] font-sans font-semibold uppercase tracking-[0.08em] text-muted/70">
        <span className="w-28 sm:w-44 shrink-0" />
        <span className="flex-1" />
        <span className="w-14 shrink-0 text-right">Total</span>
        <span className="w-24 sm:w-28 shrink-0 text-right">Latest raise</span>
      </div>

      <div>
        {data.map((c, i) => {
          const recent = monthsSince(c.latestDate) < 6
          return (
            <div key={c.name} className="flex items-center gap-3 py-[3px]">
              <span className="w-28 sm:w-44 shrink-0 text-right text-[12.5px] font-sans text-ink-soft truncate" title={c.name}>{c.name}</span>
              <div className="flex-1 min-w-0">
                <div className="h-4 rounded-[2px] bg-accent" style={{ width: `${Math.max((barOf(c) / max) * 100, 2)}%`, opacity: 1 - i * 0.018 }} />
              </div>
              <span className="w-14 shrink-0 text-[12px] font-mono text-ink tabular-nums text-right">{fmtMoney(c.total)}</span>
              <span className="w-24 sm:w-28 shrink-0 text-[11px] font-mono tabular-nums text-right flex items-center justify-end gap-1.5">
                {c.latestAmount ? (
                  <>
                    {recent && <span className="w-1.5 h-1.5 rounded-full bg-mint shrink-0" title={`Raised ${dateLabel(c.latestDate)}`} />}
                    <span className="text-ink-soft">{fmtMoney(c.latestAmount)}</span>
                    <span className="text-muted hidden sm:inline">· {dateLabel(c.latestDate)}</span>
                  </>
                ) : <span className="text-muted/40">n/a</span>}
              </span>
            </div>
          )
        })}
      </div>
    </figure>
  )
}
