import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, ExternalLink, Building2, MapPin, Banknote, ChevronDown,
  Cpu, FlaskConical, FileText, Newspaper, Briefcase,
  ShieldCheck, Users, Stamp, AlertTriangle,
} from 'lucide-react'
import { getCompanyById, getCompanyRelated, getCompanyAnalytics, getOrgGraph, getPatentYears } from '../lib/data'
import { Loader, EmptyState, Kicker, InfoTip } from '../components/ui'
import { cardBadges } from '../lib/facets'
import { fmtMonthYear, unavailableLabel, STAGE_LABELS, stageEvidenceUrl } from '../lib/fundingBoard'
import { StarButton } from '../components/Watch'
import FoundingLine from '../components/FoundingLine'
import { foundingLine } from '../lib/founded-display'
import { siteUrl, siteLabel } from '../lib/website'
import { imageOf, objectFitOf, focusOf, isIllustration, isHiRes } from '../lib/image'
import { ImageCredit } from '../components/Figure'

const fmtMoney = m => (m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${m}M`)
const yearOf = d => (d ? String(d).slice(0, 4) : '')
const numYear = d => { const y = yearOf(d); return /^\d{4}$/.test(y) ? +y : null }
const fmtDate = ts => { if (!ts) return null; try { return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) } catch { return null } }
const monthYear = ts => { if (!ts) return null; try { return new Date(ts).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) } catch { return null } }

// Long linked lists (a big maker can have dozens) are capped for readability
// and to keep the page light; the section header still shows the true total.
const LIST_CAP = 15
// Every section arrives closed, so the page opens as a contents list: the
// headers and their counts are the whole record at a glance, and nothing is
// scrolled past on the way to the one section that was wanted. Shared rather
// than built per render so `openIds ?? EMPTY_OPEN` is a stable reference.
const EMPTY_OPEN = new Set()

const MoreNote = ({ n, of }) => (
  <p className="pt-3 text-[13px] font-sans text-muted">{n} more {of} linked. Full lists open at the source.</p>
)

/**
 * A collapsible section.
 *
 * The header is the whole control, and it carries the count, so a reader can
 * take the shape of a company off the headers alone without opening anything.
 * Every section arrives closed; the rail's links open one on the way to it.
 */
function Panel({ id, icon: Icon, title, count, kicker, note, open, onToggle, children }) {
  return (
    <section id={id} className="border-t border-rule scroll-mt-6">
      <h2>
        <button
          type="button" onClick={onToggle} aria-expanded={open} aria-controls={`${id}-body`}
          className="group w-full flex items-center gap-2.5 py-4 text-left"
        >
          <Icon className="w-[18px] h-[18px] text-accent shrink-0" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0">
            {/* The business layer's partition label. It rides above the title
                rather than beside it so it cannot be mistaken for the count. */}
            {kicker && (
              <span className="block text-[10px] font-sans font-semibold uppercase tracking-[0.1em] text-muted leading-none mb-1">
                {kicker}
              </span>
            )}
            <span className="font-serif text-[1.4rem] font-semibold text-ink tracking-[-0.01em] group-hover:text-accent transition-colors">{title}</span>
          </span>
          {count != null && (
            <span className="font-mono text-[12px] tabular-nums text-muted bg-canvas border border-rule rounded-full px-2 py-0.5 leading-none shrink-0">
              {count.toLocaleString()}
            </span>
          )}
          {note && <span className="text-[12px] font-sans text-muted whitespace-nowrap hidden sm:inline">{note}</span>}
          <ChevronDown
            aria-hidden
            className={`ml-auto w-4 h-4 shrink-0 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </h2>
      <div id={`${id}-body`} hidden={!open} className="pb-7">{children}</div>
    </section>
  )
}

/**
 * Per-section provenance line: where the section's facts come from and how fresh
 * they are. `via` is an optional plain-language note on how records were linked;
 * internal edge names (made_by, cleared_via, ...) are never shown to the reader.
 */
function Prov({ source, via, updated }) {
  const bits = []
  if (source) bits.push(`Source: ${source}`)
  if (via) bits.push(via)
  if (updated) bits.push(`updated ${fmtDate(updated)}`)
  if (!bits.length) return null
  return <p className="mt-4 text-[11.5px] font-sans text-muted/90">{bits.join(' · ')}</p>
}

/**
 * Confidence-graded provenance for a business record (EDGAR/USPTO = higher).
 *
 * The grade stays on the page, because it is the difference between a filing
 * and a compilation and a reader has to see it. The paragraph qualifying it
 * moves into the note, which is where a caveat belongs once the page has one
 * line to spare rather than four.
 */
function BizProv({ confidence, children }) {
  return (
    <p className="mt-3 text-[11.5px] font-sans text-muted/90 flex items-center gap-1.5">
      <span className={`font-semibold ${confidence === 'high' ? 'text-ink-soft' : 'text-muted'}`}>
        {confidence === 'high' ? 'Higher confidence' : 'Lower confidence'}
      </span>
      <InfoTip label="How this figure is sourced">{children}</InfoTip>
    </p>
  )
}

