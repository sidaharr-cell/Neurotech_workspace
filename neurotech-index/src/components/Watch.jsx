import { Star } from 'lucide-react'
import { toggleWatch, useIsWatched } from '../lib/watchlist'

/**
 * StarButton — toggles an item on the local watchlist (Phase 8). `item` is
 * { type, id, label, url? }. Two sizes: 'pill' (a labeled button for a page
 * header) and 'icon' (a bare star for list rows). Keyboard reachable and
 * labeled; the state is conveyed by text/aria, not color alone.
 */
export function StarButton({ item, variant = 'pill' }) {
  const watched = useIsWatched(item.type, item.id)
  const onClick = e => { e.preventDefault(); e.stopPropagation(); toggleWatch(item) }
  const label = watched ? 'Remove from watchlist' : 'Add to watchlist'

  if (variant === 'icon') {
    return (
      <button onClick={onClick} aria-pressed={watched} aria-label={label} title={label}
        className={`shrink-0 p-1 rounded-sm transition-colors ${watched ? 'text-accent' : 'text-muted/50 hover:text-accent'}`}>
        <Star className="w-4 h-4" fill={watched ? 'currentColor' : 'none'} strokeWidth={1.75} />
      </button>
    )
  }
  return (
    <button onClick={onClick} aria-pressed={watched}
      className={`inline-flex items-center gap-1.5 text-[13px] font-sans font-medium px-3 py-1.5 rounded-full border transition-colors ${
        watched ? 'border-accent text-accent bg-accent/5' : 'border-rule text-ink-soft hover:border-accent hover:text-accent'
      }`}>
      <Star className="w-3.5 h-3.5" fill={watched ? 'currentColor' : 'none'} /> {watched ? 'Watching' : 'Watch'}
    </button>
  )
}
