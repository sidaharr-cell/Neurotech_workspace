import { useState, useEffect, useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Newspaper } from 'lucide-react'
import { getNewsFeed, recencyCutoffISO, searchTrials, getRecentClearances, getRecentFundingRounds } from '../lib/data'
import { supabase } from '../lib/supabase'
import { Loader, EmptyState, Kicker, Byline, RuleHeading, InfoTip, fmtDate, typeWord } from './ui'
import FilterSelect, { RECENCY_DATE, FEED_TYPE, SORT_SIGNIF } from './Filters'
import FilterBar from './FilterBar'
import { useUrlFacets, facetSearch } from '../lib/useUrlFacets'
import { StoryFigure, ImageCredit, TrialFigure, ClearanceFigure, FundingFigure, ResearchFigure, clearanceNumber, topPct } from './Figure'
import { SLOTS, composeStories, shownKeys, pickNotable, byNewest } from '../lib/homepage'
import { assignImages, leadPicture } from '../lib/image'
import { entityMatchesFacets, countFacets, cardBadges } from '../lib/facets'
import { fmtUsd, fmtMonthYear } from '../lib/fundingBoard'
import notable from '../data/notable.json'

const bylineOf = item => ({
  type: typeWord(item.entry_type),
  source: item.source,
  date: fmtDate(item.published_at),
  cites: item.metadata?.citationCount ?? 0,
})
const prettyStatus = s => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())

/**
 * A row of cards divided by hairlines, in the manner of the reference journals.
 *
 * The rules are drawn per cell rather than by the grid, because a grid gap
 * filled with colour leaves a coloured block wherever the last row is short,
 * and a section that under-fills is a thing that happens here.
 *
 * So every cell carries its own left rule and its own leading indent, and the
 * grid is then pulled left by exactly that much (a 1px rule plus 20px of pad)
 * inside a clip, and widened to match. Column one's rule and indent fall off
 * the left edge and are clipped, which puts its text at x=0, flush with the
 * section heading above it — an indent there would misalign every headline in
 * the leftmost column against the rest of the page. Each row's first cell sits
 * at x=0, so the one shift handles them all however many rows there are.
 */
const CELL_INDENT = 21   // px: the 1px rule plus 20px (pl-5) of padding

function RuledGrid({ cols, children }) {
  return (
    <div className="overflow-hidden">
      <div
        className={`grid ${cols} gap-y-8`}
        style={{ marginLeft: `-${CELL_INDENT}px`, width: `calc(100% + ${CELL_INDENT}px)` }}
      >
        {children}
      </div>
    </div>
  )
}

function RuledCell({ children }) {
  return <div className="border-l border-rule pl-5 pr-5 h-full">{children}</div>
}

// ── Stories ─────────────────────────────────────────────────────────────────

/**
 * The lead: a panel of type beside a photograph, sized to be read across the
 * room. The text sits on ink rather than over the picture, because the pictures
 * here arrive from twenty different sources at twenty different exposures, and
 * a headline laid over them is legible in about half of those cases.
 *
 * The kicker is set light rather than through the shared Kicker class, whose
 * editorial blue is a link colour chosen against white and vanishes on ink.
 */
