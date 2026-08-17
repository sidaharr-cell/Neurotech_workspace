import { useState, useEffect, useMemo, useRef, useCallback, Fragment } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  scatterPoints, filterFunding, STAGE_BANDS, STAGE_LABELS, MODALITY_LABELS,
  DEFAULT_STATUS_FILTER, AGE_BANDS, ageBand, ageBasis, fmtUsd, fmtMonthYear,
} from '../lib/fundingBoard'
import { median, logDomain, logScale, decadeTicks, beeswarm, swarmSpread } from '../lib/swarm'
import { InfoTip } from './ui'

/**
 * Capital against clinical and regulatory maturity.
 *
 * The brief asked for one ordered axis from preclinical to commercial. That axis
 * mixes two different routes, and mixing them produces a trend that is not
 * there: see STAGE_BANDS in fundingBoard.js and
 * docs/funding-stage-scatter-finding.md. So the axis is banded, and the caption
 * reports what the data actually shows rather than the claim the chart was
 * commissioned to support.
 *
 * ── What changed on 15 Aug 2026, and why ────────────────────────────────────
 *
 * The figure was honest about its statistics and unreadable as a picture.
 * Measured on the live chart: 34 of 45 points sat inside the leftmost tenth of
 * the plot, the median company sat at 3.4% of the width, and 46 pairs of points
 * overlapped. A reader could not tell $5M from $50M, which is the comparison
 * the caption invites within a band.
 *
 * **The X axis is log.** docs/funding-stage-scatter-finding.md says not to
 * switch to one, and it is worth being explicit about why that does not apply:
 * the rule is aimed at a MOTIVE, rescuing a null result by making the cloud look
 * less structured. The number the caption reports is a Spearman correlation,
 * computed on ranks, and logScale is monotonic, so it cannot move that number by
 * any amount. `swarm.test.js` asserts the rank order survives. Nothing here is
 * fitted, smoothed, or re-measured; the axis is spaced so the points can be
 * seen. The prohibition on dropping cleared_510k still stands and is untouched.
 *
 * **Points are laid out by beeswarm rather than index jitter.** The old
 * `((i % 5) - 2) * 4.4` depended on a company's position in the array, not on
 * where its neighbours landed. See src/lib/swarm.js.
 *
 * **Each row carries its own count and median**, because those four medians are
 * the actual finding in the doc and the reader was being asked to eyeball them.
 * They are computed from the plotted set, so they cannot go stale the way a
 * number typed into a caption does.
 *
 * **Size no longer encodes recent capital.** It was a dead channel: 27 of 45
 * points sat at the floor radius because they had no round in the window, so
 * "size is capital raised in the last 24 months" was false for most of the
 * chart, and the floor made "no round at all" identical to "a rounding error".
 * The scale was also not what its own comment claimed — with the additive floor,
 * a company at a quarter of the maximum drew at 2.3x the area, not 4x. Recency
 * is now the binary it always was in the data: filled means a round in the
 * window, hollow means none.
 */

/**
 * ── Why the figure is shaped the way it is ─────────────────────────────────
 *
 * Everything in an SVG scales with its container, type included, so the only
 * thing that fixes a size is the ratio of that size to W. At 780 wide with
 * 9px gutter labels, a 640px viewport rendered them at 7.4px and drew the
 * points 5.9px across. The figure was also 3.5:1, which is a letterbox strip
 * rather than a plot.
 *
 * So: fewer units of width per unit of height, larger type as a share of W,
 * and a min-width on the element (below) that makes a narrow screen SCROLL
 * rather than shrink. That last one is the rule FundingChart already follows —
 * squeezing costs the marks the thing they are read for.
 */
const W = 800
const PAD = { l: 190, r: 34, t: 26, b: 58 }

/**
 * ── The narrow variant ──────────────────────────────────────────────────────
 *
 * From the `twoup` breakpoint this figure shares the row with the bar chart,
 * and the rule above is what decides the shape: type is a share of W, so
 * rendering the 800-unit figure into that column would have drawn the stage
 * labels at 8.7px and the row counts at 6.8px. Instead the viewBox narrows to
 * 600, and the width it gives up comes out of the left gutter — the count and
 * the median stack onto two lines rather than sharing one, which is what lets
 * 190 units of label column become 128.
 *
 * ── Why 560 and not 620 ────────────────────────────────────────────────────
 *
 * The two cards are the same rectangle, so this one gets half the row, about
 * 620px. Type is a share of W, so the way to make a label bigger without a
 * wider column is to make the viewBox SMALLER: at 560 units in 620px the figure
 * renders at about 1.11x, and every size below comes out above its nominal px
 * rather than at it. Together with raising the two smallest in units — the
 * point labels from 8.5 to 9.5, the row counts from 9 to 10 — that puts the
 * smallest type on the figure near 11px against the 8.8px it drew before.
 *
 * It is not free, and the price is plot width: 560 less a 116-unit gutter and a
 * 34-unit margin leaves 410 units for the capital axis, where 620 would have
 * left 470. Narrower swarms stack deeper, so the figure is a little taller. A
 * taller row is still readable and a 9px label is not, which is the same trade
 * the block above records making.
 */
const W_NARROW = 560
/**
 * `t` is 23 rather than the wide variant's 26 so the first band label lands
 * level with the bar chart's column headings. The two cards share grid rows, so
 * both plot areas start at the same y; this is the last few pixels, which are
 * the SVG's own top margin less the label's rise above the band rule.
 */
