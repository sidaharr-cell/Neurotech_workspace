import { useState, useEffect, useMemo } from 'react'
import { Newspaper } from 'lucide-react'
import { getNewsFeed, recencyCutoffISO } from '../lib/data'
import { supabase } from '../lib/supabase'
import { Loader, EmptyState, RuleHeading } from '../components/ui'
import FilterSelect, { RECENCY_DATE, SORT_SIGNIF } from '../components/Filters'
import FilterBar from '../components/FilterBar'
import { useUrlFacets } from '../lib/useUrlFacets'
import { LeadCard, RailRow, StoryCard, RuledGrid, RuledCell } from '../components/MagazineFeed'
import { ArticleRow } from '../components/NewsList'
import { entityMatchesFacets, countFacets } from '../lib/facets'
import { composeMedia, MEDIA_SLOTS, byNewest } from '../lib/mediapage'
import { assignImages } from '../lib/image'

const NEWS = ['news']

/**
 * News and Press.
 *
 * This page was a flat list: one lead headline and then two hundred hairline
 * -separated rows of text, no pictures anywhere, because NewsList renders none.
 * That is a search result, not a section front — and it is the one page on the
 * site whose entire content is the kind of thing that comes WITH a photograph.
 *
 * It is now built from the home page's own components (LeadCard, StoryCard,
 * RailRow, RuledGrid), imported rather than reimplemented. Two reasons. A reader
 * moving between the front page and a section should not feel they have changed
 * publications, and a shared component cannot drift the way a copied one does:
 * the crop ratios, the hairline geometry, the byline treatment and the image
 * credit are all decided once.
 *
 * The tail keeps the old dense rows on purpose. Past the first twenty or so
 * stories the reader is scanning for a specific thing rather than browsing, and
 * a picture per row makes scanning slower, not faster.
 */