function LeadCard({ item, image }) {
  const img = leadPicture(item, image)
  return (
    // The lead stretches to whatever height the rail beside it comes out at,
    // so the row has no hole under the lead on a day when the rail's headlines
    // run long. The min-height is the floor for the other direction: a rail of
    // four short headlines must not shrink the lead to a thumbnail.
    <div className="group flex flex-col flex-1">
      <Link to={`/item/${item.id}`} className="flex flex-col flex-1">
        <div className="grid sm:grid-cols-5 flex-1 sm:min-h-[26rem]">
          <div className="sm:col-span-3 order-1 sm:order-2 relative bg-canvas min-h-[14rem] overflow-hidden">
            <div className="absolute inset-0">
              <StoryFigure item={item} size="lg" image={img} priority className="group-hover:scale-[1.02] transition-transform duration-500" />
            </div>
          </div>
          <div className="sm:col-span-2 order-2 sm:order-1 bg-ink text-paper p-6 sm:p-7 flex flex-col justify-center">
            {/* The facet badges the lead has always carried. DeviceClassLabels
                sets them in the editorial blue, which is a link colour chosen
                against white and is unreadable on ink, so they are rendered
                here from the same cardBadges call in the panel's own palette. */}
            <div className="flex items-center gap-3 flex-wrap mb-2.5">
              <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-paper/60">
                {typeWord(item.entry_type)}
              </span>
              {cardBadges(item, 2).map(b => (
                <span key={b} className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-paper/40">
                  {b}
                </span>
              ))}
            </div>
            {/* break-words because the panel is about 340px and the words are
                not. "Neuromodulation" set at 1.75rem serif is wider than the
                column it is in, and an unbreakable word simply runs out of the
                panel and is clipped by it. The old lead ran across two thirds
                of the page and never met this. */}
            <h2 className="font-serif text-[1.55rem] sm:text-[1.75rem] leading-[1.12] font-semibold tracking-[-0.015em] line-clamp-6 break-words">
              {item.title}
            </h2>
            {item.summary && (
              <p className="mt-3 text-[0.9rem] leading-relaxed text-paper/70 font-body line-clamp-3">{item.summary}</p>
            )}
            <div className="mt-4 font-sans text-[12px] text-paper/55">
              {item.source && <div className="truncate mb-0.5">{item.source}</div>}
              <div className="flex items-center gap-2">
                <span className="font-semibold text-paper/80">{typeWord(item.entry_type)}</span>
                <span className="w-px h-3 bg-paper/25" aria-hidden />
                <span className="tabular-nums">{fmtDate(item.published_at)}</span>
              </div>
            </div>
          </div>
        </div>
      </Link>
      <ImageCredit img={img} />
    </div>
  )
}

/**
 * The rail beside the lead: headlines, and nothing but.
 *
 * It carries no thumbnail on purpose. The rail is about 300px wide, and a
 * picture and its gap take a third of that from a headline that already runs to
 * ninety characters. The photographs it would have shown are handed on by
 * assignImages to the cards below, which run them at a size that reads.
 */
function RailRow({ item }) {
  return (
    <Link to={`/item/${item.id}`} className="group block py-3">
      <div className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-[0.1em] text-accent">
        {typeWord(item.entry_type)}
      </div>
      <h3 className="font-serif text-[1.02rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-3 break-words">
        {item.title}
      </h3>
      <div className="mt-1.5 font-sans text-[12px] text-muted tabular-nums">{fmtDate(item.published_at)}</div>
    </Link>
  )
}

/**
 * A story card. `size` picks the picture's shape and the headline's weight; the
 * byline is pushed to the bottom of the cell, so every card in a row lands its
 * metadata on one line however long the headline above it ran.
 */
function StoryCard({ item, image, size = 'md' }) {
  const big = size === 'lg'
  return (
    <div className="group flex flex-col h-full">
      <Link to={`/item/${item.id}`} className="flex flex-col flex-1">
        <div className={`${big ? 'aspect-[4/3]' : 'aspect-[16/9]'} overflow-hidden bg-canvas mb-3`}>
          <StoryFigure item={item} image={image} className="group-hover:scale-[1.02] transition-transform duration-500" />
        </div>
        <div className="mb-1"><Kicker>{typeWord(item.entry_type)}</Kicker></div>
        <h3 className={`font-serif ${big ? 'text-[1.2rem]' : 'text-[1.02rem]'} leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-4 break-words`}>
          {item.title}
        </h3>
        {big && item.summary && (
          <p className="mt-1.5 text-[0.85rem] leading-relaxed text-ink-soft font-body line-clamp-2">{item.summary}</p>
        )}
        <div className="mt-auto pt-3"><Byline {...bylineOf(item)} /></div>
      </Link>
      <ImageCredit img={image} />
    </div>
  )
}

// ── Record rails ────────────────────────────────────────────────────────────

/**
 * A record entry: its figure, small, beside the text.
 *
 * These four sections used to be rows of 4:3 picture cards, which asked every
 * record for a photograph that mostly does not exist — no photograph of an
 * individual 510(k) submission is ever going to — and filled the gap with a
 * tinted plate blown up to card size. Beside a real photograph, that plate read
 * as a picture that had failed to load.
 *
 * So the figure shrinks to a 96px thumbnail and the text leads. The figure
 * still carries the one number the record is read for (enrollment, submission
 * number, round size, citation percentile) and, being drawn from the record's
 * own fields, it needs no attribution line under it, which is what makes rows
 * this tight possible. Photographs stay with the stories above.
 */
