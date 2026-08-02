/**
 * Figure.jsx — the picture on every home page card.
 *
 * A card shows a photograph when the record has one. When it does not, it shows
 * a FIGURE built from that record's own fields: a trial's phase and enrollment,
 * a clearance's number and pathway, a round's amount against the other rounds
 * on the page, a paper's citation count. Nothing here is invented and nothing
 * is decorative: every mark on a figure is a value the record actually holds,
 * and a missing value is left out rather than filled in.
 *
 * The figures repeat facts the card already prints in text, so they are
 * aria-hidden. Screen readers get the card, not a redrawn copy of it.
 */
import { useState } from 'react'
import { facetsOfEntity, FUNCTION_LABEL } from '../lib/facets'
import { fmtUsd } from '../lib/fundingBoard'
import { usableImage, creditLine, fullCredit, needsCredit, focusOf, objectFitOf } from '../lib/image'
import { fmtDate } from './ui'

/** Month and day, for a thumbnail that has room for nothing longer. */
export const shortDate = iso =>
  (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '')

/** What a thumbnail says about an item that carries no number worth printing:
 *  what the record says it does, or failing that, when it ran. */
export function shortMark(item) {
  const fn = facetsOfEntity(item).function[0]
  return fn ? FUNCTION_LABEL[fn] : shortDate(item.publishedAt || item.published_at)
}

// Facet function → the figure's field colour. Muted enough to sit under a
// headline without competing with it.
const TINTS = {
  records: ['#EAF2FA', '#0B5FA6'],
  stimulates: ['#F3EEF9', '#6D4AA6'],
  decodes: ['#EAF4F1', '#0E7C66'],
  images: ['#ECF0F6', '#3A5687'],
  default: ['#EEF1F5', '#3D5A80'],
}
const tintOf = item => facetsOfEntity(item).function[0] || 'default'

// Three sizes: the lead, a card, and a thumbnail. A thumbnail keeps the datum
// and drops everything else, because at 96px anything more is unreadable.
const SIZE = {
  lg: { pad: 'p-6 sm:p-8', sub: 'text-[13px]', chrome: true },
  md: { pad: 'p-4', sub: 'text-[11.5px]', chrome: true },
  sm: { pad: 'p-2', sub: 'text-[9px]', chrome: false },
}

/**
 * A datum is set as large as it can be and still fit. A citation count gets the
 * full size; a journal title as long as "Advanced science (Weinheim, Baden-
 * Wurttemberg, Germany)" steps down and wraps instead of being cut off, because
 * a clipped venue name is worse than a small one.
 */
const DATUM_STEPS = {
  lg: ['text-[3.25rem] sm:text-[4rem]', 'text-[2.25rem]', 'text-[1.5rem]', 'text-[1.15rem]'],
  md: ['text-[1.9rem]', 'text-[1.4rem]', 'text-[1.05rem]', 'text-[0.85rem]'],
  sm: ['text-[1rem]', 'text-[0.9rem]', 'text-[0.75rem]', 'text-[0.7rem]'],
}
function datumClass(text, size) {
  const steps = DATUM_STEPS[size] || DATUM_STEPS.md
  const n = String(text ?? '').length
  return steps[n > 44 ? 3 : n > 26 ? 2 : n > 14 ? 1 : 0]
}

/** The shared plate every figure is drawn on: tinted field, label, datum, mark. */
function Plate({ tint = 'default', label, size = 'md', children, className = '' }) {
  const [bg, ink] = TINTS[tint] || TINTS.default
  const s = SIZE[size] || SIZE.md
  return (
    <div
      aria-hidden="true"
      className={`w-full h-full flex flex-col justify-between overflow-hidden ${s.pad} ${className}`}
      style={{ background: bg, color: ink }}
    >
      {s.chrome && label && (
        <span className="font-sans font-semibold uppercase tracking-[0.12em] text-[10px] opacity-70">
          {label}
        </span>
      )}
      <div className="min-h-0">{children}</div>
    </div>
  )
}

/** The large number, code or name a figure is read for. */
function Datum({ size = 'md', children, mono = false }) {
  return (
    <div className={`${datumClass(children, size)} ${mono ? 'font-mono' : 'font-serif'} leading-[1.02] font-semibold tabular-nums line-clamp-3 break-words`}>
      {children}
    </div>
  )
}

