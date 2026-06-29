import { Loader2 } from 'lucide-react'

// ── Ambient futuristic background (aurora blobs + technical grid) ────────────
export function NeuralBackground({ className = '' }) {
  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}>
      <div className="absolute inset-0 grid-bg" />
      <div className="aurora-blob animate-aurora" style={{ width: 520, height: 520, top: '-180px', left: '-120px', background: 'radial-gradient(circle, #4F7CFF, transparent 70%)' }} />
      <div className="aurora-blob animate-aurora" style={{ width: 460, height: 460, top: '-120px', right: '-100px', background: 'radial-gradient(circle, #A855F7, transparent 70%)', animationDelay: '-6s' }} />
      <div className="aurora-blob animate-aurora" style={{ width: 400, height: 400, top: '40px', left: '40%', background: 'radial-gradient(circle, #22D3EE, transparent 70%)', opacity: 0.25, animationDelay: '-12s' }} />
    </div>
  )
}

// ── Entity type → color system ───────────────────────────────────────────────
export const TYPE_STYLES = {
  papers:        { label: 'Research',     badge: 'text-cyan border-cyan/30 bg-cyan/10' },
  research:      { label: 'Research',     badge: 'text-cyan border-cyan/30 bg-cyan/10' },
  preprint:      { label: 'Preprint',     badge: 'text-primary-light border-primary/30 bg-primary/10' },
  paper:         { label: 'Paper',        badge: 'text-cyan border-cyan/30 bg-cyan/10' },
  devices:       { label: 'Device',       badge: 'text-accent border-accent/30 bg-accent/10' },
  organizations: { label: 'Organization', badge: 'text-mint border-mint/30 bg-mint/10' },
  researchers:   { label: 'Person',       badge: 'text-amber-300 border-amber-400/30 bg-amber-400/10' },
  trials:        { label: 'Trial',        badge: 'text-rose-300 border-rose-400/30 bg-rose-400/10' },
  news:          { label: 'News',         badge: 'text-rose-300 border-rose-400/30 bg-rose-400/10' },
}

export function TypeBadge({ type }) {
  const c = TYPE_STYLES[type] || TYPE_STYLES.papers
  return (
    <span className={`text-[10px] font-mono font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${c.badge}`}>
      {c.label}
    </span>
  )
}

export function Tag({ children, onClick, active }) {
  const base = 'text-[10px] font-mono px-2 py-0.5 rounded-md border transition-colors'
  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={`${base} ${active
          ? 'bg-primary/20 border-primary/50 text-primary-light'
          : 'bg-white/[0.03] border-divider text-muted hover:text-ink hover:border-primary/40'}`}
      >
        {children}
      </button>
    )
  }
  return <span className={`${base} bg-white/[0.03] border-divider text-muted`}>{children}</span>
}

export function ScoreDot({ score }) {
  const color = score >= 8 ? 'bg-mint shadow-[0_0_8px_#34D399]' : score >= 6 ? 'bg-amber-400 shadow-[0_0_8px_#FBBF24]' : 'bg-muted/50'
  return (
    <span className="flex items-center gap-1.5 text-xs font-mono text-muted">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      {score}/10
    </span>
  )
}

export function LiveBadge({ children }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-mono text-mint bg-mint/10 border border-mint/30 px-3 py-1.5 rounded-full">
      <span className="w-1.5 h-1.5 bg-mint rounded-full animate-pulse-slow shadow-[0_0_8px_#34D399]" />
      {children}
    </span>
  )
}

export function Loader({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center py-24 text-muted gap-2">
      <Loader2 className="w-5 h-5 animate-spin text-primary" />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      {Icon && (
        <div className="w-14 h-14 rounded-2xl glass flex items-center justify-center mb-4">
          <Icon className="w-6 h-6 text-muted" />
        </div>
      )}
      <p className="font-display font-semibold text-ink">{title}</p>
      {children && <p className="text-sm text-muted mt-1 max-w-sm">{children}</p>}
    </div>
  )
}

export function PageHeader({ eyebrow, title, sub, children }) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap mb-8">
      <div>
        {eyebrow && (
          <p className="font-mono text-xs text-primary-light uppercase tracking-[0.2em] mb-2">{eyebrow}</p>
        )}
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-ink tracking-tight">{title}</h1>
        {sub && <p className="text-muted text-sm mt-2 max-w-2xl leading-relaxed">{sub}</p>}
      </div>
      {children}
    </div>
  )
}
