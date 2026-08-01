import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Newspaper } from 'lucide-react'
import { getNewsFeed, recencyCutoffISO, searchTrials, getRecentClearances, getRecentFundingRounds } from '../lib/data'
import { supabase } from '../lib/supabase'
import { SectionHeading, Loader, EmptyState, Kicker, Meta, DeviceClassLabels, fmtDate, typeWord } from './ui'
import FilterSelect, { RECENCY_DATE, FEED_TYPE, SORT_SIGNIF } from './Filters'
import FacetSidebar, { NO_FACETS } from './FacetSidebar'
import { StoryFigure, EntityFigure, ImageCredit, TrialFigure, ClearanceFigure, FundingFigure, ResearchFigure, clearanceNumber, topPct } from './Figure'
import { SLOTS, composeStories, shownKeys, pickNotable, byNewest } from '../lib/homepage'
import { usableImage, duplicateImageIds } from '../lib/image'
import { entityMatchesFacets } from '../lib/facets'
import { fmtUsd, fmtMonthYear } from '../lib/fundingBoard'
import notable from '../data/notable.json'

const metaOf = item => ({ source: item.source, date: fmtDate(item.published_at), cites: item.metadata?.citationCount ?? 0 })
const prettyStatus = s => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())

// ── Stories ─────────────────────────────────────────────────────────────────

function LeadCard({ item }) {
  // The lead only runs a photograph OF the story, so the credit has to be read
  // through the same rule: a card must never credit a picture it is not showing.
  const img = usableImage(item, { own: true })
  return (
    <div className="group">
      <Link to={`/item/${item.id}`} className="block">
      <div className="aspect-[16/9] overflow-hidden bg-canvas mb-4">
        <StoryFigure item={item} size="lg" own priority className="group-hover:scale-[1.02] transition-transform duration-500" />
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
      <ImageCredit img={img} />
    </div>
  )
}

/** The rail beside the lead. The picture is a thumbnail so the rail stays a
 *  list of headlines rather than a second grid of cards. */
function SidebarItem({ item, noPhoto }) {
  return (
    <Link to={`/item/${item.id}`} className="group flex gap-3 py-4">
      <div className="w-20 sm:w-24 shrink-0 aspect-[4/3] overflow-hidden bg-canvas">
        <StoryFigure item={item} size="sm" noPhoto={noPhoto} />
      </div>
      <div className="min-w-0">
        <div className="mb-1"><Kicker>{typeWord(item.entry_type)}</Kicker></div>
        <h3 className="font-serif text-[1.05rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-3">{item.title}</h3>
        <div className="mt-1.5"><Meta {...metaOf(item)} /></div>
      </div>
    </Link>
  )
}

function FeaturedCard({ item, noPhoto }) {
  return (
    <div className="group">
      <Link to={`/item/${item.id}`} className="block">
      <div className="aspect-[4/3] overflow-hidden bg-canvas mb-3">
        <StoryFigure item={item} noPhoto={noPhoto} className="group-hover:scale-[1.02] transition-transform duration-500" />
      </div>
      <div className="mb-1.5"><Kicker>{typeWord(item.entry_type)}</Kicker></div>
      <h3 className="font-serif text-[1.3rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-3">{item.title}</h3>
      {item.summary && <p className="mt-1.5 text-[0.9rem] leading-relaxed text-ink-soft font-body line-clamp-2">{item.summary}</p>}
      <div className="mt-2"><Meta {...metaOf(item)} /></div>
      </Link>
      {!noPhoto && <ImageCredit img={usableImage(item)} />}
    </div>
  )
}

function LatestCard({ item, noPhoto }) {
  return (
    <div className="group">
      <Link to={`/item/${item.id}`} className="block">
        <div className="aspect-[16/9] overflow-hidden bg-canvas mb-2.5">
          <StoryFigure item={item} noPhoto={noPhoto} className="group-hover:scale-[1.02] transition-transform duration-500" />
        </div>
        <div className="mb-1"><Kicker>{typeWord(item.entry_type)}</Kicker></div>
        <h3 className="font-serif text-[1.1rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-3">{item.title}</h3>
        <div className="mt-1.5"><Meta {...metaOf(item)} /></div>
      </Link>
      {!noPhoto && <ImageCredit img={usableImage(item)} />}
    </div>
  )
}

// ── Sections for the other entity types ─────────────────────────────────────