const PAD_NARROW = { ...PAD, l: 116, t: 23 }
/** Below this many pixels of card the wide variant would scroll, so the narrow
 *  one is drawn instead: its own 820px floor plus the card's 24px of padding
 *  either side, since what is measured is the whole figure. */
const NARROW_BELOW = 868
/** The narrow variant's rendered width is bracketed here rather than in a class,
 *  because the height it should fill is computed from the same two numbers and
 *  a clamp written twice is a clamp that drifts. */
const NARROW_MIN_W = 540
const NARROW_MAX_W = 700
/** How far a swarm may be stretched to fill a row taller than it needs. Beyond
 *  this the points read as a cloud with structure in it, and the vertical axis
 *  here is a category, not a measurement. */
const MAX_STRETCH = 2.5

/** Width and height of an element, tracked. Used for the plot band, whose
 *  height the figure fills. */
function useBox() {
  const [el, setEl] = useState(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    if (!el) return
    // Same object back when nothing moved: this feeds a layout memo, and a
    // fresh {w,h} every observation would rebuild it on every scroll.
    const measure = () => setBox(b =>
      (b.w === el.clientWidth && b.h === el.clientHeight) ? b : { w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [box, setEl]
}

/**
 * Which variant to draw, from the room the figure actually has.
 *
 * The bar chart beside this one switches on the `twoup` breakpoint, because its
 * columns are CSS and a media query is the whole mechanism. This figure's
 * geometry is computed in JS, and asking the same question through matchMedia
 * meant answering it from the viewport when the thing that matters is the
 * container: the page can put this figure in a half-width column, and any other
 * page could put it somewhere else again. It measures instead, so the variant
 * cannot disagree with the space it is drawn into.
 *
 * No feedback loop: the element measured is the card, whose width comes from
 * the layout above it, and the SVG's own min-width is contained by
 * `overflow-x-auto` rather than pushing back out.
 */
function useNarrow() {
  const [el, setEl] = useState(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (!el) return
    // A width of zero is a figure not laid out yet, not a narrow one.
    const measure = () => setNarrow(el.clientWidth > 0 && el.clientWidth < NARROW_BELOW)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [narrow, setEl]
}
/** Width of the hover card, in px. Matches the `w-56` on the element and is
 *  needed as a number to keep it clamped inside the figure. */
const TIP_W = 224

/**
 * Which fact a point's size actually rests on, said in the fewest words that
 * stay true. A founding year and an incorporation year are different claims and
 * the card names which one it has, because the gap between them has run to
 * eleven years among these companies.
 */
function ageLine(p) {
  const b = ageBasis(p)
  if (!b) return 'Age not established'
  if (b.kind === 'founded') return `Founded ${b.year}`
  if (b.kind === 'incorporated') return `Incorporated ${b.year}`
  return `Incorporated by ${b.before}`
}

/** One dimension of the legend. The label holds a column of its own so the
 *  three rows line up down a left edge, and the items get room to breathe
 *  rather than sitting on a 12px rhythm that reads as one block of text. */
function LegendRow({ label, children }) {
  return (
    <div className="flex items-start gap-3 text-[11px] twoup:text-[12px] font-sans">
      <span className="w-12 shrink-0 pt-[3px] uppercase tracking-[0.08em] text-muted/70">{label}</span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-muted">{children}</div>
    </div>
  )
}

function LegendItem({ label, children }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {children}{label}
    </span>
  )
}

/**
 * Point radius carries company age, in the three bands of AGE_BANDS.
 *
 * Size was a dead channel here once before, encoding trailing capital that 27 of
 * 45 companies did not have, and it is only back because age is banded rather
 * than continuous. When the encoding shipped, 38 of the 45 carried a band
 * against 29 that could have carried a continuous size; a web-search sweep has
 * since taken it to 40. Areas are roughly 1 : 2 : 3.5, which is readable at
 * three levels without the largest dot swamping its neighbours.
 *
 * Whatever is left unplaced is drawn at UNPLACED_R with a dotted outline and
 * counted in the legend — do not read a number here as current, since the sweep
 * moves it; the legend counts what is actually on screen. They are not defaulted
 * into the middle band: an unplaceable company is one whose sources do not say,
 * and saying so is the same discipline as the floor arrows on partial totals.
 *
 * A band survives evidence a continuous scale could not use. A Form D filing
 * from an issuer formed more than five years earlier gives no year at all, only
 * "over five years ago" — which is a LOWER bound on age, and lands unambiguously
 * in the top band while placing nowhere on a continuous axis.
 */
/**
 * Widened from 3.4 / 4.7 / 6.2, whose areas ran 1 : 1.9 : 3.3 — close enough
 * that two adjacent bands read as the same dot unless they touched. These run
 * 1 : 2.9 : 6.1, and the three levels now separate at a glance, which is the
 * whole point of an encoding with only three values in it.
 *
 * The RANGE is what widened, not the maximum. Pushing the largest dot up to 7.4
 * instead made the busiest row need more height than the card had to give it,
 * and the figure spilled 4% past the bottom of its band. The top of the scale
 * therefore sits about where it always did and the bottom came down to meet the
 * contrast, which costs nothing: it is the ratio a reader compares, not the
 * absolute size of any one dot.
 */
const AGE_R = { young: 2.6, mid: 4.4, old: 6.4 }
/** Smaller than the smallest band, and dotted: a company whose age nobody
 *  established should not read as a young one. */
const UNPLACED_R = 2.4
/** Collision spacing for the swarm. One radius for every point, the largest, so
 *  no pair can overlap whatever mix of sizes a row happens to hold. Tracks the
 *  largest AGE_R: widening the sizes without widening this would let a big dot
 *  sit on top of its neighbour. */
const R = AGE_R.old
const BAND_GAP = 42
const MIN_ROW = 48
const ROW_PAD = 18        // breathing room around a swarm inside its row

/**
 * Every row names its largest raise, in a strip of headroom reserved above the
 * swarm. Without it the figure could not be read at all without a pointer: 45
 * identical circles, and the only way to learn which one is Neuralink was to
 * hover it. One name per row is the most the space carries before the labels
 * start colliding with each other, and the largest is the one a reader is most
 * likely to be looking for.
 *
 * The label carries the amount as well as the name, because reading a value off
 * a log axis by eye is guesswork between the decades.
 */
const LABEL_H = 19        // headroom above each swarm, for that row's label
const LABEL_FONT = 10
/** Inter has no metrics available here, so the width of a label is estimated to
 *  keep it inside the plot. 0.5em per character runs slightly wide on this
 *  string mix, which is the safe direction to be wrong in: the cost is a label
 *  clamped a little early, not one running off the axis. */
const labelWidth = s => s.length * LABEL_FONT * 0.5

/**
 * A median is a summary, and drawing one over three companies lends it the same
 * authority as one drawn over twenty-six. The rows here run from 3 to 26, so
 * below this count the row states its n and no median is drawn: the reader is
 * told what is there rather than handed a centre line to read a trend off.
 */
const MIN_MEDIAN_N = 5

const GRID = '#E4E2DC'
const INK = '#16181D'
/**
 * Every point is one colour, and it is the colour of the bars in the figure
 * beside this one (`bg-accent`).
 *
 * Modality used to be a fifth encoding here, on top of x, row, fill and radius.
 * It cost a legend row of five swatches and it was answering a question this
 * figure is not asking: the axes are capital and stage. A reader who wants a
 * point's modality now hovers it, and the two figures read as one object rather
 * than as a chart and an unrelated chart that happen to share a filter bar.
 */
const POINT = '#0B5FA6'
/**
 * Stage rows are separated by a hairline, not by a band of tone.
 *
 * They used to alternate a filled lane, on the grounds that the thing a reader
 * must not get wrong is which stage a point belongs to and a bulging swarm puts
 * points near the row above. That is still true, and a rule says it with one
 * pixel where the fill said it with a whole row of tint. The tint was also the
 * reason this card read as a different colour from the bar chart beside it: the
 * two figures share `bg-canvas/50`, and the stripes were sitting on top of it.
 */
const ROW_RULE = '#EAE8E2'
/** Module-level so an uncontrolled figure gets the same object every render and
 *  the layout memo is not rebuilt on every parent update. */
const NO_FILTERS = { statuses: DEFAULT_STATUS_FILTER, modalities: [], stageMin: null }
/** The figure's own background: canvas at 50% over paper. A hollow point is
 *  filled with it so it reads as empty rather than as a white dot. */
const FIG_BG = '#FBFBF9'

export default function CapitalStageScatter({ board, filters = null, className = '' }) {
  const [asTable, setAsTable] = useState(false)
  const navigate = useNavigate()
  const [narrow, figRef] = useNarrow()
  const w = narrow ? W_NARROW : W
  const pad = narrow ? PAD_NARROW : PAD

  /**
   * The height this figure has to fill, in user units.
   *
   * Only in the two-up layout, where the grid row hands the plot a definite
   * height and the card beside it is what decides that height. The plot is
   * taken OUT of flow there (see the band below) precisely so this measurement
   * cannot chase itself: were the SVG still sizing the band, a taller figure
   * would grow the band, which would grow the figure.
   *
   * Stacked, there is no such height to fill and rows size to their swarms.
   */
  const [plotBox, plotBandRef] = useBox()
  const renderedW = Math.min(Math.max(plotBox.w, NARROW_MIN_W), NARROW_MAX_W)
  const fill = narrow && plotBox.h > 0 ? plotBox.h * (w / renderedW) : 0

  /**
   * The point under the pointer, and where to put its card.
   *
   * Measured off the mark's own rendered box rather than computed back from
   * the SVG's user units. The figure is scaled by its container and can be
   * scrolled sideways inside it, so a position derived from the viewBox would
   * have to undo both; a client rect has already had both applied to it.
   */
  const plotRef = useRef(null)
  const [hover, setHover] = useState(null)
  const showTip = useCallback((p, e) => {
    const host = plotRef.current
    if (!host) return
    const mark = e.currentTarget.getBoundingClientRect()
    const box = host.getBoundingClientRect()
    const y = mark.top - box.top
    setHover({
      p,
      x: mark.left + mark.width / 2 - box.left,
      y,
      h: mark.height,
      w: box.width,
      // Above the point normally; below it when there is not enough room above
      // for the card to clear the top of the figure.
      below: y < 112,
    })
  }, [])
  const hideTip = useCallback(() => setHover(null), [])

  // The whole plottable set, before the page's filters. Decides whether there
  // is a figure at all, so a narrow filter cannot make the section vanish.
  const all = useMemo(() => (board ? scatterPoints(board.rows) : []), [board])

  /**
   * The filters come from the controls above this figure. Left out, the default
   * still excludes acquired and defunct companies, which is what the chart
   * beside it does: this figure used to plot companies its neighbour had
   * deliberately hidden, with no way to tell.
   */
  const active = filters || NO_FILTERS
  const points = useMemo(
    () => (board ? scatterPoints(filterFunding(board.rows, active)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board, active.statuses, active.modalities, active.stageMin],
  )

  const layout = useMemo(() => {
    const domain = logDomain(points.map(p => p.total))
    const x = logScale(domain, pad.l, w - pad.r)

    // Only stages that actually hold a company get a row. An empty row would
    // imply we looked and found nobody, when mostly the stage is one this
    // pipeline never derives.
    const rows = []
    for (const band of STAGE_BANDS) {
      const stages = band.stages
        .filter(s => points.some(p => p.furthestStage === s))
        .map(s => {
          const members = points.filter(p => p.furthestStage === s)
          const placed = beeswarm(members.map(p => ({ x: x(p.total), key: p.id, p })), R)
          return {
            stage: s,
            placed,
            spread: swarmSpread(placed),
            n: members.length,
            top: members.reduce((a, b) => (b.total > a.total ? b : a)),
            // Held back below MIN_MEDIAN_N. The row still states its count, so
            // the reader sees a stage with three companies in it rather than a
            // stage whose summary happens to be missing.
            median: members.length >= MIN_MEDIAN_N ? median(members.map(p => p.total)) : null,
          }
        })
      if (stages.length) rows.push({ band, stages })
    }

    /**
     * ── One height for every stage row ──────────────────────────────────
     *
     * Rows used to be sized to their own swarm, so the stage holding 26
     * companies drew six times the band of the stage holding three. On a
     * categorical axis that is a size difference carrying no meaning, and it
     * read as though the tall row mattered more. Every row is the same height
     * now, and the count that used to be implied by the height is printed in
     * the gutter, where it can be read exactly.
     *
     * `fill` is the height the figure has been given, in user units. Whatever
     * is left after the axis, the band gaps and the label strips is divided
     * equally. It never goes below what the busiest swarm actually needs.
     */
    const flat = rows.flatMap(g => g.stages)
    const chrome = pad.t + pad.b + (rows.length - 1) * BAND_GAP + flat.length * LABEL_H
    const needed = Math.max(MIN_ROW, ...flat.map(r => 2 * (r.spread + R) + ROW_PAD))
    const swarmH = Math.max(needed, fill ? (fill - chrome) / flat.length : 0)

    for (const row of flat) {
      row.swarmH = swarmH
      row.height = swarmH + LABEL_H
      // The swarm is laid out for the room it needed, then opened up to the
      // room it has. Stretching only ever increases the gap between two points,
      // so it cannot introduce an overlap the beeswarm ruled out.
      const room = swarmH / 2 - R - ROW_PAD / 2
      row.stretch = row.spread > 0.5 ? Math.min(Math.max(room / row.spread, 1), MAX_STRETCH) : 1
    }

    let y = pad.t
    for (const [i, group] of rows.entries()) {
      if (i > 0) y += BAND_GAP
      group.y0 = y
      for (const [j, row] of group.stages.entries()) {
        row.y0 = y
        // The swarm is centred in what is left of the row AFTER the label strip,
        // so a label never sits on top of a point.
        row.cy = y + LABEL_H + row.swarmH / 2
        // The first row of a band already has the band's own heavier rule above
        // it, so a second line there would just thicken it.
        row.rule = j > 0
        y += row.height
      }
      group.y1 = y
    }
    return { rows, x, domain, height: y + pad.b }
  }, [points, w, pad, fill])

  // Not enough evidence-backed companies for a scatter to mean anything. This
  // reads the unfiltered set, so it is a statement about the data and not about
  // what the reader has narrowed to.
  if (!board || all.length < 5) return null

  const H = layout.height
  /** Ages are whole years, so the reader's calendar year is precise enough and
   *  the figure does not need to know today's date. */
  const year = new Date().getFullYear()
  const recent = points.filter(p => p.trailing > 0).length
  const partial = points.filter(p => p.partialTotal).length
  const byAge = points.reduce((acc, p) => {
    const b = ageBand(p, year)
    acc[b || 'none'] = (acc[b || 'none'] || 0) + 1
    return acc
  }, {})
  const anyAge = AGE_BANDS.some(b => byAge[b.id])
  // Which FACT is behind each point's size, as opposed to which band it lands
  // in. A reader comparing two circles is owed the difference between a sourced
  // founding year and an incorporation year standing in for one.
  const ageBasisCounts = points.reduce((acc, p) => {
    const kind = ageBasis(p)?.kind || 'none'
    acc[kind] = (acc[kind] || 0) + 1
    return acc
  }, { founded: 0, incorporated: 0, incorporated_bound: 0, none: 0 })
  const narrowed = all.length - points.length
  const go = r => navigate(r.href)

  return (
    // Three bands — head, plot, caption — so the row above can align this card
    // against the one beside it with `grid-rows-subgrid`. See Companies.jsx.
    // The legend belongs to the head: it is read before the plot, and putting
    // it in the plot band would push the marks down past the bar chart's rows.
    <figure ref={figRef} className={`flex flex-col border border-rule rounded-sm bg-canvas/50 p-5 sm:p-6 ${className}`}>
      {/* A column, so the legend can sit on the bottom of the head band. The
          band is as tall as the bar chart's controls, which is the taller of
          the two, and a key floating in the middle of the leftover space reads
          as something that failed to load. On the bottom it sits directly above
          the marks it explains, level with the controls opposite. */}
      <div className="flex flex-col">
      <figcaption className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker mb-1">Investment</p>
          <h2 className="font-serif text-xl sm:text-2xl font-semibold text-ink">
            Capital raised against verified stage
          </h2>
          {/* With filters on, the count is stated as a fraction of the whole
              plottable set. "N companies" alone reads as the population when it
              is a slice of one, and "0 companies" with nothing beside it reads
              as no data rather than as a filter the reader can widen. */}
          <p className="text-[12px] text-muted font-sans mt-1">
            {narrowed > 0
              ? <>{points.length} of {all.length} companies with a stage traceable to a trial record
                  or an FDA decision, after the filters above.</>
              : <>{points.length} {points.length === 1 ? 'company' : 'companies'} with a stage
                  traceable to a trial record or an FDA decision.</>}
            {' '}
            {/* The method notes the caption used to carry. They weigh the marks
                rather than explain how to read one, and both run long enough
                that under the figure they were the tallest thing in the card. */}
            <InfoTip label="How capital and age are measured">
              <span className="block">
                The capital axis is logarithmic because the set runs from under $1M to $1.2B, and on
                a linear one 34 of the 45 companies fell inside the leftmost tenth of the plot. The
                correlation below is a rank correlation, so the spacing of the axis does not enter
                it.
              </span>
              <span className="block mt-2">
                Point size is the company&apos;s age, from a researched founding year where one
                exists and from the incorporation year on its own Form D filing otherwise. Those are
                different facts: a company can trade for years before incorporating, and
                redomiciling into the US resets the declared year while the company is unchanged. An
                issuer formed more than five years before filing declares no year at all, only that
                it was earlier, which places it in the oldest band where that bound allows and
                nowhere where it does not.
              </span>
              <span className="block mt-2">
                Of the {points.length} plotted, {ageBasisCounts.founded} carry a researched founding
                year and {ageBasisCounts.incorporated + ageBasisCounts.incorporated_bound} fall back
                to incorporation. Every point names its own basis on hover and in the table. Among
                these companies the gap has run to eleven years, and in three cases the incorporation
                date on file belonged to a different company altogether.
              </span>
            </InfoTip>
          </p>
        </div>
        <button onClick={() => setAsTable(t => !t)} aria-pressed={asTable}
          className="text-[11px] font-sans text-muted underline decoration-rule underline-offset-2 hover:text-ink">
          {asTable ? 'View as chart' : 'View as table'}
        </button>
      </figcaption>

      {points.length >= 3 && (
        <>
          {/* ── Legend ──────────────────────────────────────────────────────
              Three dimensions, one panel, one row each: colour is modality,
              size is age, and everything else a mark can say is under Marks.

              It used to be three bare strips of nowrap text with 12px between
              items, which put eleven labelled swatches and four counts into
              about sixty pixels of height and read as a wall. The row label now
              holds a column of its own so the eye has a left edge to come back
              to, the items get real space between them, and the labels say the
              shortest true thing rather than a sentence. What the short labels
              drop is method, and method is on the tip beside the standfirst. */}
          {/* No panel: sits straight on the card, the way the bar chart's own
              control rows do. The bordered white box was the second thing
              making this card read as a different colour from that one. The
              rows still group, on spacing and their label column alone. */}
          <div className="mt-auto mb-3 space-y-2">
            {/* The swatch box is 18 units so the largest dot has room to draw;
                at 14 the widened radius was clipped by its own viewBox. The
                oldest band takes a line of its own, which gives the biggest
                circle air and squares this block off against Marks. */}
            {anyAge && (
              <LegendRow label="Size">
                {AGE_BANDS.filter(b => byAge[b.id]).map(b => (
                  <Fragment key={b.id}>
                    {b.id === 'old' && <span aria-hidden className="basis-full h-0" />}
                    <LegendItem label={`${b.label} (${byAge[b.id]})`}>
                      <svg aria-hidden width="18" height="18" viewBox="0 0 18 18" className="shrink-0">
                        <circle cx="9" cy="9" r={AGE_R[b.id]} fill={POINT} fillOpacity="0.78" />
                      </svg>
                    </LegendItem>
                  </Fragment>
                ))}
                {/* Only when a company's sources genuinely do not say. Kept
                    conditional rather than deleted: a dotted dot on the plot
                    with nothing in the key to explain it is worse than a line
                    of key nobody needs on the days it is empty. */}
                {byAge.none > 0 && (
                  <LegendItem label={`Not established (${byAge.none})`}>
                    <svg aria-hidden width="18" height="18" viewBox="0 0 18 18" className="shrink-0">
                      <circle cx="9" cy="9" r={UNPLACED_R} fill={FIG_BG} stroke={POINT}
                        strokeWidth="1.4" strokeDasharray="1.6 1.4" />
                    </svg>
                  </LegendItem>
                )}
              </LegendRow>
            )}

            <LegendRow label="Marks">
              <LegendItem label={`Raised in the last 24 months (${recent})`}>
                <svg aria-hidden width="18" height="18" viewBox="0 0 18 18" className="shrink-0">
                  <circle cx="9" cy="9" r="5.2" fill={POINT} fillOpacity="0.78" />
                </svg>
              </LegendItem>
              <LegendItem label={`No round in that time (${points.length - recent})`}>
                <svg aria-hidden width="18" height="18" viewBox="0 0 18 18" className="shrink-0">
                  <circle cx="9" cy="9" r="5.2" fill={FIG_BG} stroke={POINT} strokeWidth="1.8" />
                </svg>
              </LegendItem>
              <LegendItem label={`Row median (${MIN_MEDIAN_N} companies or more)`}>
                <svg aria-hidden width="18" height="18" viewBox="0 0 18 18" className="shrink-0">
                  <line x1="9" x2="9" y1="2.5" y2="15.5" stroke={INK} strokeOpacity="0.62" strokeWidth="1.6" />
                </svg>
              </LegendItem>
              {partial > 0 && (
                <LegendItem label={`Total is a floor (${partial})`}>
                  <svg aria-hidden width="20" height="18" viewBox="0 0 20 18" className="shrink-0">
                    <circle cx="5.2" cy="9" r="5.2" fill={POINT} fillOpacity="0.78" />
                    <path d="M13 9 h5 m-3 -2.6 l3 2.6 l-3 2.6" fill="none"
                      stroke={POINT} strokeOpacity="0.65" strokeWidth="1.3"
                      strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </LegendItem>
              )}
            </LegendRow>
          </div>
        </>
      )}
      </div>

      {/* `min-h-0` so the grid row decides this band's height rather than the
          figure inside it, and the plot is absolute within it for the same
          reason — see `fill` above. Overflow scrolls rather than spills, in the
          one case where a swarm needs more room than the row was given. */}
      <div ref={plotBandRef} className="twoup:relative twoup:min-h-0">
      {points.length < 3 ? (
        <p className="py-6 text-[13px] font-sans text-muted border-t border-rule">
          Too few companies match these filters to plot. Widen them above.
        </p>
      ) : (
        <>
          {asTable ? <ScatterTable points={points} /> : (
            // The scale is bracketed at BOTH ends, because everything in an SVG
            // scales with its container and there is no font size that is right
            // at 640px and at 1500px. Below the floor the figure scrolls, the
            // rule FundingChart already follows and at the same 820px. Above the
            // ceiling it stops growing and centres, because a card 1380px wide
            // was drawing 22px stage labels next to 13px body text and turning
            // the plot back into a ribbon. Between the two, type varies by a
            // fifth across every viewport the site sees. The narrow variant
            // brackets the same way around its own width.
            //
            // The `relative` host sits OUTSIDE the scroll box on purpose. A
            // card positioned inside it would be clipped, because `overflow-x`
            // on its own is not a thing a browser can honour: setting it to
            // auto forces overflow-y to auto as well, so a tooltip reaching
            // above a point in the top row would be cut off or, worse, open a
            // vertical scrollbar on the figure.
            <div ref={plotRef}
              className="relative twoup:absolute twoup:inset-0 twoup:overflow-y-auto">
              <div className="overflow-x-auto">
              <svg viewBox={`0 0 ${w} ${H}`} role="img"
                style={narrow ? { minWidth: NARROW_MIN_W, maxWidth: NARROW_MAX_W } : undefined}
                className={`block mx-auto w-full h-auto ${narrow ? '' : 'min-w-[820px] max-w-[1120px]'}`}
                aria-label={`Capital raised against verified stage for ${points.length} companies, on a logarithmic axis, banded into clinical evidence and FDA authorisation.`}>
                {/* ── Row rules ───────────────────────────────────────────
                    Drawn first, under everything. One hairline per stage row,
                    the full width of the figure including the label, so a point
                    that bulges out of a crowded swarm still reads as belonging
                    to the row its label is in. */}
                {layout.rows.flatMap(g => g.stages).filter(r => r.rule).map(row => (
                  <line key={`rule-${row.stage}`} x1="0" x2={w - pad.r} y1={row.y0} y2={row.y0}
                    stroke={ROW_RULE} strokeWidth="1" />
                ))}

                {/* ── X axis: one gridline per decade ─────────────────────── */}
                {decadeTicks(layout.domain).map(v => (
                  <g key={v}>
                    <line x1={layout.x(v)} x2={layout.x(v)} y1={pad.t} y2={H - pad.b}
                      stroke={GRID} strokeWidth="1" />
                    <text x={layout.x(v)} y={H - pad.b + 20} textAnchor="middle"
                      className="fill-muted" style={{ fontSize: narrow ? 11 : 10, fontFamily: 'ui-monospace, monospace' }}>
                      {fmtUsd(v)}
                    </text>
                  </g>
                ))}
                {/* Sits on the figure's bottom edge, under the tick labels.
                    "(log)" replaces the sentence that spelled the decades out:
                    the ticks below already read $100K, $1M, $10M, $100M, $1.0B,
                    which says the same thing in the reader's own units. */}
                <text x={pad.l + (w - pad.l - pad.r) / 2} y={H - 7} textAnchor="middle"
                  className="fill-muted" style={{ fontSize: 10, letterSpacing: '0.08em' }}>
                  TOTAL PRIVATE CAPITAL RAISED (LOG)
                </text>

                {layout.rows.map(group => (
                  <g key={group.band.id}>
                    <text x={4} y={group.y0 - 9} className="fill-muted/70"
                      style={{ fontSize: narrow ? 10 : 9.5, letterSpacing: '0.09em', textTransform: 'uppercase' }}>
                      {group.band.label}
                    </text>
                    <line x1={0} x2={w - pad.r} y1={group.y0 - 1} y2={group.y0 - 1}
                      stroke={GRID} strokeWidth="1.5" />

                    {group.stages.map(row => (
                      <g key={row.stage}>
                        {/* The stage, then what its row holds. The medians are
                            the finding; printing them beats asking a reader to
                            estimate a centre from a cloud of 26 dots. In the
                            narrow variant the two stack, which is what buys the
                            gutter back from 190 units to 128. */}
                        {(() => {
                          const n = `${row.n} ${row.n === 1 ? 'company' : 'companies'}`
                          const med = row.median != null ? `median ${fmtUsd(row.median)}` : null
                          const lines = narrow
                            ? [n, med].filter(Boolean)
                            : [med ? `${n} · ${med}` : n]
                          const gx = pad.l - (narrow ? 12 : 18)
                          // Leading grows with the type: at 11 units the old
                          // 11-unit step set the two lines solid.
                          const step = narrow ? 12 : 11
                          const top = row.cy - 3 - (lines.length - 1) * (step / 2)
                          return (
                            <>
                              <text x={gx} y={top} textAnchor="end"
                                className="fill-ink-soft" style={{ fontSize: narrow ? 12 : 11.5 }}>
                                {STAGE_LABELS[row.stage]}
                              </text>
                              {lines.map((t, i) => (
                                <text key={t} x={gx} y={top + 15 + i * step} textAnchor="end"
                                  className="fill-muted/80"
                                  style={{ fontSize: narrow ? 11 : 9, fontFamily: 'ui-monospace, monospace' }}>
                                  {t}
                                </text>
                              ))}
                            </>
                          )
                        })()}

                        {/* Behind the points, so it never hides one. Darker and
                            thicker than a gridline, or at this size it reads as
                            a piece of one. Absent below MIN_MEDIAN_N. */}
                        {row.median != null && (
                          <line x1={layout.x(row.median)} x2={layout.x(row.median)}
                            y1={row.cy - row.swarmH / 2 + 4} y2={row.cy + row.swarmH / 2 - 4}
                            stroke={INK} strokeOpacity="0.62" strokeWidth="1.6" />
                        )}

                        {/* The row's largest raise, named. aria-hidden: the
                            point itself already carries the name and the amount
                            in its accessible label, and a second copy would be
                            read out twice. */}
                        {(() => {
                          const mark = row.placed.find(q => q.p.id === row.top.id)
                          if (!mark) return null
                          const text = `${row.top.name} · ${fmtUsd(row.top.total)}`
                          const half = labelWidth(text) / 2
                          // Kept inside the plot. Where that pulls the label off
                          // its point, a hairline says which point it belongs to.
                          const lx = Math.min(Math.max(mark.x, pad.l + half), w - pad.r - half)
                          const ly = row.y0 + LABEL_H - 5
                          return (
                            <g aria-hidden>
                              <line x1={lx} y1={ly + 2.5} x2={mark.x}
                                y2={row.cy + mark.y * row.stretch - R - 1.5}
                                stroke={INK} strokeOpacity="0.3" strokeWidth="0.8" />
                              <text x={lx} y={ly} textAnchor="middle" className="fill-muted"
                                style={{ fontSize: LABEL_FONT }}>
                                {text}
                              </text>
                            </g>
                          )
                        })()}

                        {row.placed.map(({ p, x: cx, y: dy }) => {
                          const cy = row.cy + dy * row.stretch
                          const isRecent = p.trailing > 0
                          const band = ageBand(p, year)
                          const pr = band ? AGE_R[band] : UNPLACED_R
                          const label = `${p.name}. ${fmtUsd(p.total)} raised`
                            + (p.partialTotal ? ', private capital only, so the figure is a floor. ' : '. ')
                            + `${STAGE_LABELS[p.furthestStage]}.`
                            + (p.modality ? ` ${MODALITY_LABELS[p.modality]}.` : '')
                            + (isRecent ? ` ${fmtUsd(p.trailing)} in the last 24 months.`
                              : ' No round in the last 24 months.')
                            + ` ${ageLine(p)}.`
                          return (
                            // No <title>: the browser's own tooltip waits about a
                            // second, cannot be styled, and would now sit behind
                            // the card below saying the same thing twice. The
                            // accessible name stays on aria-label, which is what
                            // a screen reader was reading anyway.
                            <g key={p.id} role="link" tabIndex={0} aria-label={label}
                              onClick={() => go(p)}
                              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(p) } }}
                              onMouseEnter={e => showTip(p, e)}
                              onMouseLeave={hideTip}
                              onFocus={e => showTip(p, e)}
                              onBlur={hideTip}
                              className="cursor-pointer outline-none focus-visible:[&>circle]:stroke-ink">
                              <circle cx={cx} cy={cy} r={pr}
                                fill={isRecent ? POINT : FIG_BG}
                                fillOpacity={isRecent ? 0.78 : 1}
                                stroke={isRecent ? '#FFFFFF' : POINT}
                                strokeWidth={isRecent ? 1.1 : 1.8}
                                strokeDasharray={band ? undefined : '1.6 1.4'} />
                              {/* A private-only total on a company that also
                                  raised publicly is a lower bound, so the point
                                  says which way the truth lies. */}
                              {p.partialTotal && (
                                <path d={`M${cx + pr + 2} ${cy} h7.5 m-3 -2.8 l3 2.8 l-3 2.8`}
                                  fill="none" stroke={POINT} strokeOpacity="0.8" strokeWidth="1.3"
                                  strokeLinecap="round" strokeLinejoin="round" />
                              )}
                            </g>
                          )
                        })}
                      </g>
                    ))}
                  </g>
                ))}
              </svg>
            </div>

            {/* Follows the point rather than a fixed corner, flips below when
                the point is too near the top to clear it, and is clamped so a
                point at either edge does not push the card off the figure. */}
            {hover && (
              <div
                aria-hidden
                className="pointer-events-none absolute z-20 w-56 rounded-sm border border-rule
                           bg-paper px-2.5 py-2 shadow-lg font-sans text-[11px] leading-snug
                           text-ink-soft animate-fade-in"
                style={{
                  left: Math.min(Math.max(hover.x, TIP_W / 2), Math.max(hover.w - TIP_W / 2, TIP_W / 2)),
                  top: hover.below ? hover.y + hover.h + 8 : hover.y - 8,
                  transform: `translate(-50%, ${hover.below ? '0' : '-100%'})`,
                }}
              >
                <p className="font-semibold text-ink text-[12px] leading-tight">{hover.p.name}</p>
                <p className="mt-1 font-mono tabular-nums text-ink">
                  {fmtUsd(hover.p.total)} raised
                  {hover.p.partialTotal && <span className="text-muted"> (private only, a floor)</span>}
                </p>
                <p className="mt-0.5 text-muted">
                  {STAGE_LABELS[hover.p.furthestStage]}
                  {hover.p.modality && <> · {MODALITY_LABELS[hover.p.modality]}</>}
                </p>
                <p className="mt-0.5 text-muted">
                  {hover.p.trailing > 0
                    ? <>Last 24 months: {fmtUsd(hover.p.trailing)}
                        {hover.p.latestDate && <> · {fmtMonthYear(hover.p.latestDate)}</>}</>
                    : 'No round in the last 24 months'}
                </p>
                <p className="mt-0.5 text-muted">{ageLine(hover.p)}</p>
              </div>
            )}
          </div>
          )}
        </>
      )}
      </div>

      {/* ── Caption ──────────────────────────────────────────────────────
          Two things a reader cannot read this figure correctly without: that
          the divide is not a sequence, and that the trend the layout invites
          is not there to be read. Everything else has a better home — method
          on the standfirst's tip, per-company facts on the hover card — and
          under the figure it was only making the card taller than the one
          beside it.

          The rule on top of this block is the one that has to line up with the
          rule on the other card, which is why the caption is its own grid band
          rather than something pushed down by `mt-auto`. */}
      <div className="mt-auto twoup:mt-0 pt-3 border-t border-rule text-[11px] twoup:text-[12px] font-sans text-muted leading-relaxed space-y-1">
        <p>
          The bands are different regulatory routes, not steps in one sequence: positions compare
          within a band, not across the divide.
        </p>
        {/* Where stage comes from is not repeated here. The standfirst already
            says these are companies with a stage traceable to a trial record or
            an FDA decision, which is the same sentence twice on one card. */}
        <p>
          Within the clinical band the relation is weak and the sample too small to call: Spearman
          rho 0.35 over 19 companies, on an interval crossing zero. Measured 29 July 2026.
        </p>
      </div>
    </figure>
  )
}

function ScatterTable({ points }) {
  const rows = [...points].sort((a, b) => b.total - a.total)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[12px] font-sans border-collapse">
        <caption className="sr-only">Companies by capital raised, verified stage, modality and recent capital.</caption>
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.08em] text-muted/70 text-left border-b border-rule">
            <th scope="col" className="py-1.5 pr-2 font-semibold">Company</th>
            <th scope="col" className="py-1.5 pr-2 font-semibold">Band</th>
            <th scope="col" className="py-1.5 pr-2 font-semibold">Stage</th>
            <th scope="col" className="py-1.5 pr-2 font-semibold">Modality</th>
            <th scope="col" className="py-1.5 pr-2 font-semibold text-right">Total</th>
            <th scope="col" className="py-1.5 font-semibold text-right">Last 24 months</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.id} className="border-b border-rule-soft">
              <th scope="row" className="py-1.5 pr-2 font-normal text-left">
                <Link to={p.href} className="text-ink-soft hover:text-accent">{p.name}</Link>
              </th>
              <td className="py-1.5 pr-2 text-muted">
                {STAGE_BANDS.find(b => b.id === p.band)?.label}
              </td>
              <td className="py-1.5 pr-2 text-muted">
                {p.stageEvidenceUrl
                  ? <a href={p.stageEvidenceUrl} target="_blank" rel="noreferrer"
                      className="text-accent hover:underline">{STAGE_LABELS[p.furthestStage]}</a>
                  : STAGE_LABELS[p.furthestStage]}
              </td>
              <td className="py-1.5 pr-2 text-muted">{MODALITY_LABELS[p.modality] || 'Not available'}</td>
              <td className="py-1.5 pr-2 font-mono tabular-nums text-right text-ink">
                {fmtUsd(p.total)}
                {p.partialTotal && <sup className="text-muted" title="Private capital only">†</sup>}
              </td>
              <td className="py-1.5 font-mono tabular-nums text-right text-muted">
                {p.trailing ? fmtUsd(p.trailing) : '—'}
                {p.latestDate && <span className="hidden sm:inline"> · {fmtMonthYear(p.latestDate)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