function Caption({ size = 'md', children }) {
  const s = SIZE[size] || SIZE.md
  if (!s.chrome || !children) return null
  return <div className={`${s.sub} font-sans mt-2 opacity-80 line-clamp-2`}>{children}</div>
}

// ── Clinical trial ──────────────────────────────────────────────────────────

/** Phases named in the record. "Phase 2/Phase 3" marks two; "Early Phase 1"
 *  marks one. A trial with no phase (device feasibility studies often have
 *  none) marks nothing rather than guessing at one. */
export function phasesOf(phase) {
  const nums = String(phase || '').match(/\d/g) || []
  return new Set(nums.map(Number).filter(n => n >= 1 && n <= 4))
}

const ROMAN = ['I', 'II', 'III', 'IV']

function PhaseLadder({ phase, ink }) {
  const active = phasesOf(phase)
  if (!active.size) return null
  return (
    <div className="flex gap-1 mt-3">
      {ROMAN.map((label, i) => (
        <span key={label} className="flex-1 flex flex-col gap-1">
          <span className="h-1.5 rounded-[1px]" style={{ background: ink, opacity: active.has(i + 1) ? 0.85 : 0.16 }} />
          <span className="font-mono text-[9px] leading-none" style={{ opacity: active.has(i + 1) ? 0.85 : 0.35 }}>
            {label}
          </span>
        </span>
      ))}
    </div>
  )
}

const prettyStatus = s => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())

export function TrialFigure({ trial, size = 'md' }) {
  const m = trial.metadata || {}
  const tint = tintOf(trial)
  const ink = (TINTS[tint] || TINTS.default)[1]
  return (
    <Plate tint={tint} size={size} label="Clinical trial">
      {m.enrollment ? <Datum size={size} mono>n={m.enrollment.toLocaleString()}</Datum>
        : <Datum size={size}>{m.phase || 'Trial'}</Datum>}
      <PhaseLadder phase={m.phase} ink={ink} />
      <Caption size={size}>
        {[m.enrollment ? 'participants' : null, prettyStatus(m.status), m.conditions?.[0]].filter(Boolean).join(' · ')}
      </Caption>
    </Plate>
  )
}

// ── FDA clearance ───────────────────────────────────────────────────────────

/** The submission number openFDA gave the record, from the column or out of the
 *  description line the backfill writes. Null when the record carries none. */
export function clearanceNumber(device) {
  const fields = [device.source_id, device.description, device.name]
  for (const f of fields) {
    const hit = String(f || '').match(/\b([KPD][N]?\d{5,6})\b/)
    if (hit) return hit[1]
  }
  return null
}

/** 510(k) / PMA / De Novo, read off the status the ingestion stamped. */
export function clearancePathway(device) {
  const s = `${device.status || ''} ${device.description || ''}`.toLowerCase()
  if (s.includes('de novo')) return 'De Novo'
  if (s.includes('pma')) return 'PMA'
  if (s.includes('510')) return '510(k)'
  return null
}

export function ClearanceFigure({ device, size = 'md' }) {
  const number = clearanceNumber(device)
  const pathway = clearancePathway(device)
  return (
    <Plate tint={tintOf(device)} size={size} label={pathway || 'FDA record'}>
      {number ? <Datum size={size} mono>{number}</Datum> : <Datum size={size}>{device.year || 'FDA'}</Datum>}
      <Caption size={size}>{device.year ? `Decision ${device.year}` : null}</Caption>
    </Plate>
  )
}

// ── Funding round ───────────────────────────────────────────────────────────

/** One round's amount, with a bar comparing it to the largest round on the
 *  page. The section's note says what the bars are measured against, so the
 *  card does not repeat it four times. */
export function FundingFigure({ round, max, size = 'md' }) {
  const pct = max > 0 && round.amountUsd > 0 ? Math.max((round.amountUsd / max) * 100, 3) : 0
  const [, ink] = TINTS.default
  return (
    <Plate tint="default" size={size} label="SEC Form D">
      <Datum size={size}>{fmtUsd(round.amountUsd) || 'Not available'}</Datum>
      {pct > 0 && (
        <div className="mt-3 h-2 w-full rounded-[1px]" style={{ background: `${ink}22` }}>
          <div className="h-full rounded-[1px]" style={{ width: `${pct}%`, background: ink, opacity: 0.85 }} />
        </div>
      )}
    </Plate>
  )
}