function RecordRow({ to, external, figure, kicker, aside, title, meta }) {
  const inner = (
    <>
      <div className="w-24 shrink-0 self-start aspect-[4/3] overflow-hidden bg-canvas">{figure}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Kicker>{kicker}</Kicker>
          {aside && <span className="font-sans text-[11px] text-muted">{aside}</span>}
        </div>
        <h3 className="font-serif text-[1.02rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-2 break-words">
          {title}
        </h3>
        <div className="mt-1 font-sans text-[12px] text-muted line-clamp-1">{meta}</div>
      </div>
    </>
  )
  const cls = 'group flex gap-4 py-3.5 items-start'
  return external
    ? <a href={to} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>
    : <Link to={to} className={cls}>{inner}</Link>
}

/** A record section: the rule, the heading, and its rows. Two sit side by side,
 *  which is what lets six entries cost less height than four cards did. */
function Rail({ title, note, tip, to, linkLabel, children }) {
  return (
    <section>
      <RuleHeading title={title} note={note} tip={tip} to={to} linkLabel={linkLabel} />
      <div className="divide-rule">{children}</div>
    </section>
  )
}

/**
 * What the "Top N%" on a notable row actually measures.
 *
 * The rail's note names a percentile without saying what it is a percentile
 * of, which is the part that decides whether a reader believes it: the number
 * is a comparison against one field and one year, not a raw citation count.
 * The thresholds restated here are the ones syncNotable applies in
 * scripts/refresh.js (NOTABLE_PCTILE_MIN, NOTABLE_WINDOW_DAYS, impactTrusted).
 */
