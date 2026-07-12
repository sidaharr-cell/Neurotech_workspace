import { ArrowUpRight } from 'lucide-react'
import { Kicker, Meta, DeviceClassLabels, fmtDate, typeWord } from './ui'

function itemMeta(item) {
  return {
    source: item.source,
    date: fmtDate(item.published_at),
    cites: item.metadata?.citationCount ?? 0,
  }
}

export function LeadStory({ item }) {
  const m = itemMeta(item)
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className="group block pb-8 mb-8 border-b border-rule">
      <div className="flex items-center gap-3 mb-3">
        <Kicker>{typeWord(item.entry_type)}</Kicker>
        <DeviceClassLabels entity={item} />
      </div>
      <h2 className="font-serif text-[2rem] sm:text-[2.6rem] leading-[1.08] font-semibold text-ink tracking-[-0.015em] headline-link">
        {item.title}
      </h2>
      {item.summary && (
        <p className="mt-3 text-[1.05rem] leading-relaxed text-ink-soft font-body max-w-prose line-clamp-3">
          {item.summary}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Meta {...m} />
        <ArrowUpRight className="w-4 h-4 text-muted group-hover:text-accent transition-colors" />
      </div>
    </a>
  )
}

export function ArticleRow({ item }) {
  const m = itemMeta(item)
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className="group flex gap-5 py-5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3 mb-1.5">
          <Kicker>{typeWord(item.entry_type)}</Kicker>
          <DeviceClassLabels entity={item} max={1} />
        </div>
        <h3 className="font-serif text-[1.3rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-3">
          {item.title}
        </h3>
        {item.summary && (
          <p className="mt-1.5 text-[0.95rem] leading-relaxed text-ink-soft font-body line-clamp-2">
            {item.summary}
          </p>
        )}
        <div className="mt-2"><Meta {...m} /></div>
      </div>
    </a>
  )
}

/** Full editorial list: optional lead story + hairline-separated rows. */
export default function NewsList({ items, lead = true }) {
  if (!items.length) return null
  const [first, ...rest] = items
  return (
    <div>
      {lead && <LeadStory item={first} />}
      <div className="divide-rule">
        {(lead ? rest : items).map((item, i) => <ArticleRow key={item.id || i} item={item} />)}
      </div>
    </div>
  )
}