export default function Media() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [facets, setFacets] = useUrlFacets()
  const [recency, setRecency] = useState(null)
  const [outlet, setOutlet] = useState(null)
  const [sort, setSort] = useState('relevant')
  const [tailShown, setTailShown] = useState(MEDIA_SLOTS.tail)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getNewsFeed({ entryTypes: NEWS, limit: 400 }).then(d => {
      if (alive) { setItems(d); setLoading(false) }
    })
    return () => { alive = false }
  }, [])

  // Outlet options: the outlets actually present, most-frequent first.
  const outletOptions = useMemo(() => {
    const counts = {}
    items.forEach(i => { if (i.source) counts[i.source] = (counts[i.source] || 0) + 1 })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([s]) => ({ id: s, label: s }))
  }, [items])

  // Everything recency and outlet allow, before any facet is applied. The facet
  // counts come off this list, so they answer the question the reader is asking:
  // how many of the stories in front of me does this value hold.
  const candidates = useMemo(() => {
    const cutoff = recencyCutoffISO(recency)
    return items.filter(i =>
      (!cutoff || (i.published_at && i.published_at >= cutoff)) &&
      (!outlet || i.source === outlet)
    )
  }, [items, recency, outlet])

  const facetCts = useMemo(() => countFacets(candidates, facets), [candidates, facets])

  const shown = useMemo(() => {
    const out = candidates.filter(i => entityMatchesFacets(i, facets))
    return sort === 'newest' ? [...out].sort(byNewest) : out
  }, [candidates, facets, sort])

  const { lead, rail, featured, grid, tail } = useMemo(() => composeMedia(shown, sort), [shown, sort])

  // Reset the tail whenever the filters change, so a reader who has paged deep
  // into one selection does not land mid-tail in the next.
  const filterKey = `${JSON.stringify(facets)}|${recency}|${outlet}|${sort}`
  useEffect(() => { setTailShown(MEDIA_SLOTS.tail) }, [filterKey])

  // Every picture decided in one pass: the story's own photograph where it has
  // one, otherwise the best unused photograph in the reviewed pool for what the
  // story is about. Without this, a page of brain-computer interface coverage
  // runs the same conference photograph a dozen times, and most of these stories
  // reach us through an aggregator that strips the publisher's image entirely.
  //
  // Only the picture-bearing sections are listed. The rail and the tail show no
  // images, and an item assigned a photograph it never renders takes that
  // photograph out of the pool for a card that would have shown it.
  const images = useMemo(
    () => assignImages([lead, ...featured, ...grid].filter(Boolean)),
    [lead, featured, grid],
  )
  const pictureOf = it => images.get(it?.id) ?? null

  const anyFacet = Boolean(facets.function?.length || facets.access?.length || facets.application?.length)

  return (
    <div className="page-wide py-6">
      {/* Masthead, set to match the front page's: same rank of heading over the
          same heavy rule, so the two read as one publication. */}
      <div className="flex items-end justify-between gap-4 flex-wrap border-b-2 border-ink pb-2.5">
        <h1 className="font-serif text-3xl sm:text-[2.5rem] leading-none font-semibold text-ink tracking-[-0.015em]">
          News and Press
        </h1>
        <p className="text-muted text-[13px] font-sans leading-relaxed">
          Worldwide neurotechnology coverage from press and media outlets. Updated daily.
        </p>
      </div>

      <div className="border-b border-rule mb-8">
        <FilterBar
          facets={facets}
          onChange={setFacets}
          counts={facetCts}
          sort={<FilterSelect label="Sort" value={sort} onChange={setSort} options={SORT_SIGNIF} required />}
          extras={[
            ...(outletOptions.length > 1
              ? [{ label: 'Outlet', value: outlet, onChange: setOutlet, options: outletOptions, allLabel: 'All outlets' }]
              : []),
            { label: 'Recency', value: recency, onChange: setRecency, options: RECENCY_DATE, allLabel: 'Any time' },
          ]}
        />
      </div>

      {!supabase ? (
        <EmptyState icon={Newspaper} title="Feed unavailable offline">Connect Supabase to see the live feed.</EmptyState>
      ) : loading ? (
        <Loader label="Loading…" />
      ) : !lead ? (
        <EmptyState icon={Newspaper} title="Nothing here yet">
          {anyFacet ? 'No items match these filters right now.' : 'Media items populate from the daily press-feed ingestion.'}
        </EmptyState>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4 mb-6">
            <span className="text-[13px] font-sans text-muted">
              {shown.length.toLocaleString()} {shown.length === 1 ? 'story' : 'stories'}
            </span>
          </div>

          {/* Lead plus the rail of more stories */}
          <div className="grid lg:grid-cols-12 gap-8 lg:gap-10">
            <div className="lg:col-span-8 flex flex-col">
              <LeadCard item={lead} image={pictureOf(lead)} />
            </div>
            {rail.length > 0 && (
              <aside className="lg:col-span-4 lg:border-l lg:border-rule lg:pl-8">
                <RuleHeading title="More stories" />
                <div className="divide-rule">
                  {rail.map((it, i) => <RailRow key={it.id || i} item={it} />)}
                </div>
              </aside>
            )}
          </div>

          {featured.length > 0 && (
            <section className="mt-12">
              <RuleHeading title="Featured" />
              <RuledGrid cols="sm:grid-cols-2 lg:grid-cols-3">
                {featured.map((it, i) => (
                  <RuledCell key={it.id || i}>
                    <StoryCard item={it} image={pictureOf(it)} size="lg" />
                  </RuledCell>
                ))}
              </RuledGrid>
            </section>
          )}

          {grid.length > 0 && (
            <section className="mt-12">
              <RuleHeading title="Latest coverage" />
              <RuledGrid cols="sm:grid-cols-2 lg:grid-cols-4">
                {grid.map((it, i) => (
                  <RuledCell key={it.id || i}>
                    <StoryCard item={it} image={pictureOf(it)} />
                  </RuledCell>
                ))}
              </RuledGrid>
            </section>
          )}

          {tail.length > 0 && (
            <section className="mt-12">
              <RuleHeading title="More coverage" note={`${tail.length.toLocaleString()} further stories`} />
              <div className="divide-y divide-rule">
                {tail.slice(0, tailShown).map((it, i) => <ArticleRow key={it.id || i} item={it} />)}
              </div>
              {tailShown < tail.length && (
                <div className="pt-6 border-t border-rule">
                  <button
                    onClick={() => setTailShown(n => n + MEDIA_SLOTS.tail)}
                    className="font-sans text-[13px] font-semibold uppercase tracking-[0.1em] text-accent hover:underline"
                  >
                    Show {Math.min(MEDIA_SLOTS.tail, tail.length - tailShown)} more
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
