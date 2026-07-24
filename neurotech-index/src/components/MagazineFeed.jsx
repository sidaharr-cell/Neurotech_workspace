import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Newspaper } from 'lucide-react'
import { getNewsFeed, recencyCutoffISO } from '../lib/data'
import { supabase } from '../lib/supabase'
import { SectionHeading, Loader, EmptyState, Kicker, Meta, DeviceClassLabels, fmtDate, typeWord } from './ui'
import FilterSelect, { RECENCY_DATE, FEED_TYPE, SORT_SIGNIF } from './Filters'
import FacetSidebar, { NO_FACETS } from './FacetSidebar'
import NotableRail from './NotableRail'
import { Cover } from './neuron'
import { entityMatchesFacets, facetsOfEntity } from '../lib/facets'
import { isReputableSource, neurotechCentrality } from '../lib/sources'

const tintOf = item => facetsOfEntity(item).function[0] || 'default'
const metaOf = item => ({ source: item.source, date: fmtDate(item.published_at), cites: item.metadata?.citationCount ?? 0 })

function LeadCard({ item }) {
  return (
    <Link to={`/item/${item.id}`} className="group block">
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
    </Link>
  )
}

function SidebarItem({ item }) {
  return (
    <Link to={`/item/${item.id}`} className="group block py-4">
      <div className="mb-1"><Kicker>{typeWord(item.entry_type)}</Kicker></div>
      <h3 className="font-serif text-[1.15rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-3">{item.title}</h3>
      <div className="mt-1.5"><Meta {...metaOf(item)} /></div>
    </Link>
  )
}

function FeaturedCard({ item }) {
  return (
    <Link to={`/item/${item.id}`} className="group block">
      <div className="aspect-[4/3] overflow-hidden bg-canvas mb-3">
        <Cover item={item} tint={tintOf(item)} className="group-hover:scale-[1.02] transition-transform duration-500" />
      </div>
      <div className="mb-1.5"><Kicker>{typeWord(item.entry_type)}</Kicker></div>
      <h3 className="font-serif text-[1.3rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-3">{item.title}</h3>
      {item.summary && <p className="mt-1.5 text-[0.9rem] leading-relaxed text-ink-soft font-body line-clamp-2">{item.summary}</p>}
      <div className="mt-2"><Meta {...metaOf(item)} /></div>
    </Link>
  )
}

function CompactRow({ item }) {
  return (
    <Link to={`/item/${item.id}`} className="group block py-4">
      <div className="mb-1"><Kicker>{typeWord(item.entry_type)}</Kicker></div>
      <h3 className="font-serif text-[1.15rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-2">{item.title}</h3>
      <div className="mt-1"><Meta {...metaOf(item)} /></div>
    </Link>
  )
}

export default function MagazineFeed() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [facets, setFacets] = useState(NO_FACETS)
  const [recency, setRecency] = useState(null)
  const [type, setType] = useState(null)
  const [sort, setSort] = useState('relevant')

  useEffect(() => {
    let alive = true
    // Fetch a wide set so real-image stories (which rank below papers) are
    // available to feature; the display below still caps at ~20 entries.
    getNewsFeed({ limit: 120 }).then(d => { if (alive) { setItems(d); setLoading(false) } })
    return () => { alive = false }
  }, [])

  const shown = useMemo(() => {
    const cutoff = recencyCutoffISO(recency)
    const isResearch = i => i.entry_type === 'paper' || i.entry_type === 'preprint'
    let out = items.filter(i =>
      entityMatchesFacets(i, facets) &&
      (!cutoff || (i.published_at && i.published_at >= cutoff)) &&
      (!type || (type === 'research' ? isResearch(i) : i.entry_type === 'news'))
    )
    if (sort === 'newest') out = [...out].sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0))
    return out
  }, [items, facets, recency, type, sort])

  // Prefer image-bearing items for the visual slots (lead + featured grid);
  // fill the rest by rank. Papers (no photo) fall back to the neuron motif.
  // Show ~20 entries total. The visual slots (lead + featured) prefer
  // image-bearing stories pulled from the full ranked feed; the remaining
  // slots fill with the top-ranked items.
  const { lead, featured, sidebar, rest } = useMemo(() => {
    const area = i => (i.metadata?.imageW || 0) * (i.metadata?.imageH || 0)
    const realImg = i => i.metadata?.image && i.metadata?.imageKind === 'real'
    const realImgs = shown
      .filter(realImg)
      .sort((a, b) => (sort === 'newest' ? 0 : area(b) - area(a)))

    // The lead story must come from a reputable source (peer-reviewed journal or
    // quality outlet — not a press-release aggregator) and sit squarely in
    // neurotech. Among reputable items, prefer neurotech-central stories, then a
    // real image, then overall rank. Fall back to the old logic only if nothing
    // reputable is available.
    const reputable = shown.filter(isReputableSource)
    const pool = reputable.length ? reputable : shown
    const leadScore = i => neurotechCentrality(i) * 3 + (realImg(i) ? 2 : 0) + (i.metadata?.rankScore ?? 0)
    const lead = [...pool].sort((a, b) => leadScore(b) - leadScore(a))[0] || realImgs[0] || shown[0]
    const used = new Set(lead ? [lead] : [])
    const featured = []
    for (const it of [...realImgs, ...shown]) {
      if (featured.length >= 3) break
      if (used.has(it)) continue
      featured.push(it); used.add(it)
    }
    const remaining = shown.filter(i => !used.has(i)).slice(0, 16)
    return { lead, featured, sidebar: remaining.slice(0, 4), rest: remaining.slice(4) }
  }, [shown, sort])

  // Keys (DOI + normalized title) of everything rendered in the feed above, so
  // the Notable rail can suppress any paper that's already shown on this page.
  const shownKeys = useMemo(() => {
    const norm = t => (t || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
    const keys = new Set()
    const add = it => { if (!it) return; if (it.metadata?.doi) keys.add(it.metadata.doi.toLowerCase()); if (it.title) keys.add(norm(it.title)) }
    add(lead); featured.forEach(add); sidebar.forEach(add); rest.forEach(add)
    return keys
  }, [lead, featured, sidebar, rest])

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <SectionHeading
        kicker="Updated daily"
        title="Top Stories"
        sub="The most significant neurotechnology research, devices, and coverage, ranked by relevance, engagement, and recency."
      />
      <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
        <FacetSidebar
          facets={facets}
          onChange={setFacets}
          extras={[
            { label: 'Type', value: type, onChange: setType, options: FEED_TYPE, allLabel: 'All types' },
            { label: 'Recency', value: recency, onChange: setRecency, options: RECENCY_DATE, allLabel: 'Any time' },
          ]}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-end h-9 mb-6 border-b border-rule">
            <FilterSelect label="Sort" value={sort} onChange={setSort} options={SORT_SIGNIF} required />
          </div>

          {!supabase ? (
            <EmptyState icon={Newspaper} title="Feed unavailable offline">Connect Supabase to see the live feed.</EmptyState>
          ) : loading ? (
            <Loader label="Loading…" />
          ) : !lead ? (
            <EmptyState icon={Newspaper} title="Nothing here yet">
              {(facets.function.length || facets.access.length || facets.application.length) ? 'No items match these filters right now.' : 'The feed populates after the daily refresh.'}
            </EmptyState>
          ) : (
            <>
              {/* Lead + more-stories rail */}
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

              {/* Notable research rail (unfiltered — highest field-normalized impact) */}
              {!facets.function.length && !facets.access.length && !facets.application.length && !recency && !type && <NotableRail exclude={shownKeys} />}

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
      </div>
    </div>
  )
}