// ── Research ────────────────────────────────────────────────────────────────

// OpenAlex percentile → "Top N%" (field- and age-normalized citation impact).
export const topPct = p => `Top ${Math.max(1, Math.round((1 - p) * 100))}%`

const daysOld = iso => (iso ? (Date.now() - new Date(iso)) / 86400000 : Infinity)

/**
 * The percentile a figure is allowed to print, or null.
 *
 * A field percentile is noise until a paper has accrued some signal: a whole
 * same-age cohort sitting at zero citations makes every one of them look
 * exceptional. This is the gate scripts/refresh.js applies before the ranker
 * will use the same number, restated here so the page cannot show an impact
 * rank the pipeline itself does not trust.
 */
export function trustedPctile(paper) {
  const pctile = paper.pctile ?? paper.metadata?.pctile
  if (pctile == null) return null
  const cites = paper.citedBy ?? paper.metadata?.citationCount ?? 0
  const date = paper.publishedAt || paper.published_at
  return cites >= 3 || daysOld(date) > 60 ? pctile : null
}

/** Up to four of the record's own topic tags, as chips. */
function Topics({ topics = [] }) {
  const shown = topics.slice(0, 4)
  if (!shown.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-4">
      {shown.map(t => (
        <span key={t} className="font-sans text-[11px] px-2 py-0.5 rounded-sm border border-current/25 opacity-75">
          {t}
        </span>
      ))}
    </div>
  )
}

/**
 * A paper's figure leads with whatever the record can actually support: a
 * trusted field-normalized percentile, else a citation count, else the venue.
 * A paper with no citations yet shows its venue, not a zero.
 */
export function ResearchFigure({ paper, size = 'md' }) {
  const cites = paper.citedBy ?? paper.metadata?.citationCount ?? 0
  const pctile = trustedPctile(paper)
  // PubMed carries a journal's location in the title ("Advanced science
  // (Weinheim, Baden-Wurttemberg, Germany)"). The parenthetical is a
  // disambiguator for catalogues, not part of how the venue is read.
  const venue = String(paper.journal || paper.metadata?.journal || paper.source || '').replace(/\s*\([^)]*\)\s*$/, '')
  const date = paper.publishedAt || paper.published_at
  const label = pctile != null ? 'Citation impact' : cites > 0 ? 'Cited by' : 'Research'

  if (size === 'sm') {
    const short = pctile != null ? topPct(pctile) : cites > 0 ? cites.toLocaleString() : shortMark(paper)
    return <Plate tint={tintOf(paper)} size={size}><Datum size={size} mono={cites > 0 && pctile == null}>{short}</Datum></Plate>
  }
  return (
    <Plate tint={tintOf(paper)} size={size} label={label}>
      {pctile != null ? <Datum size={size}>{topPct(pctile)}</Datum>
        : cites > 0 ? <Datum size={size} mono>{cites.toLocaleString()}</Datum>
          : <Datum size={size}>{venue || 'Paper'}</Datum>}
      <Caption size={size}>
        {pctile != null || cites > 0
          ? [cites > 0 && pctile == null ? `citation${cites === 1 ? '' : 's'}` : null, venue].filter(Boolean).join(' · ')
          : fmtDate(date)}
      </Caption>
      {size === 'lg' && <Topics topics={paper.topics} />}
    </Plate>
  )
}

// ── News without a photograph ───────────────────────────────────────────────

/** The outlet, set as a plate. Nothing is asserted beyond who published it and
 *  when. Aggregator feeds hand over names like "| Reuters", so the punctuation
 *  they arrive with is trimmed off. */
export function SourceFigure({ item, size = 'md' }) {
  const outlet = String(item.source || '').replace(/^[\s|·,-]+/, '').trim()
  if (size === 'sm') {
    return (
      <Plate tint={tintOf(item)} size={size}>
        <Datum size={size} mono={!facetsOfEntity(item).function[0]}>{shortMark(item)}</Datum>
      </Plate>
    )
  }
  return (
    <Plate tint={tintOf(item)} size={size} label="Coverage">
      <Datum size={size}>{outlet || 'Report'}</Datum>
      <Caption size={size}>{fmtDate(item.published_at)}</Caption>
      {size === 'lg' && <Topics topics={item.topics} />}
    </Plate>
  )
}

