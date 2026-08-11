import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Newspaper, ChevronLeft, ChevronRight } from 'lucide-react'
import { searchNews, getNewsOutlets } from '../lib/data'
import { supabase } from '../lib/supabase'
import { Loader, EmptyState, Kicker, fmtDate } from '../components/ui'
import FilterSelect, { RECENCY_DATE } from '../components/Filters'
import FilterBar from '../components/FilterBar'
import { useUrlFacets } from '../lib/useUrlFacets'
import { usableImage, focusOf, objectFitOf } from '../lib/image'
import { cardBadges } from '../lib/facets'

const PAGE_SIZE = 40

const SORT_NEWS = [
  { id: 'newest', label: 'Newest first' },
  { id: 'relevant', label: 'Most significant' },
]

/**
 * A story's OWN photograph, or nothing.
 *
 * `own: true` is the whole point of this page. The reviewed class-image pool
 * that fills the home page's frames is a pool of photographs of TECHNOLOGIES,
 * not of stories, and the same picture legitimately appears against any story
 * about that technology. On a front page of fifteen mixed items that reads as
 * illustration. On a news archive it reads as stock filler, and a reader who
 * recognises the same photograph from the home page has been given a reason to
 * doubt everything else on the page.
 *
 * So: the outlet's own picture, or no picture. usableImage also drops anything
 * the vision pass marked `stock`, and logos, which are marks rather than
 * pictures of anything.
 */
const ownPhoto = item => usableImage(item, { own: true })

/** YYYY-MM-DD, for grouping. Undated stories fall into their own bucket. */
const dayKey = iso => (iso ? String(iso).slice(0, 10) : 'undated')

const DAY_LABEL = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
const dayLabel = key => (key === 'undated'
  ? 'Date unknown'
  : new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { ...DAY_LABEL, timeZone: 'UTC' }))

/**
 * One story.
 *
 * The picture is optional and the row is built so that its absence is not a
 * hole: no frame is rendered at all when there is nothing to put in it, and the
 * text simply takes the full measure. That is the layout consequence of "source
 * images or none" — a fixed grid of card frames would stand two thirds empty,
 * which looks broken in a way that a text row does not.
 */
function StoryRow({ item }) {
  const img = ownPhoto(item)
  const badges = cardBadges(item, 2)
  return (
    <article className="py-6">
      <Link to={`/item/${item.id}`} className="group flex gap-6 items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 mb-1.5 flex-wrap">
            <Kicker>News</Kicker>
            {badges.map(b => (
              <span key={b} className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                {b}
              </span>
            ))}
          </div>
          <h2 className="font-serif text-[1.3rem] sm:text-[1.45rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link break-words">
            {item.title}
          </h2>
          {item.summary && (
            <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-soft font-body line-clamp-2 max-w-prose">
              {item.summary}
            </p>
          )}
          <div className="mt-2.5 font-sans text-[12px] text-muted flex items-center gap-2 flex-wrap">
            {item.source && <span className="truncate max-w-[18rem]">{item.source}</span>}
            {item.source && <span className="w-px h-3 bg-rule" aria-hidden />}
            <span className="tabular-nums">{fmtDate(item.published_at)}</span>
          </div>
        </div>
        {img && (
          // self-start so the frame keeps its declared ratio instead of being
          // stretched to the row's height by the flex parent.
          <div className="hidden sm:block w-[13.5rem] shrink-0 self-start aspect-[16/9] overflow-hidden bg-canvas">
            <img
              src={img.url}
              alt=""
              loading="lazy"
              className="w-full h-full group-hover:scale-[1.02] transition-transform duration-500"
              style={{ objectFit: objectFitOf(img), objectPosition: focusOf(img) }}
            />
          </div>
        )}
      </Link>
    </article>
  )
}

/**
 * News and Press — the archive.
 *
 * Reverse chronological, paged by the database, forty to a page. Nothing here
 * is ever deleted upstream, so this is the whole record of what the index has
 * ever seen, and page 9 is as reachable as page 1.
 */