/** A section rule with its own heading, a one-line note on what the section
 *  holds, and a link to the full view. */
function RailHeading({ kicker, note, to, linkLabel }) {
  return (
    <div className="flex items-baseline justify-between gap-4 flex-wrap mb-3 pb-1.5 border-b-2 border-ink">
      <Kicker>{kicker}</Kicker>
      <div className="flex items-baseline gap-3">
        {note && <span className="text-[12px] font-sans text-muted">{note}</span>}
        {to && <Link to={to} className="text-[12px] font-sans text-accent hover:underline">{linkLabel}</Link>}
      </div>
    </div>
  )
}

function TrialCard({ trial, noPhoto }) {
  const m = trial.metadata || {}
  return (
    <div className="group">
      <Link to={`/item/${trial.id}`} className="block">
      <div className="aspect-[4/3] overflow-hidden bg-canvas mb-2.5">
        <EntityFigure entity={trial} noPhoto={noPhoto} fallback={<TrialFigure trial={trial} />} />
      </div>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <Kicker>{m.phase || 'Clinical trial'}</Kicker>
        {m.status && <span className="text-[11px] font-sans text-muted">{prettyStatus(m.status)}</span>}
      </div>
      <h3 className="font-serif text-[1.1rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-3">{trial.title}</h3>
      <div className="mt-1.5 text-[13px] font-sans text-muted line-clamp-2">
        {[m.sponsor, m.enrollment ? `n=${m.enrollment.toLocaleString()}` : null, m.nctId].filter(Boolean).join(' · ')}
      </div>
      </Link>
      {!noPhoto && <ImageCredit img={usableImage(trial)} />}
    </div>
  )
}

function ClearanceCard({ device, noPhoto }) {
  return (
    <div className="group">
      <Link to={`/device/${device.id}`} className="block">
      <div className="aspect-[4/3] overflow-hidden bg-canvas mb-2.5">
        <EntityFigure entity={device} noPhoto={noPhoto} fallback={<ClearanceFigure device={device} />} />
      </div>
      <div className="mb-1"><Kicker>{device.status || 'FDA record'}</Kicker></div>
      <h3 className="font-serif text-[1.1rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-3">{device.name}</h3>
      <div className="mt-1.5 text-[13px] font-sans text-muted line-clamp-2">
        {[device.manufacturer, clearanceNumber(device), device.year].filter(Boolean).join(' · ')}
      </div>
      </Link>
      {!noPhoto && <ImageCredit img={usableImage(device)} />}
    </div>
  )
}