// ── Photographs ─────────────────────────────────────────────────────────────

/**
 * A sourced photograph. A picture that fails to load, or that arrives smaller
 * than it claimed, falls back to the record's own figure rather than leaving a
 * broken box: scripts/verify-images.js will clear the dead URL on its next run.
 */
function Photo({ img, fallback, priority, className }) {
  const [broken, setBroken] = useState(false)
  const fit = objectFitOf(img)
  if (broken) return fallback
  return (
    <img
      src={img.url}
      alt=""
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
      onError={() => setBroken(true)}
      // A photograph that arrives smaller than it claimed is a placeholder or a
      // tracking pixel. A logo is small by nature and is contained, not cropped,
      // so the floor does not apply to it.
      onLoad={e => {
        const floor = img.kind === 'logo' ? 120 : 300
        if (e.target.naturalWidth && e.target.naturalWidth < floor) setBroken(true)
      }}
      // A logo is a mark on a field, not a photograph: cropping it to fill the
      // frame would cut the wordmark in half.
      // Filling crops around the subject rather than the middle of the frame.
      // A picture too tall or too wide to crop is shown whole instead.
      style={fit === 'cover' ? { objectPosition: focusOf(img) } : undefined}
      className={`w-full h-full ${fit === 'cover' ? 'object-cover'
        : `object-contain ${img.kind === 'logo' ? 'p-6' : 'p-2'} bg-paper`} ${className}`}
    />
  )
}

/** The data figure a record falls back to when it has no photograph. */
export function DataFigure({ item, size = 'md' }) {
  if (item.entry_type === 'trial') return <TrialFigure trial={item} size={size} />
  if (item.entry_type === 'paper' || item.entry_type === 'preprint') return <ResearchFigure paper={item} size={size} />
  return <SourceFigure item={item} size={size} />
}

/**
 * The picture for a feed story: its sourced photograph, or the figure its
 * entry type earns.
 *
 * `image` is the picture the page assigned this card — see assignImages in
 * lib/image.js, which hands a second card that landed on the same class
 * photograph a different one from the same pool. Passing it explicitly is what
 * keeps the credit line and the picture in agreement. Without it the figure
 * falls back to whatever the record itself carries.
 */
export function StoryFigure({ item, size = 'md', own = false, priority = false, image, className = '' }) {
  const img = image !== undefined ? image : usableImage(item, { own })
  const fallback = <DataFigure item={item} size={size} />
  return img ? <Photo img={img} fallback={fallback} priority={priority} className={className} /> : fallback
}

/**
 * The picture the lead may run.
 *
 * The lead is displayed eleven hundred pixels wide, so it prefers a photograph
 * OF the story and will otherwise take a labelled illustration only when that
 * illustration is large enough not to look soft at that size. Below the bar it
 * shows the story's data figure, which is sharp at any width.
 */
export function leadImage(item) {
  const own = usableImage(item, { own: true })
  if (own) return own
  const any = usableImage(item)
  return (any?.w || 0) >= 900 ? any : null
}

/** A photograph for any record that carries one, with a figure to fall back
 *  to. Used by the device, trial and company cards. */
export function EntityFigure({ entity, fallback, image, className = '' }) {
  const img = image !== undefined ? image : usableImage(entity)
  return img ? <Photo img={img} fallback={fallback} className={className} /> : fallback
}

/**
 * The attribution beside a picture.
 *
 * Every Wikimedia licence requires the author and the licence to be named
 * wherever the picture runs, and an illustration has to say that it is one.
 * This sits OUTSIDE the card's link, because the licence link is a link and
 * anchors do not nest.
 */
export function ImageCredit({ img, className = '' }) {
  if (!needsCredit(img)) return null
  const text = creditLine(img)
  if (!text) return null
  return (
    <p className={`mt-1 text-[11px] font-sans text-muted/80 truncate ${className}`} title={fullCredit(img)}>
      {img.sourceUrl
        ? <a href={img.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">{text}</a>
        : text}
    </p>
  )
}
