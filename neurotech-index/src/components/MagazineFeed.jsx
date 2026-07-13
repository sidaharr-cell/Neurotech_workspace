import { useState, useEffect, useMemo } from 'react'
import { Newspaper } from 'lucide-react'
import { getNewsFeed } from '../lib/data'
import { supabase } from '../lib/supabase'
import { SectionHeading, Loader, EmptyState, Kicker, Meta, DeviceClassLabels, fmtDate, typeWord } from './ui'
import DeviceClassFilter from './DeviceClassFilter'
import { Cover } from './neuron'
import { entityMatchesClass, classesForEntity } from '../lib/taxonomy'

const tintOf = item => classesForEntity(item)[0]?.id || 'default'
const metaOf = item => ({ source: item.source, date: fmtDate(item.published_at), cites: item.metadata?.citationCount ?? 0 })

function LeadCard({ item }) {
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className="group block">
      <div className="aspect-[16/9] overflow-hidden bg-canvas mb-4">
        <Cover item={item} tint={tintOf(item)} requireReal priority className="group-hover:scale-[1.02] transition-transform duration-500" />
      </div>
      <div className="flex items-center gap-3 mb-2">
        <Kicker>{typeWord(item.entry_type)}</Kicker>
        <DeviceClassLabels entity={item} />
      </div>
      <h2 className="font-serif text-[2rem] sm:text-[2.4rem] leading-[1.08] font-semibold text-ink tracking-[-0.015em] headline-link">
        {item.title}
      </h2>
      {item.summary && <p className="mt-3 text-[1.05rem] leading-relaxed text-ink-soft font-body line-clamp-3">{item.summary}</p>}
      <div className="mt-3"><Meta {...metaOf(item)} /></div>
    </a>
  )
}

function SidebarItem({ item }) {
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className="group block py-4">
      <div className="mb-1"><Kicker>{typeWord(item.entry_type)}</Kicker></div>
      <h3 className="font-serif text-[1.15rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-3">{item.title}</h3>
      <div className="mt-1.5"><Meta {...metaOf(item)} /></div>
    </a>
  )
}

function FeaturedCard({ item }) {
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className="group block">
      <div className="aspect-[4/3] overflow-hidden bg-canvas mb-3">
        <Cover item={item} tint={tintOf(item)} className="group-hover:scale-[1.02] transition-transform duration-500" />
      </div>
      <div className="mb-1.5"><Kicker>{typeWord(item.entry_type)}</Kicker></div>
      <h3 className="font-serif text-[1.3rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-3">{item.title}</h3>
      {item.summary && <p className="mt-1.5 text-[0.9rem] leading-relaxed text-ink-soft font-body line-clamp-2">{item.summary}</p>}
      <div className="mt-2"><Meta {...metaOf(item)} /></div>
    </a>
  )
}

function CompactRow({ item }) {
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className="group flex gap-4 py-4 items-start">
      <div className="w-24 h-20 shrink-0 overflow-hidden bg-canvas">
        <Cover item={item} tint={tintOf(item)} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1"><Kicker>{typeWord(item.entry_type)}</Kicker></div>
        <h3 className="font-serif text-[1.15rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-2">{item.title}</h3>
        <div className="mt-1"><Meta {...metaOf(item)} /></div>
      </div>
    </a>
  )
}

export default function MagazineFeed() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [cls, setCls] = useState(null)

  useEffect(() => {
    let alive = true
    // Fetch a wide set so real-image stories (which rank below papers) are
    // available to feature; the display below still caps at ~20 entries.
    getNewsFeed({ limit: 120 }).then(d => { if (alive) { setItems(d); setLoading(false) } })
    return () => { alive = false }
  }, [])

  const shown = useMemo(() => (cls ? items.filter(i => entityMatchesClass(i, cls)) : items), [items, cls])

  // Prefer image-bearing items for the visual slots (lead + featured grid);
  // fill the rest by rank. Papers (no photo) fall back to the neuron motif.
  // Show ~20 entries total. The visual slots (lead + featured) prefer
  // image-bearing stories pulled from the full ranked feed; the remaining
  // slots fill with the top-ranked items.
  const { lead, featured, sidebar, rest } = useMemo(() => {
    // Lead must have a verified-real image (never stock). Featured prefer real
    // images too; everything else falls back to the neuron motif.
    const realImgs = shown.filter(i => i.metadata?.image && i.metadata?.imageKind === 'real')
    const lead = realImgs[0] || shown[0]
    const used = new Set(lead ? [lead] : [])
    const featured = []
    for (const it of [...realImgs, ...shown]) {
      if (featured.length >= 3) break
      if (used.has(it)) continue
      featured.push(it); used.add(it)
    }
    const remaining = shown.filter(i => !used.has(i)).slice(0, 16)
    return { lead, featured, sidebar: remaining.slice(0, 4), rest: remaining.slice(4) }
  }, [shown])

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <SectionHeading
        kicker="Updated daily"
        title="Top Stories"
        sub="The most significant neurotechnology — research, devices, and coverage — ranked by relevance, engagement, and recency."
      />
      <DeviceClassFilter value={cls} onChange={setCls} />

      {!supabase ? (
        <EmptyState icon={Newspaper} title="Feed unavailable offline">Connect Supabase to see the live feed.</EmptyState>
      ) : loading ? (
        <Loader label="Loading…" />
      ) : !lead ? (
        <EmptyState icon={Newspaper} title="Nothing here yet">
          {cls ? 'No items match this device class right now.' : 'The feed populates after the daily refresh.'}
        </EmptyState>
      ) : (
        <>
          {/* Lead + sidebar */}
          <div className="grid lg:grid-cols-3 gap-8 lg:gap-10">
            <div className="lg:col-span-2"><LeadCard item={lead} /></div>
            {sidebar.length > 0 && (
              <div className="lg:border-l lg:border-rule lg:pl-8">
                <div className="border-b-2 border-ink pb-1.5 mb-1">
                  <Kicker>More stories</Kicker>
                </div>
                <div className="divide-rule">
                  {sidebar.map((it, i) => <SidebarItem key={it.id || i} item={it} />)}
                </div>
              </div>
            )}
          </div>

          {/* Featured grid */}
          {featured.length > 0 && (
            <div className="mt-12 pt-8 border-t-2 border-ink">
              <div className="grid sm:grid-cols-3 gap-8">
                {featured.map((it, i) => <FeaturedCard key={it.id || i} item={it} />)}
              </div>
            </div>
          )}

          {/* Remaining, compact */}
          {rest.length > 0 && (
            <div className="mt-12 pt-6 border-t border-rule">
              <div className="mb-2"><Kicker>Latest</Kicker></div>
              <div className="grid md:grid-cols-2 md:gap-x-10">
                {rest.map((it, i) => <div key={it.id || i} className="border-b border-rule"><CompactRow item={it} /></div>)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