function FundingCard({ round, max }) {
  return (
    <div className="group">
      <Link to={round.href} className="block">
        <div className="aspect-[4/3] overflow-hidden bg-canvas mb-2.5"><FundingFigure round={round} max={max} /></div>
        <div className="mb-1"><Kicker>Funding round</Kicker></div>
        <h3 className="font-serif text-[1.1rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-2">{round.name}</h3>
      </Link>
      <div className="mt-1.5 text-[13px] font-sans text-muted line-clamp-2">
        {[fmtUsd(round.amountUsd), fmtMonthYear(round.roundDate)].filter(Boolean).join(' · ')}
        {round.sourceUrl && (
          <>
            {' · '}
            <a href={round.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Filing</a>
          </>
        )}
      </div>
    </div>
  )
}

function NotableCard({ paper }) {
  const inner = (
    <>
      <div className="aspect-[4/3] overflow-hidden bg-canvas mb-2.5"><ResearchFigure paper={paper} /></div>
      <div className="flex items-center gap-2 mb-1">
        <Kicker>{topPct(paper.pctile)}</Kicker>
        {paper.citedBy > 0 && <span className="text-[11px] font-sans text-muted">{paper.citedBy} citation{paper.citedBy === 1 ? '' : 's'}</span>}
      </div>
      <h3 className="font-serif text-[1.1rem] leading-snug font-semibold text-ink tracking-[-0.01em] headline-link line-clamp-3">{paper.title}</h3>
      <div className="mt-1.5 text-[13px] font-sans text-muted line-clamp-2">
        {[paper.journal, paper.publishedAt ? fmtDate(paper.publishedAt) : null].filter(Boolean).join(' · ')}
      </div>
    </>
  )
  return paper.pmid
    ? <Link to={`/paper/${paper.pmid}`} className="group block">{inner}</Link>
    : <a href={paper.url} target="_blank" rel="noopener noreferrer" className="group block">{inner}</a>
}

/** Every entity section is the same four-across grid. */
function Rail({ kicker, note, to, linkLabel, children }) {
  return (
    <section className="mt-12">
      <RailHeading kicker={kicker} note={note} to={to} linkLabel={linkLabel} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-8">{children}</div>
    </section>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function MagazineFeed() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [trials, setTrials] = useState([])
  const [clearances, setClearances] = useState([])
  const [rounds, setRounds] = useState([])
  const [facets, setFacets] = useState(NO_FACETS)
  const [recency, setRecency] = useState(null)
  const [type, setType] = useState(null)
  const [sort, setSort] = useState('relevant')

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

  const shown = useMemo(() => {
    const cutoff = recencyCutoffISO(recency)
    const isResearch = i => i.entry_type === 'paper' || i.entry_type === 'preprint'
    let out = items.filter(i =>
      entityMatchesFacets(i, facets) &&
      (!cutoff || (i.published_at && i.published_at >= cutoff)) &&
      (!type || (type === 'research' ? isResearch(i) : i.entry_type === 'news'))
    )
    if (sort === 'newest') out = [...out].sort(byNewest)
    return out
  }, [items, facets, recency, type, sort])

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

  // A class photograph belongs to a technology, not to a record, so eight
  // brain-computer interface stories would otherwise run the same conference
  // photograph eight times. The first card on the page keeps it; the rest fall
  // back to their data figure, which is the more informative picture anyway.
  const dupes = useMemo(
    () => duplicateImageIds([lead, ...sidebar, ...featured, ...latest, ...trials, ...clearances]),
    [lead, sidebar, featured, latest, trials, clearances],
  )

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
          <div className="flex items-center justify-end h-11 mb-6 border-b border-rule">
            <FilterSelect label="Sort" value={sort} onChange={setSort} options={SORT_SIGNIF} required />
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
              <div className="grid lg:grid-cols-3 gap-8 lg:gap-10">
                <div className="lg:col-span-2"><LeadCard item={lead} /></div>
                {sidebar.length > 0 && (
                  <div className="lg:border-l lg:border-rule lg:pl-8">
                    <div className="border-b-2 border-ink pb-1.5 mb-1">
                      <Kicker>More stories</Kicker>
                    </div>
                    <div className="divide-rule">
                      {sidebar.map((it, i) => <SidebarItem key={it.id || i} item={it} noPhoto={dupes.has(it.id)} />)}
                    </div>
                  </div>
                )}
              </div>

              {featured.length > 0 && (
                <div className="mt-12 pt-8 border-t-2 border-ink">
                  <div className="grid sm:grid-cols-3 gap-8">
                    {featured.map((it, i) => <FeaturedCard key={it.id || i} item={it} noPhoto={dupes.has(it.id)} />)}
                  </div>
                </div>
              )}

              {latest.length > 0 && (
                <Rail kicker="Latest">
                  {latest.map((it, i) => <LatestCard key={it.id || i} item={it} noPhoto={dupes.has(it.id)} />)}
                </Rail>
              )}

              {showSections && trials.length > 0 && (
                <Rail kicker="In the clinic" note="Registered on ClinicalTrials.gov" to="/trials" linkLabel="All trials">
                  {trials.map(t => <TrialCard key={t.id} trial={t} noPhoto={dupes.has(t.id)} />)}
                </Rail>
              )}

              {showSections && clearances.length > 0 && (
                <Rail kicker="FDA decisions" note="From the openFDA device database" to="/devices" linkLabel="All devices">
                  {clearances.map(d => <ClearanceCard key={d.id} device={d} noPhoto={dupes.has(d.id)} />)}
                </Rail>
              )}

              {showSections && rounds.length > 0 && (
                <Rail kicker="Funding" note="Private capital from SEC Form D filings. Bars compare the rounds shown." to="/companies" linkLabel="All companies">
                  {rounds.map(r => <FundingCard key={r.id} round={r} max={maxRound} />)}
                </Rail>
              )}

              {showSections && notablePapers.length > 0 && (
                <Rail kicker="Notable research" note="Highest field-normalized citation impact, past 90 days" to="/research" linkLabel="All research">
                  {notablePapers.map((p, i) => <NotableCard key={p.doi || p.pmid || i} paper={p} />)}
                </Rail>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