function NotableTip() {
  return (
    <InfoTip label="How citation impact is measured">
      <p>
        Citation counts are not comparable on their own. Some fields cite far more than others,
        and an older paper has had longer to collect any. OpenAlex corrects for both by ranking
        each paper against the papers published in its own field the same year. Top 1% means it
        is cited more often than 99% of them.
      </p>
      <p className="mt-2">
        This section holds papers from the past 90 days that rank in the top 10% of their field
        and year. A new paper waits until it has three citations or turns 60 days old, because in
        the first weeks almost nothing has been cited and one citation is enough to reach the top.
      </p>
      <p className="mt-2">
        Citation data comes from{' '}
        <a
          href="https://developers.openalex.org/api-entities/works/work-object"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          OpenAlex
        </a>
        , which publishes this ranking as citation_normalized_percentile.
      </p>
    </InfoTip>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function MagazineFeed() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [trials, setTrials] = useState([])
  const [clearances, setClearances] = useState([])
  const [rounds, setRounds] = useState([])
  // In the URL, not in component state, so the selection survives the trip into
  // a topic page — the rails below and the masthead's topic menu hang it on
  // their links. It also makes a narrowed front page shareable, which is what
  // the topic pages already got from this hook.
  const [facets, setFacets] = useUrlFacets()
  const [recency, setRecency] = useState(null)
  const [type, setType] = useState(null)
  const [sort, setSort] = useState('relevant')
  const carry = facetSearch(useLocation().search)

  useEffect(() => {
    let alive = true
    // Fetch a wide set so photograph-bearing stories (which rank below papers)
    // are available for the visual slots; the composition caps what is shown.
    getNewsFeed({ limit: 120 }).then(d => { if (alive) { setItems(d); setLoading(false) } })
    return () => { alive = false }
  }, [])

  // The sections below the feed answer the same facet and recency filters. The
  // key keeps the effect from refiring on a new object with the same selection.
  const facetKey = JSON.stringify(facets)
  const anyFacet = Boolean(facets.function.length || facets.access.length || facets.application.length)

  useEffect(() => {
    let alive = true
    const f = JSON.parse(facetKey)
    Promise.all([
      searchTrials({ facets: f, recency, sort: 'relevant', pageSize: SLOTS.trials }),
      getRecentClearances({ facets: f, recency, limit: SLOTS.clearances }),
      // Rounds carry no facet columns, so a facet selection has nothing to test
      // them against; the section stands down rather than answer the wrong
      // question. Recency it can answer, from the filing date.
      anyFacet ? Promise.resolve([]) : getRecentFundingRounds({ sinceISO: recencyCutoffISO(recency), limit: SLOTS.funding }),
    ]).then(([t, c, r]) => {
      if (!alive) return
      setTrials(t.rows || [])
      setClearances(c || [])
      setRounds(r || [])
    })
    return () => { alive = false }
  }, [facetKey, recency, anyFacet])

  // Everything recency and type allow, before any facet is applied. The facet
  // counts come off this, so each number is how many of the stories on THIS page
  // the value holds — the feed filters in memory, so it can be exact about the
  // other controls in a way the server-side pages cannot.
  const candidates = useMemo(() => {
    const cutoff = recencyCutoffISO(recency)
    const isResearch = i => i.entry_type === 'paper' || i.entry_type === 'preprint'
    return items.filter(i =>
      (!cutoff || (i.published_at && i.published_at >= cutoff)) &&
      (!type || (type === 'research' ? isResearch(i) : i.entry_type === 'news'))
    )
  }, [items, recency, type])

  const facetCts = useMemo(() => countFacets(candidates, facets), [candidates, facets])

  const shown = useMemo(() => {
    const out = candidates.filter(i => entityMatchesFacets(i, facets))
    return sort === 'newest' ? [...out].sort(byNewest) : out
  }, [candidates, facets, sort])

  const { lead, sidebar, featured, latest } = useMemo(() => composeStories(shown, sort), [shown, sort])

  // Notable research is a standing rail rather than a filtered result, so it
  // only drops the papers the feed above has already run.
  const notablePapers = useMemo(
    () => pickNotable(notable, shownKeys(lead, sidebar, featured, latest)),
    [lead, sidebar, featured, latest],
  )

  // Type narrows the page to research or to news. The sections that are neither
  // stand down for as long as it is set.
  const showSections = !type
  const maxRound = Math.max(...rounds.map(r => r.amountUsd || 0), 0)

  // Every story card's picture, decided centrally: the record's own photograph
  // where it has one, and otherwise the best unused photograph in the reviewed
  // pool for what the story is about. A class photograph belongs to a
  // technology rather than to a record, so eight brain-computer interface
  // stories would otherwise run the same conference photograph eight times; the
  // first card keeps it and the rest are given a different one.
  //
  // Only the story cards are in this list. The rail is not, because it shows no
  // pictures, and neither are the record sections: an item assigned a
  // photograph it never renders takes that photograph out of the pool for a
  // card that would have shown it.
  const images = useMemo(
    () => assignImages([lead, ...featured, ...latest]),
    [lead, featured, latest],
  )
  // Null, not undefined. A card reads undefined as "work it out yourself" and
  // falls back to the picture it carries — which is the very picture the
  // assignment withheld, so the page ran the same photograph six times.
  const pictureOf = it => images.get(it?.id) ?? null

  return (
    // page-wide: the index measure, defined once in index.css. See the note
    // there for why it is 1320 and not the window.
    <div className="page-wide py-6">
      {/* Masthead: what this page is, on one line, over a heavy rule. */}
      <div className="flex items-end justify-between gap-4 flex-wrap border-b-2 border-ink pb-2.5">
        {/* 2.5rem is SectionHeading's h1, which is what every topic page sets
            its title at. This is the same rank of thing and is set to match. */}
        <h1 className="font-serif text-3xl sm:text-[2.5rem] leading-none font-semibold text-ink tracking-[-0.015em]">
          Top Stories
        </h1>
        <p className="text-muted text-[13px] font-sans leading-relaxed">
          The most significant neurotechnology research, devices, and coverage. Updated daily.
        </p>
      </div>

      <div className="border-b border-rule mb-8">
        <FilterBar
          facets={facets}
          onChange={setFacets}
          counts={facetCts}
          extras={[
            { label: 'Type', value: type, onChange: setType, options: FEED_TYPE, allLabel: 'All types' },
            { label: 'Recency', value: recency, onChange: setRecency, options: RECENCY_DATE, allLabel: 'Any time' },
          ]}
          sort={<FilterSelect label="Sort" value={sort} onChange={setSort} options={SORT_SIGNIF} required />}
        />
      </div>

      {!supabase ? (
        <EmptyState icon={Newspaper} title="Feed unavailable offline">Connect Supabase to see the live feed.</EmptyState>
      ) : loading ? (
        <Loader label="Loading…" />
      ) : !lead ? (
        <EmptyState icon={Newspaper} title="Nothing here yet">
          {anyFacet ? 'No items match these filters right now.' : 'The feed populates after the daily refresh.'}
        </EmptyState>
      ) : (
        <>
          {/* Lead plus the rail of more stories */}
          <div className="grid lg:grid-cols-12 gap-8 lg:gap-10">
            <div className="lg:col-span-8 flex flex-col"><LeadCard item={lead} image={pictureOf(lead)} /></div>
            {sidebar.length > 0 && (
              <aside className="lg:col-span-4 lg:border-l lg:border-rule lg:pl-8">
                <RuleHeading title="More stories" />
                <div className="divide-rule">
                  {sidebar.map((it, i) => <RailRow key={it.id || i} item={it} />)}
                </div>
              </aside>
            )}
          </div>

          {featured.length > 0 && (
            <section className="mt-10">
              <RuleHeading title="Featured" />
              <RuledGrid cols="sm:grid-cols-2 lg:grid-cols-4">
                {featured.map((it, i) => (
                  <RuledCell key={it.id || i}><StoryCard item={it} image={pictureOf(it)} size="lg" /></RuledCell>
                ))}
              </RuledGrid>
            </section>
          )}

          {latest.length > 0 && (
            <section className="mt-10">
              <RuleHeading title="Latest" />
              <RuledGrid cols="grid-cols-2 lg:grid-cols-5">
                {latest.map((it, i) => (
                  <RuledCell key={it.id || i}><StoryCard item={it} image={pictureOf(it)} /></RuledCell>
                ))}
              </RuledGrid>
            </section>
          )}

          {/*
            The record sections, two to a row, in a fixed reading order:

              Notable research | In the clinic
              Funding          | FDA decisions

            The grid fills row by row, so this is the source order, and it is
            the order a reader gets only while all four sections have entries.
            A section that comes back empty renders nothing and the ones after
            it slide up into its place. That is the existing behaviour of every
            section on this page, and scripts/verify-homepage.js is what says
            whether any of them is short.
          */}
          {showSections && (
            <div className="grid lg:grid-cols-2 gap-x-10 gap-y-10 mt-12">
              {notablePapers.length > 0 && (
                <Rail title="Notable research" note="Highest field-normalized citation impact, past 90 days" tip={<NotableTip />} to={`/research${carry}`} linkLabel="All research">
                  {notablePapers.map((p, i) => (
                    <RecordRow
                      key={p.doi || p.pmid || i}
                      to={p.pmid ? `/paper/${p.pmid}` : p.url}
                      external={!p.pmid}
                      figure={<ResearchFigure paper={p} size="sm" />}
                      // Every rail restates its chip's datum in the grey line
                      // below the headline, because the chip is aria-hidden and
                      // the fact has to be readable without it. This row is the
                      // only one that had put its copy in the kicker instead,
                      // which set "Top 1%" twice within an inch of itself in
                      // two near-identical styles.
                      kicker="Research"
                      aside={p.citedBy > 0 ? `${p.citedBy} citation${p.citedBy === 1 ? '' : 's'}` : null}
                      title={p.title}
                      meta={[topPct(p.pctile), p.journal, p.publishedAt ? fmtDate(p.publishedAt) : null].filter(Boolean).join(' · ')}
                    />
                  ))}
                </Rail>
              )}

              {trials.length > 0 && (
                <Rail title="In the clinic" note="Registered on ClinicalTrials.gov" to={`/trials${carry}`} linkLabel="All trials">
                  {trials.map(t => {
                    const m = t.metadata || {}
                    return (
                      <RecordRow
                        key={t.id}
                        to={`/item/${t.id}`}
                        figure={<TrialFigure trial={t} size="sm" />}
                        kicker={m.phase || 'Clinical trial'}
                        aside={m.status ? prettyStatus(m.status) : null}
                        title={t.title}
                        meta={[m.sponsor, m.enrollment ? `n=${m.enrollment.toLocaleString()}` : null, m.nctId].filter(Boolean).join(' · ')}
                      />
                    )
                  })}
                </Rail>
              )}

              {rounds.length > 0 && (
                <Rail title="Funding" note="Private capital from SEC Form D filings" to={`/companies${carry}`} linkLabel="All companies">
                  {rounds.map(r => (
                    <RecordRow
                      key={r.id}
                      to={r.href}
                      figure={<FundingFigure round={r} max={maxRound} size="sm" />}
                      kicker="Funding round"
                      title={r.name}
                      meta={[fmtUsd(r.amountUsd), fmtMonthYear(r.roundDate)].filter(Boolean).join(' · ')}
                    />
                  ))}
                </Rail>
              )}

              {clearances.length > 0 && (
                <Rail title="FDA decisions" note="From the openFDA device database" to={`/devices${carry}`} linkLabel="All devices">
                  {clearances.map(d => (
                    <RecordRow
                      key={d.id}
                      to={`/device/${d.id}`}
                      figure={<ClearanceFigure device={d} size="sm" />}
                      kicker={d.status || 'FDA record'}
                      title={d.name}
                      meta={[d.manufacturer, clearanceNumber(d), d.year].filter(Boolean).join(' · ')}
                    />
                  ))}
                </Rail>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
