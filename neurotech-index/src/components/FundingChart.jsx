const fmtMoney = m => (m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${m}M`)

/** Horizontal bar chart of top companies by approximate total funding raised. */
export default function FundingChart({ companies, limit = 20 }) {
  const data = [...companies]
    .filter(c => c.type === 'company' && c.funding > 0)
    .sort((a, b) => b.funding - a.funding)
    .slice(0, limit)
  if (!data.length) return null
  const max = data[0].funding

  return (
    <figure className="border border-rule rounded-sm bg-canvas/50 p-5 sm:p-6 mb-10">
      <figcaption className="mb-4">
        <p className="kicker mb-1">Investment</p>
        <h2 className="font-serif text-xl sm:text-2xl font-semibold text-ink">Top {data.length} neurotech companies by funding raised</h2>
        <p className="text-[13px] text-muted font-sans mt-1">Approximate total capital raised to date, from public reporting.</p>
      </figcaption>
      <div>
        {data.map((c, i) => (
          <div key={c.name} className="flex items-center gap-3 py-[3px]">
            <span className="w-32 sm:w-44 shrink-0 text-right text-[12.5px] font-sans text-ink-soft truncate" title={c.name}>{c.name}</span>
            <div className="flex-1 min-w-0">
              <div
                className="h-4 rounded-[2px] bg-accent transition-[width] duration-700"
                style={{ width: `${Math.max((c.funding / max) * 100, 2)}%`, opacity: 1 - i * 0.018 }}
              />
            </div>
            <span className="w-14 shrink-0 text-[12px] font-mono text-ink tabular-nums">{fmtMoney(c.funding)}</span>
          </div>
        ))}
      </div>
    </figure>
  )
}
