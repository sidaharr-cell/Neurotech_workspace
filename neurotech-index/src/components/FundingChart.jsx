import funding from '../data/funding.json'

const fmtMoney = m => (m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${m}M`)

function recency(dateStr) {
  if (!dateStr) return null
  const months = (Date.now() - new Date(dateStr).getTime()) / (30 * 864e5)
  const color = months < 6 ? 'bg-mint' : months < 24 ? 'bg-amber-400' : 'bg-muted/40'
  const label = new Date(dateStr).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  return { color, label }
}

/** Top companies by total funding raised, with a live "latest raise" column. */
export default function FundingChart({ companies, limit = 20 }) {
  const data = companies
    .filter(c => c.type === 'company')
    .map(c => {
      const f = funding[c.name] || {}
      return { name: c.name, total: f.total ?? c.funding ?? 0, latestAmount: f.latestAmount, latestDate: f.latestDate }
    })
    .filter(c => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
  if (!data.length) return null
  const max = data[0].total

  return (
    <figure className="border border-rule rounded-sm bg-canvas/50 p-5 sm:p-6 mb-10">
      <figcaption className="mb-4">
        <p className="kicker mb-1">Investment</p>
        <h2 className="font-serif text-xl sm:text-2xl font-semibold text-ink">Top {data.length} neurotech companies by funding raised</h2>
        <p className="text-[13px] text-muted font-sans mt-1">Total capital raised and most-recent round — auto-updated from SEC Form D filings where available.</p>
      </figcaption>

      <div className="flex items-center gap-3 pb-1.5 mb-1 border-b border-rule text-[10px] font-sans font-semibold uppercase tracking-[0.08em] text-muted/70">
        <span className="w-28 sm:w-44 shrink-0" />
        <span className="flex-1" />
        <span className="w-14 shrink-0 text-right">Total</span>
        <span className="w-24 sm:w-28 shrink-0 text-right">Latest raise</span>
      </div>

      <div>
        {data.map((c, i) => {
          const r = recency(c.latestDate)
          return (
            <div key={c.name} className="flex items-center gap-3 py-[3px]">
              <span className="w-28 sm:w-44 shrink-0 text-right text-[12.5px] font-sans text-ink-soft truncate" title={c.name}>{c.name}</span>
              <div className="flex-1 min-w-0">
                <div className="h-4 rounded-[2px] bg-accent" style={{ width: `${Math.max((c.total / max) * 100, 2)}%`, opacity: 1 - i * 0.018 }} />
              </div>
              <span className="w-14 shrink-0 text-[12px] font-mono text-ink tabular-nums text-right">{fmtMoney(c.total)}</span>
              <span className="w-24 sm:w-28 shrink-0 text-[11px] font-mono tabular-nums text-right flex items-center justify-end gap-1.5">
                {c.latestAmount ? (
                  <>
                    {r && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.color}`} title={`Last raise ${r.label}`} />}
                    <span className="text-ink-soft">{fmtMoney(c.latestAmount)}</span>
                    {r && <span className="text-muted hidden sm:inline">· {r.label}</span>}
                  </>
                ) : <span className="text-muted/40">—</span>}
              </span>
            </div>
          )
        })}
      </div>
      <p className="text-[11px] text-muted/70 font-sans mt-3 flex items-center gap-3">
        <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-mint" /> &lt;6 mo</span>
        <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> &lt;2 yr</span>
        <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-muted/40" /> older</span>
      </p>
    </figure>
  )
}