export default function Media() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [outlets, setOutlets] = useState([])

  const [facets, setFacets] = useUrlFacets()
  const [recency, setRecency] = useState(null)
  const [outlet, setOutlet] = useState(null)
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(0)

  useEffect(() => { getNewsOutlets().then(setOutlets) }, [])

  // The key keeps the effect from refiring on a new facet object that holds the
  // same selection, which would refetch on every render.
  const facetKey = JSON.stringify(facets)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await searchNews({
      facets: JSON.parse(facetKey), recency, outlet, sort, page, pageSize: PAGE_SIZE,
    })
    setRows(res.rows)
    setTotal(res.total)
    setLoading(false)
  }, [facetKey, recency, outlet, sort, page])

  useEffect(() => { let alive = true; load().catch(() => { if (alive) setLoading(false) }); return () => { alive = false } }, [load])

  // Any change to what is being asked for returns the reader to the first page;
  // otherwise a filter applied on page 7 lands them past the end of the result.
  useEffect(() => { setPage(0) }, [facetKey, recency, outlet, sort])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Rows are already in date order from the database; this only inserts the
  // headings between them.
  const days = useMemo(() => {
    const out = []
    for (const r of rows) {
      const k = dayKey(r.published_at)
      if (!out.length || out[out.length - 1].key !== k) out.push({ key: k, items: [r] })
      else out[out.length - 1].items.push(r)
    }
    return out
  }, [rows])

  const anyFacet = Boolean(facets.function?.length || facets.access?.length || facets.application?.length)

  return (
    <div className="page-wide py-6">
      <div className="flex items-end justify-between gap-4 flex-wrap border-b-2 border-ink pb-2.5">
        <h1 className="font-serif text-3xl sm:text-[2.5rem] leading-none font-semibold text-ink tracking-[-0.015em]">
          News and Press
        </h1>
        <p className="text-muted text-[13px] font-sans leading-relaxed">
          Worldwide neurotechnology coverage from press and media outlets. Updated daily.
        </p>
      </div>

      <div className="border-b border-rule mb-6">
        <FilterBar
          facets={facets}
          onChange={setFacets}
          sort={<FilterSelect label="Sort" value={sort} onChange={setSort} options={SORT_NEWS} required />}
          extras={[
            ...(outlets.length > 1
              ? [{ label: 'Outlet', value: outlet, onChange: setOutlet, options: outlets, allLabel: 'All outlets' }]
              : []),
            { label: 'Recency', value: recency, onChange: setRecency, options: RECENCY_DATE, allLabel: 'Any time' },
          ]}
        />
      </div>

      {!supabase ? (
        <EmptyState icon={Newspaper} title="Feed unavailable offline">Connect Supabase to see the archive.</EmptyState>
      ) : loading ? (
        <Loader label="Loading…" />
      ) : !rows.length ? (
        <EmptyState icon={Newspaper} title="Nothing here yet">
          {anyFacet ? 'No stories match these filters.' : 'Stories populate from the daily press-feed ingestion.'}
        </EmptyState>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4 h-9 mb-2 border-b border-rule">
            <span className="text-[13px] font-sans text-muted">
              {total.toLocaleString()} {total === 1 ? 'story' : 'stories'}
              {pages > 1 && <> · page {page + 1} of {pages.toLocaleString()}</>}
            </span>
            <span className="text-[13px] font-sans text-muted tabular-nums">
              {sort === 'newest' ? 'Newest first' : 'Most significant first'}
            </span>
          </div>

          {days.map(({ key, items }) => (
            <section key={key}>
              {/* The date heading is what makes a reverse-chronological archive
                  readable: without it a reader scanning for "last Tuesday" has
                  to open stories to find out where they are. */}
              <h2 className="sticky top-0 z-10 bg-paper/95 backdrop-blur-sm py-2 mt-4 border-b border-rule font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                {dayLabel(key)}
              </h2>
              <div className="divide-y divide-rule">
                {items.map(it => <StoryRow key={it.id} item={it} />)}
              </div>
            </section>
          ))}

          {pages > 1 && (
            <div className="flex items-center justify-between mt-8 pt-5 border-t border-rule">
              <button
                disabled={page === 0}
                onClick={() => { setPage(p => Math.max(0, p - 1)); window.scrollTo(0, 0) }}
                className="inline-flex items-center gap-1 text-[13px] font-sans text-ink disabled:text-muted/40 disabled:cursor-not-allowed hover:text-accent transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> Previous
              </button>
              <span className="text-[13px] font-sans text-muted">
                Page {page + 1} of {pages.toLocaleString()}
              </span>
              <button
                disabled={page + 1 >= pages}
                onClick={() => { setPage(p => p + 1); window.scrollTo(0, 0) }}
                className="inline-flex items-center gap-1 text-[13px] font-sans text-ink disabled:text-muted/40 disabled:cursor-not-allowed hover:text-accent transition-colors"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