/** Shared shell for the compact record tables. */
function Table({ caption, head, children }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-[13px] font-sans border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.08em] text-muted/70 text-left border-b border-rule">
            {head.map(h => (
              <th key={h.label} scope="col"
                className={`py-1.5 pr-3 font-semibold ${h.align === 'right' ? 'text-right pr-0' : ''}`}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

const Tr = ({ children }) => <tr className="border-b border-rule-soft last:border-0 hover:bg-canvas/60 transition-colors">{children}</tr>
const Td = ({ children, className = '' }) => <td className={`py-2 pr-3 align-baseline ${className}`}>{children}</td>
/** A record title that opens its source. Titles carry the row, so they are the link. */
const TitleLink = ({ href, children }) => (
  href
    ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-ink hover:text-accent transition-colors">{children}</a>
    : <span className="text-ink">{children}</span>
)
const Num = ({ children }) => <span className="font-mono text-[12px] tabular-nums text-muted whitespace-nowrap">{children}</span>

/**
 * Every Form D behind the total, one row per filing.
 *
 * The total is a sum, so it has no single source document. Listing the filings
 * is the only way a reader can check it: the amounts here add up to the figure
 * above, and each accession number opens the filing it was read from. It is
 * folded away because it is a check on a number rather than the number itself.
 */
function FundingFilings({ rounds }) {
  const list = [...(rounds || [])].filter(r => r.sourceUrl).sort((a, b) => (a.date < b.date ? 1 : -1))
  if (!list.length) return null
  return (
    <details className="mt-5 group">
      <summary className="cursor-pointer list-none text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted hover:text-accent inline-flex items-center gap-1.5">
        <ChevronDown aria-hidden className="w-3.5 h-3.5 transition-transform group-open:rotate-180" />
        The {list.length} filings behind this total
      </summary>
      <div className="mt-3">
        <Table
          caption="SEC Form D filings this company's funding total was read from, newest first."
          head={[{ label: 'Filed' }, { label: 'Amount', align: 'right' }, { label: 'Filing' }]}
        >
          {list.map(r => (
            <tr key={r.accession || r.sourceUrl} className="border-b border-rule-soft last:border-0">
              <Td><Num>{fmtMonthYear(r.date)}</Num></Td>
              <Td className="text-right pr-0">
                <span className="font-mono text-[12px] tabular-nums text-ink whitespace-nowrap">
                  {r.amountUsd ? `$${r.amountUsd.toLocaleString()}` : 'Undisclosed'}
                </span>
              </Td>
              <Td>
                <a href={r.sourceUrl} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-accent hover:underline font-mono text-[11.5px]">
                  {r.accession || 'View on EDGAR'}
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              </Td>
            </tr>
          ))}
        </Table>
      </div>
    </details>
  )
}

// ── The timeline ────────────────────────────────────────────────────────────

const LANE_STYLE = {
  funding: { label: 'Funding', color: '#0B5FA6' },
  trials: { label: 'Trials started', color: '#0B5FA6' },
  fda: { label: 'FDA decisions', color: '#0B5FA6' },
  patents: { label: 'Patents granted', color: '#64748b' },
}

/**
 * What the company has actually done, and when, on one shared axis.
 *
 * This replaces two separate charts (capital per year, and regulatory and
 * patent activity per year) that shared an x axis in fact but not on the page,
 * so a reader comparing "when did the money arrive against when the trials
 * started" had to hold two pictures at once. Every input is already loaded for
 * the sections below; nothing new is fetched and nothing is inferred.
 *
 * Marks are positioned in percent rather than drawn in SVG so that a dot stays
 * a dot and a label stays 11px at every width. Where a lane carries a
 * magnitude (an amount raised, a count of grants) the dot is scaled by it;
 * where it does not, every mark is the same size, because sizing a trial by
 * anything would be inventing a number.
 */
function Timeline({ rounds, trials, regulatory, patentYears, foundedYear, devices }) {
  const lanes = useMemo(() => {
    const out = []
    /**
     * Every lane is collapsed to one mark per year.
     *
     * Marks are placed by year, so two records from the same year land on the
     * same pixel and the one drawn second hides the one drawn first. Six trials
     * across two years rendered as two dots, which is not a compressed reading
     * of the data, it is a wrong one. Summing first means a dot always says how
     * much happened that year, and it means the same thing in every lane.
     */
    /**
     * `describe` names a year's mark. `total` is what the lane label prints,
     * and it is NOT the number of marks: a lane of six dots can hold twenty
     * patents. Where a row already carries a count (patents arrive pre-grouped
     * by year) the total is the sum of the weights; where a row is one record
     * it is the number of rows; and for funding, whose weight is money, it is
     * the number of rounds.
     */
    const add = (id, rows, describe, total) => {
      const byYear = new Map()
      for (const { year, weight } of rows) {
        if (!year) continue
        byYear.set(year, (byYear.get(year) || 0) + weight)
      }
      if (!byYear.size) return
      const events = [...byYear.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([year, weight]) => ({ year, weight, title: describe(year, weight) }))
      out.push({ id, ...LANE_STYLE[id], events, total })
    }

    const rows_ = (rounds || []).map(r => ({ year: numYear(r.date), weight: r.amount || 0 }))
    add('funding', rows_, (y, w) => `${y}: ${fmtMoney(w)} raised`,
      rows_.filter(r => r.year).length)

    const trialRows = [...(trials?.active || []), ...(trials?.completed || [])]
      .map(t => ({ year: numYear(t.published_at), weight: 1 }))
    add('trials', trialRows, (y, n) => `${y}: ${n} trial${n === 1 ? '' : 's'} started`,
      trialRows.filter(r => r.year).length)

    // Devices carry a year but no finer date, so a cleared device and its
    // regulatory record land on the same tick. The record is the sourced one,
    // and the devices stand in only where no record is linked.
    let fda = (regulatory || []).map(r => ({ year: numYear(r.decision_date), weight: 1 }))
    if (!fda.some(e => e.year)) fda = (devices || []).map(d => ({ year: numYear(d.year), weight: 1 }))
    add('fda', fda, (y, n) => `${y}: ${n} FDA record${n === 1 ? '' : 's'}`,
      fda.filter(r => r.year).length)

    const patentRows = Object.entries(patentYears || {})
      .map(([y, n]) => ({ year: +y >= 1980 && +y <= 2100 ? +y : null, weight: n }))
    add('patents', patentRows, (y, n) => `${y}: ${n} patent${n === 1 ? '' : 's'} granted`,
      patentRows.reduce((s, r) => s + (r.year ? r.weight : 0), 0))

    return out
  }, [rounds, trials, regulatory, patentYears, devices])

  if (!lanes.length) return null

  const years = lanes.flatMap(l => l.events.map(e => e.year))
  if (foundedYear) years.push(foundedYear)
  let lo = Math.min(...years), hi = Math.max(...years)
  if (hi === lo) { lo -= 1; hi += 1 } // one event still needs an axis to sit on
  const at = y => ((y - lo) / (hi - lo)) * 100

  // Ticks a reader can actually read: the ends always, then whatever fits.
  const step = Math.max(1, Math.ceil((hi - lo) / 6))
  const ticks = []
  for (let y = lo; y <= hi; y += step) ticks.push(y)
  if (ticks[ticks.length - 1] !== hi) ticks.push(hi)

  const label = lanes.map(l => `${l.label}: ${l.total}`).join('. ')

  // Every mark, tick, and rule is placed by this one function. The founding
  // line was computed separately once and sat at the wrong year, because a
  // percentage of the lane track and a percentage of the whole figure are not
  // the same number. The inset keeps an end-of-range dot from hanging over the
  // edge of its track.
  const xOf = y => `${at(y) * 0.94 + 3}%`
  // The label column plus the flex gap: where every track begins.
  const TRACK_LEFT = 'calc(5.5rem + 0.75rem)'

  return (
    <figure className="mt-7 mb-2" role="img"
      aria-label={`Activity from ${lo} to ${hi}. ${label}. The same records are listed in the sections below.`}>
      <figcaption className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-3">
        Activity on record
      </figcaption>

      <div className="relative">
        {/* The founding year, drawn behind the lanes so it reads as context
            rather than as another event. It shares xOf with the dots, so it
            lands on the same year they do. */}
        {foundedYear && foundedYear >= lo && foundedYear <= hi && (
          <div className="absolute top-0 bottom-5 z-0 pointer-events-none"
            style={{ left: TRACK_LEFT, right: 0 }} aria-hidden>
            <div className="absolute top-0 bottom-0 w-px border-l border-dashed border-rule"
              style={{ left: xOf(foundedYear) }} />
          </div>
        )}

        {lanes.map(lane => {
          const max = Math.max(...lane.events.map(e => e.weight), 1)
          return (
            <div key={lane.id} className="relative z-10 flex items-center gap-3 h-8">
              <span className="w-[5.5rem] shrink-0 text-[11px] font-sans text-muted text-right leading-tight">
                {lane.label} <span className="tabular-nums text-ink-soft">{lane.total}</span>
              </span>
              <div className="relative flex-1 h-full">
                <div className="absolute inset-x-0 top-1/2 h-px bg-rule-soft" aria-hidden />
                {lane.events.map((e, i) => {
                  // Area scales with the magnitude, so a round twice the size
                  // reads as twice the mark rather than four times it.
                  const r = lane.events.length && max > 1
                    ? 3 + Math.sqrt(e.weight / max) * 4
                    : 4
                  return (
                    <span key={`${e.year}-${i}`} title={e.title}
                      className="absolute top-1/2 rounded-full ring-2 ring-paper"
                      style={{
                        left: xOf(e.year),
                        width: r * 2, height: r * 2,
                        marginLeft: -r, marginTop: -r,
                        background: lane.color,
                      }} />
                  )
                })}
              </div>
            </div>
          )
        })}

        <div className="flex items-center gap-3 mt-1">
          <span className="w-[5.5rem] shrink-0" aria-hidden />
          <div className="relative flex-1 h-4 border-t border-rule">
            {ticks.map(y => (
              <span key={y} className="absolute top-1 -translate-x-1/2 text-[10.5px] font-mono text-muted tabular-nums"
                style={{ left: xOf(y) }}>{`’${String(y).slice(2)}`}</span>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-6 text-[11px] font-sans text-muted leading-relaxed">
        One dot per year. Its size is how much that year holds: the amount raised, or the number of records.
        {foundedYear && <> The dashed line is {foundedYear}, the founding year on record.</>}
        {' '}Every record behind it is listed in the sections below.
      </p>
    </figure>
  )
}

// ── The at a glance rail ────────────────────────────────────────────────────

/**
 * The shape of the company in seven lines.
 *
 * The index page has always known a company's stage and its counts; the record
 * page made a reader scroll the whole dossier to recover them. Each figure
 * links to the section it came from and opens it on the way, so the summary is
 * a way into the page rather than a second copy of it. A zero is printed, not
 * hidden: "no devices" is an answer, and one line is the right amount of page
 * to spend on it.
 */
function Facts({ rows, className = '' }) {
  if (!rows.length) return null
  return (
    <dl className={`font-sans text-[13px] ${className}`}>
      {rows.map(r => (
        <div key={r.label} className="flex items-baseline justify-between gap-3 py-2 border-b border-rule-soft last:border-0">
          <dt className="text-muted whitespace-nowrap">{r.label}</dt>
          <dd className="text-right min-w-0">
            {r.onClick
              ? <button type="button" onClick={r.onClick}
                  className="font-medium text-ink hover:text-accent transition-colors tabular-nums">
                  {r.value}
                </button>
              : <span className={`font-medium tabular-nums ${r.dim ? 'text-muted' : 'text-ink'}`}>{r.value}</span>}
            {r.href && (
              <a href={r.href} target="_blank" rel="noopener noreferrer"
                className="ml-1.5 inline-flex text-accent align-baseline" title="Open the record behind this">
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {r.note && <div className="text-[11.5px] text-muted leading-tight">{r.note}</div>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * The sections with nothing in them, as one block.
 *
 * Each of these used to be a full section with a paragraph explaining the
 * absence, which on a typical company ran to most of the page. The explanation
 * is still here, in the note beside each line, because why a field is empty is
 * often the most useful thing on it. What is gone is the height.
 */
function NotOnRecord({ items }) {
  if (!items.length) return null
  return (
    <section className="border-t border-rule pt-5 mt-2">
      <h2 className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-1">
        Not on record
      </h2>
      <ul className="font-sans text-[13px]">
        {items.map(it => (
          <li key={it.label} className="flex items-baseline gap-2 py-1.5 border-b border-rule-soft last:border-0">
            <span className="text-ink-soft">{it.label}</span>
            <InfoTip label={`Why ${it.label.toLowerCase()} is empty`}>{it.why}</InfoTip>
            {it.action && <span className="ml-auto">{it.action}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function CompanyPage() {
  const { id } = useParams()
  const [company, setCompany] = useState(null)
  const [related, setRelated] = useState(null)
  const [graph, setGraph] = useState(null) // null = loading, then the getOrgGraph result
  const [analytics, setAnalytics] = useState(undefined) // undefined = loading, null = indexed/none
  const [patentYears, setPatentYears] = useState({})
  const [loading, setLoading] = useState(true)
  const [openIds, setOpenIds] = useState(null) // null until the data says what is short

  useEffect(() => {
    let alive = true
    setLoading(true); setRelated(null); setGraph(null); setAnalytics(undefined); setPatentYears({}); setOpenIds(null)
    getCompanyById(id).then(async c => {
      if (!alive) return
      setCompany(c); setLoading(false)
      if (c) {
        getOrgGraph(id).then(g => alive && setGraph(g))
        getCompanyRelated(c.name).then(r => alive && setRelated(r))
        getCompanyAnalytics(id).then(a => alive && setAnalytics(a))
        getPatentYears(c.name).then(p => alive && setPatentYears(p))
      }
    })
    return () => { alive = false }
  }, [id])

  const toggle = useCallback(sid => {
    setOpenIds(prev => {
      const next = new Set(prev || [])
      if (next.has(sid)) next.delete(sid); else next.add(sid)
      return next
    })
  }, [])

  // A rail figure opens its section and then goes to it. Opening without
  // scrolling leaves the reader where they were, wondering what the click did.
  //
  // The scroll waits for the commit rather than for the next frame. A frame
  // callback fires while React still has the section closed, and the re-render
  // that opens it lands mid-animation, so the section opened and the page never
  // moved.
  //
  // `behavior` is deliberately not passed. index.css sets scroll-behavior:
  // smooth on html, so the animation is the site's own setting, which is also
  // what honours a reader who has asked for reduced motion in it rather than
  // here.
  const [pendingScroll, setPendingScroll] = useState(null)
  const reveal = useCallback(sid => {
    setOpenIds(prev => new Set(prev || []).add(sid))
    setPendingScroll(sid)
  }, [])
  useEffect(() => {
    if (!pendingScroll) return
    document.getElementById(pendingScroll)?.scrollIntoView({ block: 'start' })
    setPendingScroll(null)
  }, [pendingScroll])

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-12"><Loader /></div>
  if (!company) return <div className="max-w-3xl mx-auto px-4 py-16"><EmptyState icon={Building2} title="Company not found">This company isn’t in the index.</EmptyState></div>

  const labels = cardBadges(company, 6)
  const pubs = analytics?.publications
  const careersUrl = `https://www.google.com/search?q=${encodeURIComponent(`${company.name} careers jobs`)}`
  const newsUrl = `https://news.google.com/search?q=${encodeURIComponent(company.name + ' neurotech')}`
  const ctgovUrl = `https://clinicaltrials.gov/search?spons=${encodeURIComponent(company.name)}`
  const maudeUrl = `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfMAUDE/TextSearch.cfm`
  const pubmedUrl = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(`"${company.name}"[Affiliation]`)}`
  // The graph sections (devices / trials / regulatory / people) come from the
  // relationships edge table. `graph` is null while loading.
  const g = graph
  const trials = g ? [...g.trials.active, ...g.trials.completed] : []
  const trialCount = trials.length
  const founders = Array.isArray(company.founders) ? company.founders.filter(Boolean) : []
  const patents = related?.patents || []
  const news = related?.news || []
  const pubItems = pubs?.items || []
  const rounds = company.fundingRounds || []
  // The web-researched overlay. Everything in it carries the URL it was read
  // from; see researchFor in data.js for why it sits beside the table.
  const research = company.research || null
  const rTotal = research?.funding?.totalUsd || null
  const rLatest = research?.funding || null
  // Only worth a second line when it says something the filing figure does not.
  const showReported = rTotal && Math.round(rTotal / 1e6) !== company.funding
  const stageLabel = company.furthest_stage ? STAGE_LABELS[company.furthest_stage] : null
  const stageUrl = stageEvidenceUrl(company.stage_evidence_type, company.stage_evidence_id)
  const founded = foundingLine(company)
  const img = imageOf(company)
  // Big enough to run at the full measure, or only big enough to be a mark.
  // The frame is 16:9 across max-w-prose, so anything under this is being
  // enlarged rather than displayed.
  const heroImage = isHiRes(img)
  const markImage = img && !heroImage ? img : null
  const loadingCounts = !g || !related || analytics === undefined

  // The counts the rail prints. They no longer decide what is open: every
  // section starts closed, so the page arrives as its own table of contents and
  // the reader picks what to read.
  const sizes = {
    devices: g?.devices.length ?? 0,
    regulatory: g?.regulatory.length ?? 0,
  }
  const open = openIds ?? EMPTY_OPEN
  const panel = sid => ({ id: sid, open: open.has(sid), onToggle: () => toggle(sid) })

  const factRows = [
    stageLabel && { label: 'Stage', value: stageLabel, href: stageUrl },
    { label: 'Devices', value: sizes.devices, dim: !sizes.devices, onClick: sizes.devices ? () => reveal('devices') : null },
    {
      label: 'Trials', value: trialCount, dim: !trialCount,
      note: g && g.trials.active.length > 0 ? `${g.trials.active.length} active` : null,
      onClick: trialCount ? () => reveal('trials') : null,
    },
    { label: 'FDA records', value: sizes.regulatory, dim: !sizes.regulatory, onClick: sizes.regulatory ? () => reveal('regulatory') : null },
    { label: 'Publications', value: pubs?.total ?? pubItems.length, dim: !pubItems.length, onClick: pubItems.length ? () => reveal('publications') : null },
    // patentCount is null when the count query did not answer. The rail then
    // shows what it can stand behind: the number of patents actually listed,
    // marked as a floor, rather than a total it does not have.
    related && {
      label: 'Patents',
      value: related.patentCount != null ? related.patentCount.toLocaleString()
        : patents.length ? `${patents.length}+` : 'None matched',
      dim: !(related.patentCount || patents.length),
      note: related.patentCount == null && patents.length ? 'at least this many' : null,
      onClick: patents.length ? () => reveal('patents') : null,
    },
    {
      label: 'Total raised',
      // The filing figure when there is one, otherwise the reported one. The
      // note says which, because "None on record" was previously printed for
      // companies that had plainly raised money, just not through a Form D.
      value: company.funding > 0
        ? fmtMoney(company.funding)
        : rTotal ? fmtMoney(Math.round(rTotal / 1e6))
        // No total either way, but a sourced round is still an answer to "has
        // this company raised money", and "None on record" was not.
        : rLatest?.latestUsd ? `${fmtMoney(Math.round(rLatest.latestUsd / 1e6))}+`
        : 'None on record',
      dim: !(company.funding > 0) && !rTotal && !rLatest?.latestUsd,
      note: company.funding > 0
        ? (company.latestRaise ? `latest ${fmtMoney(company.latestRaise)}${company.latestRaiseDate ? `, ${fmtMonthYear(company.latestRaiseDate)}` : ''}` : null)
        : rTotal ? 'reported, not in filings'
        : rLatest?.latestUsd ? 'latest round only, no total found'
        : null,
      onClick: company.funding > 0 || rounds.length || rTotal || rLatest?.latestUsd ? () => reveal('funding') : null,
    },
  ].filter(Boolean)

  // Sources feeding the whole page, for the page-level provenance footer.
  const pageSources = ['ClinicalTrials.gov', 'openFDA']
  if (pubItems.length) pageSources.unshift('PubMed')
  if (rounds.length) pageSources.push('SEC EDGAR')
  const pageUpdated = g ? [g.provenance.devices, g.provenance.trials, g.provenance.regulatory].filter(Boolean).sort()[0] : null

  const absent = []
  if (g && !g.devices.length) absent.push({
    label: 'Devices',
    why: 'No devices are linked to this organization yet. A device links here when its FDA maker name matches this organization.',
  })
  if (g && !g.regulatory.length) absent.push({
    label: 'FDA clearances and approvals',
    why: 'No FDA clearance or approval records are linked yet. Records reach this page through the devices this organization makes.',
  })
  if (g && !trialCount) absent.push({
    label: 'Clinical trials',
    why: 'No clinical trials are linked to this sponsor yet.',
    action: <a href={ctgovUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] text-accent hover:underline whitespace-nowrap">Search ClinicalTrials.gov</a>,
  })
  if (analytics !== undefined && !pubItems.length) absent.push({
    label: 'Publications',
    why: 'No official company publications identified on PubMed. Papers are matched by author affiliation, so a company publishing only through academic co-authors will not appear.',
    action: <a href={pubmedUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] text-accent hover:underline whitespace-nowrap">Search PubMed</a>,
  })
  if (g && !founders.length && !g.people.length) absent.push({
    label: 'People',
    why: 'No people are on record for this organization. A full leadership roster needs a disclosed-announcement source, which NeuroBase does not yet index. It never comes from LinkedIn.',
  })
  if (!(company.funding > 0 || rounds.length || rTotal || rLatest?.latestUsd)) absent.push({
    label: 'Funding',
    why: 'No disclosed funding on record. Totals are read from SEC Form D filings, so a company that has raised only outside the United States, or only from sources that do not file, has nothing here. Searches did not turn up a sourced figure either. No amount is estimated.',
  })
  if (related && !patents.length) absent.push({
    label: 'Patents',
    why: 'No patents matched to this assignee in the index. Patents are matched from USPTO by assignee name, so a company filing under a differently spelled entity will not match.',
  })
  absent.push({
    label: 'Mergers and acquisitions',
    why: 'No acquisition or merger events are recorded. There is no open structured feed for deals. Each would be modeled as an event tied to a primary announcement, corroborated by an SEC 8-K for public acquirers. Nothing is inferred.',
  })
  // MAUDE is a pointer at the FDA's own database, and it only means anything
  // for a maker whose devices are in it. Offering the search to a company with
  // no devices linked was offering a query with nothing to query.
  if (g && g.devices.length > 0) absent.push({
    label: 'Adverse-event reports (MAUDE)',
    why: 'MAUDE reports are self-reported and noisy. NeuroBase does not yet index them, and never presents them as an outcome or a safety judgment. Query the FDA database directly for this maker’s devices.',
    action: <a href={maudeUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] text-accent hover:underline whitespace-nowrap">Search FDA MAUDE</a>,
  })

  const railFacts = (
    <>
      <h2 className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-1 pb-2 border-b border-rule">
        At a glance
      </h2>
      <Facts rows={factRows} />
      {loadingCounts && <p className="mt-2 text-[11px] font-sans text-muted">Still counting linked records.</p>}
      <p className="mt-4 text-[11px] font-sans text-muted leading-relaxed">
        Devices, FDA records, and trials are assembled from typed relationships in the index, not name guesses. Patents and funding are business context and never feed a research ranking.
      </p>
    </>
  )

  return (
    <div className="w-full max-w-[1180px] mx-auto px-4 sm:px-6 py-10">
      <Link to="/companies" className="inline-flex items-center gap-1.5 text-[13px] font-sans text-muted hover:text-accent transition-colors mb-8">
        <ArrowLeft className="w-4 h-4" /> Back to Companies
      </Link>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-12 lg:items-start">
        <article className="min-w-0 max-w-prose">
          {/* Header — badges and the watch action share the top row; the name spans
              full width below so it never wraps into a thin column. */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-3 flex-wrap min-w-0">
              <Kicker>Company</Kicker>
              {labels.map(b => (
                <span key={b} className="text-[11px] font-sans font-semibold uppercase tracking-[0.08em] text-accent">{b}</span>
              ))}
            </div>
            <div className="shrink-0"><StarButton item={{ type: 'organizations', id: company.id, label: company.name, to: `/company/${company.id}` }} /></div>
          </div>
          {/* The company's mark, at the size it actually is. Capped at 56px so a
              slightly larger icon cannot grow the line, and never scaled UP:
              a 180px icon draws at 180px if the cap allows, and smaller icons
              draw smaller still rather than being stretched to match. */}
          <div className="flex items-center gap-3.5">
            {markImage && (
              <img src={markImage.url} alt="" aria-hidden loading="lazy"
                style={{ width: Math.min(56, markImage.w || 56), height: 'auto' }}
                className="shrink-0 rounded-sm border border-rule bg-paper object-contain" />
            )}
            <h1 className="font-serif text-3xl sm:text-[2.5rem] leading-[1.1] font-semibold text-ink tracking-[-0.015em]">{company.name}</h1>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-muted font-sans">
            {company.location && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{company.location}</span>}
            {/* The legacy `founded` column is deliberately not rendered. It carries
                no source, and five of the twelve values that can be checked against
                a filing disagree with it. FoundingLine shows a year only when one
                is sourced.

                The year is stated once, here. The full form used to run again
                below the timeline, which is where the source, its class, and any
                conflict were shown; those move into the note beside it, because
                the rule is that a year never appears without its source, not
                that it appears twice. */}
            {founded && <><span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <FoundingLine row={company} compact />
                <InfoTip label="Where this founding year comes from">
                  <FoundingLine row={company} />
                </InfoTip>
              </span>
            </>}
            {/* The stage the index page has always known. It is the single most
                useful fact about a device company and the dossier never said it. */}
            {stageLabel && <><span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1 text-ink-soft font-medium">
                <Stamp className="w-3.5 h-3.5" />
                {stageUrl
                  ? <a href={stageUrl} target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors">{stageLabel}</a>
                  : stageLabel}
              </span>
            </>}
            {company.funding > 0 && <><span aria-hidden>·</span><span className="inline-flex items-center gap-1 text-accent font-medium"><Banknote className="w-3.5 h-3.5" />{fmtMoney(company.funding)} raised</span></>}
            {siteUrl(company.website) && <><span aria-hidden>·</span>
              <a href={siteUrl(company.website)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-ink hover:text-accent transition-colors">{siteLabel(company.website)}<ExternalLink className="w-3 h-3" /></a>
            </>}
          </div>

          {/* A real, curated representative photo, in a declared frame like every
              other picture on the site. Populated by curation only; never
              auto-scraped (see migration 007).

              It goes through imageOf rather than reading image_url raw, which
              is what the rest of the site does and what this page was missing.
              Two things follow from it. objectFitOf shows a logo whole instead
              of cropping it, so a wordmark is no longer cut off mid-letter. And
              a class-subject picture gets its "Illustration" label and its
              credit, which is a licence condition, not a nicety.

              usableImage is deliberately NOT used here: it drops logos, which is
              right for a grid of cards and wrong on the company's own page,
              where its mark is the one place a logo says something. */}
          {/* The frame is only offered to a picture big enough to fill it.
              `siteIcon` fetches a site's apple-touch-icon, and says of itself
              "Small by nature, so it is a mark, not a photo" — 54 of the 61
              company pictures are under 400px and most are exactly 180x180.
              Rendering one the full width of the measure upscaled it about four
              times and showed it soft.

              So a mark is rendered as a mark, at its own size, beside the name.
              It is sharp, it says whose page this is, and it does not pretend to
              be a photograph. HI_RES is this project's existing bar for the lead
              slot, reused rather than reinvented. */}
          {img && heroImage && (
            <figure className="mt-6">
              <div className="aspect-[16/9] overflow-hidden rounded-sm border border-rule bg-canvas">
                <img src={img.url} alt={company.name} loading="lazy"
                  style={objectFitOf(img) === 'cover' ? { objectPosition: focusOf(img) } : undefined}
                  className={`w-full h-full ${objectFitOf(img) === 'contain' ? 'object-contain p-6' : 'object-cover'}`} />
              </div>
              {isIllustration(img) && (
                <figcaption className="mt-1 text-[11px] font-sans font-semibold uppercase tracking-[0.08em] text-muted">
                  Illustration
                </figcaption>
              )}
              <ImageCredit img={img} />
            </figure>
          )}

          {/* A company that has been acquired or has shut down is still a real
              record, and every figure below it is still true of the company it
              was. What changes is the tense, so it is said once at the top
              rather than left for a reader to infer from a stale trial. */}
          {research?.status && (
            <div className="mt-6 flex items-start gap-2.5 border-l-2 border-highlight bg-canvas/60 pl-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-highlight shrink-0 mt-0.5" strokeWidth={1.9} aria-hidden />
              <p className="text-[13.5px] font-sans text-ink-soft leading-relaxed">
                <span className="font-semibold text-ink">
                  {research.status.status === 'acquired' ? 'Acquired' : research.status.status === 'merged' ? 'Merged' : 'No longer operating'}
                </span>
                {research.status.acquirer ? ` by ${research.status.acquirer}` : ''}
                {research.status.eventDate ? `, ${fmtMonthYear(research.status.eventDate) || research.status.eventDate}` : ''}.
                {' '}
                <a href={research.status.sourceUrl} target="_blank" rel="noopener noreferrer"
                  className="text-accent hover:underline">source</a>
              </p>
            </div>
          )}

          {company.description && <p className="mt-6 text-[1.12rem] leading-[1.7] text-ink font-body">{company.description}</p>}

          {/* Below the large screens the rail has nowhere to sit, so the summary
              runs here instead, directly under the description. */}
          <div className="lg:hidden mt-7 p-4 border border-rule rounded-sm bg-canvas/50">
            {railFacts}
          </div>

          <Timeline
            rounds={rounds} trials={g?.trials} regulatory={g?.regulatory}
            patentYears={patentYears} devices={g?.devices}
            foundedYear={founded ? founded.year : null}
          />

          {!g && <div className="border-t border-rule pt-4 mt-6"><Loader label="Loading linked records…" /></div>}

          {/* People — leadership (founders on record) and affiliated researchers */}
          {g && (founders.length > 0 || g.people.length > 0) && (
            <Panel icon={Users} title="People" count={founders.length + g.people.length} {...panel('people')}>
              {founders.length > 0 && (
                <div className="mb-4">
                  <div className="text-[11px] font-sans font-semibold uppercase tracking-[0.09em] text-muted mb-1.5">Founders and leadership</div>
                  <ul className="font-sans text-[13px]">
                    {founders.map((f, i) => (
                      <li key={i} className="py-1.5 border-b border-rule-soft last:border-0 text-ink">{f}</li>
                    ))}
                  </ul>
                </div>
              )}
              {/* Leadership found by search, and researchers reached through the
                  graph, in two labelled groups. A researched name carries the
                  page it was read from, because that is the only thing standing
                  behind it. */}
              {[
                { key: 'lead', label: 'Leadership', rows: g.people.filter(p => p.fromResearch) },
                { key: 'aff', label: 'Affiliated researchers', rows: g.people.filter(p => !p.fromResearch) },
              ].map(grp => grp.rows.length > 0 && (
                <div key={grp.key} className="mb-4 last:mb-0">
                  <div className="text-[11px] font-sans font-semibold uppercase tracking-[0.09em] text-muted mb-1.5">{grp.label}</div>
                  <ul className="font-sans text-[13px]">
                    {grp.rows.map(p => (
                      <li key={p.id} className="py-1.5 border-b border-rule-soft last:border-0 flex items-baseline justify-between gap-3">
                        <span className="text-ink">{p.name}</span>
                        <span className="flex items-baseline gap-1.5 shrink-0">
                          {p.role && <span className="text-[12px] text-muted whitespace-nowrap">{p.role}</span>}
                          {p.sourceUrl && (
                            <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer"
                              className="text-accent" title="The page this was read from">
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {g.people.some(p => p.fromResearch) && (
                <Prov source="company announcements and press" via="found by search, each name links to its source" />
              )}
            </Panel>
          )}

          {/* Devices — made_by edge */}
          {g && g.devices.length > 0 && (
            <Panel icon={Cpu} title="Devices" count={g.devices.length} {...panel('devices')}>
              <Table caption={`Devices made by ${company.name}.`}
                head={[{ label: 'Device' }, { label: 'Status' }, { label: 'Year', align: 'right' }]}>
                {g.devices.slice(0, LIST_CAP).map(d => (
                  <Tr key={d.id}>
                    <Td><TitleLink href={d.url}>{d.name}</TitleLink></Td>
                    <Td><Num>{d.status || d.type || ''}</Num></Td>
                    <Td className="text-right pr-0"><Num>{d.year || ''}</Num></Td>
                  </Tr>
                ))}
              </Table>
              {g.devices.length > LIST_CAP && <MoreNote n={g.devices.length - LIST_CAP} of="devices" />}
              <Prov source="openFDA" updated={g.provenance.devices} />
            </Panel>
          )}

          {/* Regulatory — cleared_via edge on this org's devices */}
          {g && g.regulatory.length > 0 && (
            <Panel icon={ShieldCheck} title="Regulatory" count={g.regulatory.length} {...panel('regulatory')}>
              <Table caption={`FDA clearance and approval records linked to ${company.name}.`}
                head={[{ label: 'Pathway and number' }, { label: 'Device' }, { label: 'Decision', align: 'right' }]}>
                {g.regulatory.slice(0, LIST_CAP).map(r => (
                  <Tr key={r.id}>
                    <Td>
                      <TitleLink href={r.source_url}>
                        {r.pathway || 'FDA record'}{r.number ? ` ${r.number}` : ''}
                      </TitleLink>
                    </Td>
                    <Td><span className="text-muted text-[12px]">{r.device_name || ''}</span></Td>
                    <Td className="text-right pr-0"><Num>{yearOf(r.decision_date)}</Num></Td>
                  </Tr>
                ))}
              </Table>
              {g.regulatory.length > LIST_CAP && <MoreNote n={g.regulatory.length - LIST_CAP} of="records" />}
              <Prov source="openFDA" updated={g.provenance.regulatory} />
            </Panel>
          )}

          {/* Clinical trials — sponsored_by edge, active separated from completed */}
          {g && trialCount > 0 && (
            <Panel icon={FlaskConical} title="Clinical trials" count={trialCount} {...panel('trials')}>
              {['active', 'completed'].map(bucket => g.trials[bucket].length > 0 && (
                <div key={bucket} className="mb-5 last:mb-0">
                  <div className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-1.5">
                    {bucket === 'active' ? 'Active' : 'Completed and other'}
                  </div>
                  <Table caption={`${bucket === 'active' ? 'Active' : 'Completed and other'} trials sponsored by ${company.name}.`}
                    head={[{ label: 'Trial' }, { label: 'Phase' }, { label: 'Status' }, { label: 'Enrolled', align: 'right' }]}>
                    {g.trials[bucket].map(t => {
                      const m = t.metadata || {}
                      return (
                        <Tr key={t.id}>
                          <Td className="min-w-[16rem]">
                            <TitleLink href={t.url}>{t.title}</TitleLink>
                            {m.nctId && <div className="mt-0.5"><Num>{m.nctId}</Num></div>}
                          </Td>
                          <Td><Num>{m.phase || ''}</Num></Td>
                          <Td><Num>{m.status || ''}</Num></Td>
                          <Td className="text-right pr-0"><Num>{m.enrollment ? `n=${m.enrollment}` : ''}</Num></Td>
                        </Tr>
                      )
                    })}
                  </Table>
                </div>
              ))}
              <Prov source="ClinicalTrials.gov" updated={g.provenance.trials} />
            </Panel>
          )}

          {/* Publications */}
          {pubItems.length > 0 && (
            <Panel icon={FileText} title="Publications" count={pubs?.total || pubItems.length} {...panel('publications')}>
              <Table caption={`Papers with a ${company.name} author affiliation.`}
                head={[{ label: 'Title' }, { label: 'Journal' }, { label: 'Year', align: 'right' }]}>
                {pubItems.map(p => (
                  <Tr key={p.pmid}>
                    <Td className="min-w-[16rem]"><TitleLink href={p.url}>{p.title}</TitleLink></Td>
                    <Td><span className="text-muted text-[12px] italic">{p.journal || ''}</span></Td>
                    <Td className="text-right pr-0"><Num>{p.year || ''}</Num></Td>
                  </Tr>
                ))}
              </Table>
              <a href={pubmedUrl} target="_blank" rel="noopener noreferrer"
                className="inline-block pt-3 text-[13px] font-sans text-accent hover:underline">Search all on PubMed →</a>
              <Prov source="PubMed" via="matched by author affiliation" />
            </Panel>
          )}

          {/* Press / news */}
          {news.length > 0 && (
            <Panel icon={Newspaper} title="In the news" count={news.length} {...panel('news')}>
              <ul className="divide-y divide-rule-soft">
                {news.map(n => (
                  <li key={n.id} className="py-2">
                    <a href={n.url} target="_blank" rel="noopener noreferrer"
                      className="group block hover:text-accent transition-colors">
                      <span className="font-serif text-[1.02rem] text-ink leading-snug group-hover:text-accent">{n.title}</span>
                      <span className="block mt-0.5 text-[12px] font-sans text-muted">
                        {[n.source, monthYear(n.published_at)].filter(Boolean).join(' · ')}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
              <a href={newsUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-3 text-[13px] font-sans text-accent hover:underline">
                Latest press and news on Google News <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </Panel>
          )}

          {/* ── The business layer (Phase 10) ───────────────────────────────
              Funding and Patents used to sit inside a "Business and market
              context" wrapper. The wrapper was carrying a heading, a paragraph,
              and a nesting level to say something the rail now says once, so it
              read as a second copy of figures already on the page. What was
              genuinely only in there was the Form D filings table and the
              patent list, and those are the two sections below.

              The partition Phase 10 requires is kept, and it is per section
              rather than per wrapper: each carries the BUSINESS CONTEXT kicker
              and its own confidence grade, which is the part a reader has to
              see. Neither feeds any ranking, the feed, or the research facets. */}

          {/* Funding — SEC EDGAR Form D filings, read from the organizations
              table. Form D does not name a round, so the note carries the
              amount and the month rather than a label like "Series C" that no
              filing supports. */}
          {(company.funding > 0 || rounds.length > 0 || rTotal || rLatest?.latestUsd) && (
            <Panel icon={Banknote} title="Funding" kicker="Business context"
              note={company.latestRaise
                ? `Latest ${fmtMoney(company.latestRaise)}${company.latestRaiseDate ? ` · ${fmtMonthYear(company.latestRaiseDate)}` : ''}`
                : (company.funding > 0 ? `Latest ${(unavailableLabel({
                    status: company.status, unavailableReason: company.fundingUnavailableReason,
                  }).short)}` : null)}
              {...panel('funding')}>
              <div className="flex flex-wrap gap-x-10 gap-y-3">
                {/* The filing figure. Suppressed entirely when there is no
                    filing: printing "Undisclosed" beside a sourced reported
                    total reads as a contradiction, when all it means is that
                    this company never filed a Form D. */}
                {company.funding > 0 && (
                  <div>
                    <div className="font-serif text-3xl font-semibold text-ink">{fmtMoney(company.funding)}</div>
                    <div className="text-[12px] font-sans uppercase tracking-[0.08em] text-muted mt-0.5">Total in filings</div>
                  </div>
                )}
                {/* The reported total, beside the filing total rather than
                    instead of it. Form D covers private US capital only, so a
                    company that raised abroad or listed will legitimately show
                    a larger reported figure, and neither number is the other's
                    correction. Both link to what they were read from. */}
                {(showReported || (rTotal && !(company.funding > 0))) && (
                  <div>
                    <div className="font-serif text-3xl font-semibold text-ink-soft">{fmtMoney(Math.round(rTotal / 1e6))}</div>
                    <div className="text-[12px] font-sans uppercase tracking-[0.08em] text-muted mt-0.5 flex items-center gap-1.5">
                      Reported total
                      <a href={research.funding.totalSourceUrl} target="_blank" rel="noopener noreferrer"
                        className="text-accent normal-case" title="The page this was read from">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    {/* A figure held up only by an aggregator profile is not the
                        same claim as one from a press release, and the page has
                        to say which it is rather than let the size of the type
                        speak for both. */}
                    {research.funding.totalConfidence === 'low' && (
                      <div className="text-[11px] font-sans text-muted mt-1 normal-case">From a compilation, not a filing or a release</div>
                    )}
                  </div>
                )}
                {rounds.length > 0 && (
                  <div>
                    <div className="font-serif text-3xl font-semibold text-ink">{rounds.length}</div>
                    <div className="text-[12px] font-sans uppercase tracking-[0.08em] text-muted mt-0.5">Rounds on record</div>
                  </div>
                )}
              </div>

              {/* The most recent round, where the filings do not have it. */}
              {rLatest?.latestUsd && !company.latestRaise && (
                <p className="mt-4 text-[13.5px] font-sans text-ink-soft">
                  Latest round: <span className="font-medium">{fmtMoney(Math.round(rLatest.latestUsd / 1e6))}</span>
                  {rLatest.latestRound ? `, ${rLatest.latestRound}` : ''}
                  {rLatest.latestDate ? `, ${fmtMonthYear(rLatest.latestDate)}` : ''}
                  {' '}
                  <a href={rLatest.latestSourceUrl} target="_blank" rel="noopener noreferrer"
                    className="text-accent hover:underline">source</a>
                </p>
              )}
              {/* Only when a reported figure is actually on the page. Research
                  often yields a note and no usable number, and labelling that
                  "reported figures found" points at nothing. */}
              {(showReported || (rTotal && !(company.funding > 0)) || (rLatest?.latestUsd && !company.latestRaise)) && (
                <p className="mt-2 text-[11.5px] font-sans text-muted/90 flex items-center gap-1.5">
                  <span className="font-semibold text-muted">Reported figures found by search</span>
                  <InfoTip label="How the reported figures were sourced">
                    Found by web search and recorded only with a source link. A figure needs either two independent sources that agree or one primary source, which is an SEC filing, the company&apos;s own release, or a regulator.
                    {research.funding.currencyNote ? ` ${research.funding.currencyNote}.` : ''}
                    {research.funding.note ? ` ${research.funding.note}` : ''}
                  </InfoTip>
                </p>
              )}
              <FundingFilings rounds={rounds} />
              {/* Grades the FILING figure, so it is meaningless where there is
                  no filing. The reported figure carries its own note below. */}
              {company.funding > 0 && (
              <BizProv confidence={company.fundingSource === 'sec' ? 'high' : 'low'}>
                {company.fundingSource === 'sec'
                  ? 'SEC EDGAR Form D filings. Private capital only, so a figure for a company that has since listed or been acquired excludes what it raised afterwards. Undisclosed amounts are shown as undisclosed. None are estimated. This never affects any research ranking, the feed, or the research facets.'
                  : 'Not traceable to an SEC filing. Lower confidence, and no amount is estimated. This never affects any research ranking, the feed, or the research facets.'}
              </BizProv>
              )}
              {/* The stored URL is the most recent filing, not the source of the
                  total, which is a sum across all of them. It is only worth
                  showing when the filing list itself is unavailable. */}
              {company.fundingSourceUrl && !rounds.some(r => r.sourceUrl) && (
                <p className="text-[12px] font-sans text-muted mt-1">
                  <a href={company.fundingSourceUrl} target="_blank" rel="noreferrer"
                    className="text-accent hover:underline">Most recent filing on record</a>
                </p>
              )}
            </Panel>
          )}

          {/* Patents — USPTO, matched by assignee name */}
          {patents.length > 0 && (
            <Panel icon={Stamp} title="Patents" kicker="Business context"
              count={related.patentCount ?? undefined} {...panel('patents')}>
              <Table caption={`Patents assigned to ${company.name}, most recent first.`}
                head={[{ label: 'Title' }, { label: 'Granted', align: 'right' }]}>
                {patents.map(p => (
                  <Tr key={p.patent_number}>
                    <Td className="min-w-[18rem]"><TitleLink href={p.url}>{p.title}</TitleLink></Td>
                    <Td className="text-right pr-0"><Num>{yearOf(p.grant_date)}</Num></Td>
                  </Tr>
                ))}
              </Table>
              {related.patentCount != null && related.patentCount > patents.length && (
                <MoreNote n={related.patentCount - patents.length} of="patents" />
              )}
              <BizProv confidence="high">
                USPTO, matched to this assignee by name. Not linked to specific devices unless the mapping is confident. This never affects any research ranking, the feed, or the research facets.
              </BizProv>
            </Panel>
          )}

          {/* Jobs — the company's own careers page, and nothing scraped.
              This is a pointer rather than a list, so it is short and always
              open: there is no count to fold away, and folding it would hide
              the only thing in it. */}
          <Panel icon={Briefcase} title="Jobs" {...panel('jobs')}>
            <p className="text-[13.5px] text-muted font-body leading-relaxed max-w-prose">
              Open roles are listed on the company’s own careers page. NeuroBase does not scrape individual postings, and does not use LinkedIn or any source that prohibits it. It links you to the source instead.
            </p>
            <div className="flex flex-wrap gap-3 mt-3.5">
              <a href={careersUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] font-sans px-3.5 py-1.5 rounded-full border border-rule text-ink-soft hover:border-ink hover:text-ink transition-colors">
                Careers and open roles <ExternalLink className="w-3.5 h-3.5" />
              </a>
              {siteUrl(company.website) && (
                <a href={siteUrl(company.website)} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[13px] font-sans px-3.5 py-1.5 rounded-full border border-rule text-ink-soft hover:border-ink hover:text-ink transition-colors">
                  Company site <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </Panel>

          <NotOnRecord items={absent} />

          {/* Page-level provenance: what fed this dossier and how fresh it is. */}
          <footer className="border-t-2 border-ink mt-10 pt-4 text-[12px] font-sans text-muted leading-relaxed">
            <span className="font-semibold text-ink-soft">Sources: </span>{pageSources.join(', ')}.
            {pageUpdated && <> Oldest linked record updated {fmtDate(pageUpdated)}.</>}
          </footer>
        </article>

        {/* The rail. It holds the summary and the caveat that used to run as a
            paragraph inside every section, and it stays with the reader down a
            page that is still several screens long for a company like this. */}
        <aside className="hidden lg:block sticky top-6 self-start">
          {railFacts}
          <div className="mt-5 pt-4 border-t border-rule flex flex-col gap-2 text-[12.5px] font-sans">
            <a href={ctgovUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-accent hover:underline">
              ClinicalTrials.gov <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
            <a href={pubmedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-accent hover:underline">
              PubMed <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
            <a href={newsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-accent hover:underline">
              Google News <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
          </div>
        </aside>
      </div>
    </div>
  )
}
